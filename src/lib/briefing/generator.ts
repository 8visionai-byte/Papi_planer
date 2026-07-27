import { prisma } from "@/lib/db/prisma";
import { buildUserContext } from "@/lib/ai/user-context";

/**
 * Builds the evening-summary context.
 *
 * The "who is this user" half (profile, biometrics, goals, mentors, habits,
 * training, diet, the day itself) now comes from the SHARED module —
 * src/lib/ai/user-context.ts, scope "briefing" — instead of being rebuilt here.
 * Only the strictly day-scoped detail the summary needs (per-habit tick, the
 * meal list, that day's training entries) is still assembled locally, because
 * it is a property of the summarized DAY, not of the user.
 *
 * Pass `targetDate` to summarize a past day (used by /api/briefing/finalize
 * when a day has ended and we want the full final picture).
 */
export async function buildBriefingContext(
  userId: string,
  targetDate?: Date
): Promise<string> {
  const base = targetDate ?? new Date();
  const dayStart = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const nextDayStart = new Date(dayStart);
  nextDayStart.setDate(nextDayStart.getDate() + 1);

  const [userCtx, dayLog, habits, habitCompletions, trainingLogs] =
    await Promise.all([
      buildUserContext(userId, { scope: "briefing", referenceDate: dayStart }),
      prisma.dailyLog.findUnique({
        where: { userId_date: { userId, date: dayStart } },
        select: {
          meals: {
            select: {
              time: true,
              name: true,
              calories: true,
              protein: true,
              carbs: true,
              fat: true,
            },
          },
          activities: {
            // Copies of calendar meetings never reach the screen, so the user cannot
            // tick them. Counting them here would make the evening briefing tell him
            // he finished 5 of 9 on a day that really had 8 tasks.
            where: { duplicateOfMeetingId: null },
            select: { name: true, completed: true, notes: true, metrics: true },
          },
        },
      }),
      prisma.habit.findMany({
        where: { userId, active: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true },
      }),
      prisma.habitCompletion.findMany({
        where: { userId, date: dayStart },
        select: { habitId: true, completed: true },
      }),
      prisma.trainingLog.findMany({
        where: { userId, date: { gte: dayStart, lt: nextDayStart } },
        orderBy: { date: "asc" },
        select: {
          exerciseName: true,
          sets: true,
          reps: true,
          weightKg: true,
          durationMin: true,
          distance: true,
          rating: true,
          notes: true,
          lifeArea: { select: { name: true } },
        },
      }),
    ]);

  const sections: string[] = [userCtx.text];

  // Completed activities WITH burned calories + notes. The metrics key is
  // `caloriesBurned` (activities/toggle/route.ts:84) — this block used to read a
  // non-existent `kcalBurned`, so the calorie figure never appeared.
  const done = (dayLog?.activities ?? []).filter((a) => a.completed);
  if (done.length > 0) {
    const lines = done.map((a) => {
      const m = a.metrics as { caloriesBurned?: number } | null;
      const kcal =
        typeof m?.caloriesBurned === "number" && m.caloriesBurned > 0
          ? `, ${m.caloriesBurned} kcal`
          : "";
      return `- ${a.name}${kcal}${a.notes ? ` — ${a.notes}` : ""}`;
    });
    sections.push(`## Ukonczone aktywnosci — szczegoly\n${lines.join("\n")}`);
  }

  // Meals of the summarized day
  const meals = dayLog?.meals ?? [];
  if (meals.length > 0) {
    const kcal = meals.reduce((s, m) => s + (m.calories ?? 0), 0);
    const protein = meals.reduce((s, m) => s + (m.protein ?? 0), 0);
    const carbs = meals.reduce((s, m) => s + (m.carbs ?? 0), 0);
    const fat = meals.reduce((s, m) => s + (m.fat ?? 0), 0);
    const list = meals.map(
      (m) => `  - ${m.time} ${m.name}${m.calories ? ` (${m.calories} kcal)` : ""}`
    );
    sections.push(
      `## Posilki tego dnia\n- Suma: ${kcal} kcal | B: ${protein.toFixed(0)}g W: ${carbs.toFixed(0)}g T: ${fat.toFixed(0)}g\n- Liczba posilkow: ${meals.length}\n${list.join("\n")}`
    );
  }

  // Per-habit tick for THIS day (the shared context only carries 7/30-day rates)
  if (habits.length > 0) {
    const doneMap = new Map(habitCompletions.map((c) => [c.habitId, c.completed]));
    const lines = habits.map(
      (h) => `- ${doneMap.get(h.id) === true ? "[x]" : "[ ]"} ${h.name}`
    );
    const doneCount = habits.filter((h) => doneMap.get(h.id) === true).length;
    sections.push(
      `## Nawyki tego dnia (${doneCount}/${habits.length} ukonczone)\n${lines.join("\n")}`
    );
  }

  // Training entries logged on this day
  if (trainingLogs.length > 0) {
    const lines = trainingLogs.map((t) => {
      const parts: string[] = [t.exerciseName];
      if (t.sets) parts.push(`${t.sets} serii`);
      if (t.reps) parts.push(`${t.reps} powt.`);
      if (t.weightKg) parts.push(`${t.weightKg}kg`);
      if (t.durationMin) parts.push(`${t.durationMin}min`);
      if (t.distance) parts.push(`${t.distance}km`);
      if (t.rating) parts.push(`ocena ${t.rating}/10`);
      const area = t.lifeArea?.name ? ` [${t.lifeArea.name}]` : "";
      return `- ${parts.join(", ")}${area}${t.notes ? ` — ${t.notes}` : ""}`;
    });
    sections.push(`## Treningi tego dnia\n${lines.join("\n")}`);
  }

  return sections.join("\n\n");
}

/**
 * Loads the last N briefings (content trimmed) for use as planning context.
 */
export async function loadRecentBriefings(
  userId: string,
  days: number,
  maxChars = 300
): Promise<Array<{ date: string; summary: string }>> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - days);

  const briefings = await prisma.briefing.findMany({
    where: { userId, date: { gte: since } },
    orderBy: { date: "desc" },
    take: days,
    select: { date: true, content: true },
  });

  return briefings.map((b) => ({
    date: b.date.toISOString().slice(0, 10),
    summary: b.content.slice(0, maxChars).trim(),
  }));
}
