/**
 * POST /api/activities/follow-up
 *
 * The "how did it go?" answer after a finished training.
 *
 * Before: dashboard/page.tsx fired the text at /api/chat, ignored the streamed
 * answer, and /api/chat saved nothing — a paid model call with zero artifact,
 * and the most valuable training data (the user's own account of the session)
 * was lost.
 *
 * Now every call produces three artifacts:
 *  1. MentorConversation + 2 x MentorChatMessage — the exchange is in history
 *  2. TrainingLog — structured numbers parsed out of the answer (or plain notes)
 *  3. Activity.notes / metrics — duration + calories corrected when the user
 *     gave a real number
 * and the mentor's reply is returned to the UI instead of being dropped.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS, DEFAULTS } from "@/lib/ai/claude";
import { buildMentorContext } from "@/lib/ai/mentor";
import { getCurrentBodyMetrics } from "@/lib/ai/body-metrics";
import { estimateCalories } from "@/lib/ai/calorie-calculator";

const MAX_MESSAGE_CHARS = 4000;

interface ParsedTraining {
  exerciseName: string | null;
  sets: number | null;
  reps: number | null;
  weightKg: number | null;
  durationMin: number | null;
  distanceKm: number | null;
  rating: number | null;
  notes: string | null;
}

const EMPTY_PARSE: ParsedTraining = {
  exerciseName: null,
  sets: null,
  reps: null,
  weightKg: null,
  durationMin: null,
  distanceKm: null,
  rating: null,
  notes: null,
};

function numOrNull(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/**
 * Pull sets / reps / weight / duration / distance out of free-form Polish text.
 * Cheap model, temperature 0, JSON only. Any failure degrades to plain notes.
 */
async function parseTrainingData(
  message: string,
  activityName: string
): Promise<ParsedTraining> {
  const system = [
    "Wyciągasz liczby z opisu treningu napisanego po polsku.",
    "Zwróć WYŁĄCZNIE JSON, bez komentarza i bez bloku markdown:",
    "{",
    '  "exerciseName": "nazwa ćwiczenia lub null",',
    '  "sets": liczba serii lub null,',
    '  "reps": liczba powtórzeń w serii lub null,',
    '  "weightKg": obciążenie w kg lub null,',
    '  "durationMin": czas trwania w minutach lub null,',
    '  "distanceKm": dystans w kilometrach lub null,',
    '  "rating": subiektywna ocena treningu 1-10 lub null,',
    '  "notes": "krótkie streszczenie tego, co napisał użytkownik, lub null"',
    "}",
    "",
    "Zasady:",
    "- NIE zgaduj. Jeśli liczby nie ma w tekście, wpisz null.",
    "- Godziny przeliczaj na minuty (1,5h = 90).",
    "- Metry przeliczaj na kilometry (5000 m = 5).",
  ].join("\n");

  const response = await anthropic.messages.create({
    model: MODELS.FAST,
    max_tokens: 500,
    temperature: 0,
    system,
    messages: [
      {
        role: "user",
        content: `Aktywność: ${activityName}\n\nOpis użytkownika:\n${message}`,
      },
    ],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") return EMPTY_PARSE;

  let jsonStr = block.text.trim();
  const fenced = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) jsonStr = fenced[1].trim();

  try {
    const p = JSON.parse(jsonStr) as Record<string, unknown>;
    return {
      exerciseName:
        typeof p.exerciseName === "string" && p.exerciseName.trim()
          ? p.exerciseName.trim().slice(0, 120)
          : null,
      sets: numOrNull(p.sets, 1, 100),
      reps: numOrNull(p.reps, 1, 1000),
      weightKg: numOrNull(p.weightKg, 0.5, 500),
      durationMin: numOrNull(p.durationMin, 1, 600),
      distanceKm: numOrNull(p.distanceKm, 0.1, 500),
      rating: numOrNull(p.rating, 1, 10),
      notes:
        typeof p.notes === "string" && p.notes.trim() ? p.notes.trim().slice(0, 1000) : null,
    };
  } catch {
    return EMPTY_PARSE;
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { activityId?: unknown; message?: unknown; mentorId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  const activityId = typeof body.activityId === "string" ? body.activityId : "";
  const message =
    typeof body.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : "";
  const requestedMentorId = typeof body.mentorId === "string" ? body.mentorId : null;

  if (!activityId) {
    return NextResponse.json({ error: "activityId wymagane" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "message wymagane" }, { status: 400 });
  }

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: { dailyLog: { select: { userId: true, date: true } } },
  });
  if (!activity) {
    return NextResponse.json({ error: "Nie znaleziono aktywności" }, { status: 404 });
  }
  if (activity.dailyLog.userId !== userId) {
    return NextResponse.json({ error: "Brak dostępu" }, { status: 403 });
  }

  // ---- mentor ------------------------------------------------------------
  const mentor = requestedMentorId
    ? await prisma.mentor.findFirst({
        where: { id: requestedMentorId, userId },
        select: { id: true, name: true, avatarEmoji: true },
      })
    : activity.lifeAreaId
      ? await prisma.mentor.findFirst({
          where: { userId, active: true, lifeAreas: { some: { id: activity.lifeAreaId } } },
          select: { id: true, name: true, avatarEmoji: true },
        })
      : null;

  // ---- 1. mentor reply ---------------------------------------------------
  let reply: string | null = null;
  let replyError: string | null = null;

  if (mentor) {
    try {
      const ctx = await buildMentorContext(mentor.id, userId);
      const system = [
        ctx.systemPrompt,
        "",
        "---",
        "",
        "## Kontekst użytkownika",
        ctx.userContext || "(brak danych)",
        "",
        "---",
        "",
        `Użytkownik właśnie ukończył aktywność: "${activity.name}" i opisuje, jak poszło.`,
        "Odpowiedz krótko (3-5 zdań), po polsku, w swoim stylu:",
        "- odnieś się do KONKRETÓW, które podał (liczby, samopoczucie)",
        "- daj jedną praktyczną wskazówkę na następny raz",
        "- nie wymyślaj danych, których nie ma",
      ].join("\n");

      const response = await anthropic.messages.create({
        model: MODELS.CHAT,
        max_tokens: DEFAULTS.CHAT_MAX_TOKENS,
        temperature: DEFAULTS.CREATIVE_TEMPERATURE,
        system,
        messages: [{ role: "user", content: message }],
      });
      const block = response.content[0];
      reply = block && block.type === "text" ? block.text : null;
    } catch (err) {
      replyError = err instanceof Error ? err.message : "Mentor nie odpowiedział";
      console.error("[activities/follow-up] mentor reply failed", err);
    }
  }

  // ---- 2. persist the exchange ------------------------------------------
  let conversationId: string | null = null;
  if (mentor) {
    try {
      const conversation = await prisma.mentorConversation.create({
        data: {
          userId,
          mentorId: mentor.id,
          title: `Po treningu: ${activity.name}`.slice(0, 180),
          messages: {
            create: [
              { role: "user", content: message },
              ...(reply ? [{ role: "assistant", content: reply }] : []),
            ],
          },
        },
        select: { id: true },
      });
      conversationId = conversation.id;
    } catch (err) {
      console.error("[activities/follow-up] conversation save failed", err);
    }
  }

  // ---- 3. structured training data --------------------------------------
  let parsed: ParsedTraining = EMPTY_PARSE;
  try {
    parsed = await parseTrainingData(message, activity.name);
  } catch (err) {
    console.error("[activities/follow-up] parse failed, falling back to notes", err);
  }

  let trainingLogId: string | null = null;
  if (activity.lifeAreaId) {
    try {
      const log = await prisma.trainingLog.create({
        data: {
          userId,
          lifeAreaId: activity.lifeAreaId,
          date: activity.dailyLog.date,
          exerciseName: parsed.exerciseName ?? activity.name,
          sets: parsed.sets !== null ? Math.round(parsed.sets) : null,
          reps: parsed.reps !== null ? Math.round(parsed.reps) : null,
          weightKg: parsed.weightKg,
          durationMin:
            parsed.durationMin !== null
              ? Math.round(parsed.durationMin)
              : (activity.durationMin ?? null),
          distance: parsed.distanceKm,
          // Always keep the raw answer — that is the data we were losing.
          notes: message,
          rating: parsed.rating !== null ? Math.round(parsed.rating) : null,
          metrics: { source: "follow-up", activityId: activity.id },
        },
        select: { id: true },
      });
      trainingLogId = log.id;
    } catch (err) {
      console.error("[activities/follow-up] training log save failed", err);
    }
  }

  // ---- 4. back-fill the activity ----------------------------------------
  // Keep the answer on the activity too (works even without a lifeArea), and
  // correct duration + calories when the user actually gave a time.
  let caloriesUpdated: number | null = null;
  try {
    const existingMetrics =
      (activity.metrics as Record<string, unknown> | null | undefined) ?? {};
    const newDuration =
      parsed.durationMin !== null ? Math.round(parsed.durationMin) : activity.durationMin;

    let metrics: Record<string, unknown> = { ...existingMetrics, followUp: true };
    if (activity.completed && newDuration && newDuration !== activity.durationMin) {
      const bodyMetrics = await getCurrentBodyMetrics(userId);
      const kcal = estimateCalories(activity.type, activity.name, newDuration, bodyMetrics.weightKg);
      if (kcal !== null) {
        metrics = {
          ...metrics,
          caloriesBurned: kcal,
          weightUsed: bodyMetrics.weightKg,
          durationEstimated: false,
        };
        caloriesUpdated = kcal;
      }
    }

    const notesPrefix = activity.notes ? `${activity.notes}\n\n` : "";
    await prisma.activity.update({
      where: { id: activity.id },
      data: {
        durationMin: newDuration,
        metrics: metrics as Prisma.InputJsonValue,
        notes: `${notesPrefix}Po treningu: ${message}`.slice(0, 5000),
      },
    });
  } catch (err) {
    console.error("[activities/follow-up] activity update failed", err);
  }

  return NextResponse.json({
    reply,
    replyError,
    conversationId,
    trainingLogId,
    caloriesUpdated,
    mentorName: mentor?.name ?? null,
    mentorEmoji: mentor?.avatarEmoji ?? null,
  });
}
