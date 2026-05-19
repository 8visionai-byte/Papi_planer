import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS, DEFAULTS } from "@/lib/ai/claude";
import { BRIEFING_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { buildBriefingContext } from "@/lib/briefing/generator";

/**
 * Finalize a past day's briefing.
 *
 * Why: a user may generate the briefing early in the day when most data is
 * empty. Once the day ends, we want a single authoritative final summary
 * built from the full day's data. The dashboard calls this silently on first
 * visit of a new day for any past briefings still marked finalized=false.
 *
 * Body (optional): { date?: "YYYY-MM-DD" } — defaults to yesterday.
 * Never finalizes today's briefing (it could still change).
 */
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  // Resolve target date
  let targetDate: Date;
  try {
    const body = (await request.clone().json().catch(() => null)) as
      | { date?: string }
      | null;
    if (body?.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      const [y, m, d] = body.date.split("-").map(Number);
      targetDate = new Date(y, m - 1, d);
    } else {
      // Default: yesterday in server local time
      const t = new Date();
      t.setHours(0, 0, 0, 0);
      t.setDate(t.getDate() - 1);
      targetDate = t;
    }
  } catch {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() - 1);
    targetDate = t;
  }

  // Refuse to finalize today's or future briefing
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const targetDayStart = new Date(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate()
  );
  if (targetDayStart.getTime() >= todayStart.getTime()) {
    return NextResponse.json(
      { ok: false, reason: "Cannot finalize today or future briefings" },
      { status: 400 }
    );
  }

  // Find the briefing for that day
  const existing = await prisma.briefing.findUnique({
    where: { userId_date: { userId, date: targetDayStart } },
  });
  if (!existing) {
    return NextResponse.json({ ok: true, finalized: false, reason: "no briefing for date" });
  }
  if (existing.finalized) {
    return NextResponse.json({ ok: true, finalized: true, alreadyFinal: true });
  }

  try {
    const context = await buildBriefingContext(userId, targetDayStart);
    const userMessage = `Oto pelny kontekst dnia uzytkownika do podsumowania (dzien sie juz zakonczyl, to ostateczne podsumowanie):\n\n${context}\n\nWygeneruj wieczorne podsumowanie dnia wedlug instrukcji w system prompt. Pamietaj o refleksjach 2-3 mentorow.`;

    const response = await anthropic.messages.create({
      model: MODELS.BRIEFING,
      max_tokens: DEFAULTS.BRIEFING_MAX_TOKENS,
      temperature: DEFAULTS.CREATIVE_TEMPERATURE,
      system: BRIEFING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const fullText = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");

    await prisma.briefing.update({
      where: { id: existing.id },
      data: {
        content: fullText,
        audioUrl: null, // stale audio invalidated by regen
        finalized: true,
      },
    });

    return NextResponse.json({ ok: true, finalized: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
