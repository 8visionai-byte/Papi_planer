import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS } from "@/lib/ai/claude";
import { buildUserContext } from "@/lib/ai/user-context";

/**
 * POST /api/activities/explain  -> { explanation, cached }
 *
 * "What even IS this?" for one row of the day plan.
 *
 * The owner met "Anki review" inside his own plan and had to google it. A task he
 * cannot decode is a task he will not do, so every row can ask for a plain-Polish
 * explanation on demand.
 *
 * Written ONCE and cached in `Activity.explanation`: the answer to "what is Anki
 * review" does not change between two taps, and the screen re-asks on every mount
 * of the expanded row. Every later call is a single indexed read, no model, no cost.
 *
 * A model failure is NOT an error for the caller: the row must survive it, so the
 * route answers 200 with an empty explanation plus a human message, and the screen
 * shows a toast instead of a broken block.
 */

/** Nothing shorter than this is a real answer; an empty string is never cached. */
const MIN_USEFUL_LENGTH = 10;

const SYSTEM_PROMPT = `Jesteś częścią osobistej aplikacji PAPI PLANER. Tłumaczysz właścicielowi, czym jest zadanie z jego własnego planu dnia, kiedy sam nie pamięta, co ono znaczy.

Zasady:
- Piszesz po polsku, prostym językiem, jak do kogoś, kto nie zna branżowych słów.
- Żaden angielski termin nie może zostać bez tłumaczenia. Jeśli nazwa zadania jest po angielsku, wyjaśnij ją po polsku.
- Dokładnie dwa krótkie akapity, oddzielone pustą linią.
  Akapit pierwszy: czym to jest, jednym zdaniem, bez żargonu.
  Akapit drugi: po co TEN człowiek to robi i co mu to daje. Oprzyj się na kontekście, który dostajesz. Jeśli kontekst nic o tym nie mówi, napisz ogólnie, ale nie zmyślaj faktów o nim.
- Razem maksymalnie 60 słów.
- Bez nagłówków, bez list, bez pogrubień, bez emotikon.
- Nie używaj długiego myślnika.
- Nie oceniaj i nie motywuj na siłę. Po prostu wyjaśnij.`;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = (await req.json().catch(() => null)) as { activityId?: unknown } | null;
  const activityId = body?.activityId;
  if (!activityId || typeof activityId !== "string") {
    return NextResponse.json({ error: "activityId required" }, { status: 400 });
  }

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      name: true,
      type: true,
      notes: true,
      durationMin: true,
      explanation: true,
      // Ownership lives on the parent day, not on the row itself.
      dailyLog: { select: { userId: true } },
    },
  });

  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  if (activity.dailyLog.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The cache. Deliberately the FIRST thing after the ownership check: this is the
  // path most calls take, and it must not cost a single token.
  const cachedText = activity.explanation?.trim() ?? "";
  if (cachedText.length > 0) {
    return NextResponse.json({ explanation: cachedText, cached: true });
  }

  try {
    // scope "chat" = the widest picture of the person (goals, habits, diet, energy),
    // which is exactly what "po co TY to robisz" needs.
    const userCtx = await buildUserContext(userId, { scope: "chat" });

    const duration = activity.durationMin ? `${activity.durationMin} min` : "nie podano";
    const notes = activity.notes?.trim() ? activity.notes.trim() : "brak";

    const userMsg =
      `${userCtx.text}\n\n` +
      `ZADANIE DO WYJAŚNIENIA\n` +
      `Nazwa: ${activity.name}\n` +
      `Rodzaj: ${activity.type}\n` +
      `Notatka: ${notes}\n` +
      `Czas trwania: ${duration}\n\n` +
      `Wyjaśnij to zadanie zgodnie z zasadami.`;

    const response = await anthropic.messages.create({
      model: MODELS.FAST,
      max_tokens: 400,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMsg }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const explanation =
      textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";

    if (explanation.length < MIN_USEFUL_LENGTH) {
      return NextResponse.json({
        explanation: "",
        cached: false,
        message: "Nie udało się teraz wyjaśnić tego zadania.",
      });
    }

    await prisma.activity.update({
      where: { id: activity.id },
      data: { explanation },
    });

    return NextResponse.json({ explanation, cached: false });
  } catch (err) {
    // The screen has to live through this: 200 with an empty answer, never a 500.
    console.error("[api/activities/explain] nie powiodlo sie:", err);
    return NextResponse.json({
      explanation: "",
      cached: false,
      message: "Nie udało się teraz wyjaśnić tego zadania.",
    });
  }
}
