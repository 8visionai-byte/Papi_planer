import { prisma } from "@/lib/db/prisma";

const DAY_NAMES_PL = [
  "niedziela",
  "poniedzialek",
  "wtorek",
  "sroda",
  "czwartek",
  "piatek",
  "sobota",
];

/**
 * Builds the evening-summary context. Aggregates everything that happened on
 * the target day (defaults to today): activities, meals, habits, training logs,
 * daily log, active goals.
 *
 * Pass `targetDate` to summarize a past day (used by /api/briefing/finalize
 * when a day has ended and we want to capture the full final picture).
 */
export async function buildBriefingContext(
  userId: string,
  targetDate?: Date
): Promise<string> {
  const base = targetDate ?? new Date();
  const todayStart = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const dayOfWeek = todayStart.getDay();

  const [
    profile,
    user,
    todayLog,
    habits,
    todayHabitCompletions,
    trainingLogs,
    activeGoals,
    activeMentors,
  ] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    }),
    prisma.dailyLog.findUnique({
      where: { userId_date: { userId, date: todayStart } },
      include: {
        activities: { include: { lifeArea: true } },
        meals: true,
      },
    }),
    prisma.habit.findMany({
      where: { userId, active: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.habitCompletion.findMany({
      where: { userId, date: todayStart },
    }),
    prisma.trainingLog.findMany({
      where: {
        userId,
        date: { gte: todayStart, lt: tomorrowStart },
      },
      include: { lifeArea: true },
      orderBy: { date: "asc" },
    }),
    prisma.goal.findMany({
      where: { userId, status: "active" },
      include: { mentor: { select: { name: true, avatarEmoji: true } } },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.mentor.findMany({
      where: { userId, active: true },
      orderBy: { sortOrder: "asc" },
      take: 4,
    }),
  ]);

  const sections: string[] = [];

  const firstName = user?.name?.split(" ")[0] ?? "Uzytkownik";
  sections.push(`## Dane uzytkownika\n- Imie: ${firstName}`);

  if (profile?.data) {
    const data = profile.data as Record<string, unknown>;
    const profileLines: string[] = [];
    if (data.age) profileLines.push(`- Wiek: ${data.age}`);
    if (data.goals) profileLines.push(`- Cele ogolne: ${data.goals}`);
    if (data.occupation) profileLines.push(`- Zawod: ${data.occupation}`);
    if (data.fitnessLevel) profileLines.push(`- Poziom fitness: ${data.fitnessLevel}`);
    if (profileLines.length > 0) {
      sections.push(`## Profil\n${profileLines.join("\n")}`);
    }
  }

  sections.push(
    `## Dzis\n- Data: ${todayStart.toISOString().split("T")[0]}\n- Dzien tygodnia: ${DAY_NAMES_PL[dayOfWeek]}`
  );

  // Daily log: energia / nastroj / sen
  if (todayLog) {
    const logLines: string[] = [];
    if (todayLog.energy != null) logLines.push(`- Energia: ${todayLog.energy}/10`);
    if (todayLog.mood) logLines.push(`- Nastroj: ${todayLog.mood}`);
    if (todayLog.sleepHours != null) logLines.push(`- Sen: ${todayLog.sleepHours}h`);
    if (todayLog.sleepQuality != null)
      logLines.push(`- Jakosc snu: ${todayLog.sleepQuality}/10`);
    if (todayLog.dayType) logLines.push(`- Typ dnia: ${todayLog.dayType}`);
    if (logLines.length > 0) {
      sections.push(`## Stan dnia\n${logLines.join("\n")}`);
    }
  }

  // Aktywnosci dzisiejsze (completed / uncompleted)
  if (todayLog?.activities && todayLog.activities.length > 0) {
    const completedItems = todayLog.activities.filter((a) => a.completed);
    const uncompletedItems = todayLog.activities.filter((a) => !a.completed);

    const activityLines: string[] = [];
    activityLines.push(
      `- Wykonane: ${completedItems.length}/${todayLog.activities.length}`
    );
    if (completedItems.length > 0) {
      activityLines.push("### Ukonczone:");
      completedItems.forEach((a) => {
        const kcal =
          a.metrics && typeof a.metrics === "object" && "kcalBurned" in a.metrics
            ? `, ${(a.metrics as { kcalBurned?: number }).kcalBurned} kcal`
            : "";
        const note = a.notes ? ` — ${a.notes}` : "";
        activityLines.push(`  - ${a.name}${kcal}${note}`);
      });
    }
    if (uncompletedItems.length > 0) {
      activityLines.push("### Nieukonczone:");
      uncompletedItems.forEach((a) => {
        activityLines.push(`  - ${a.name}${a.notes ? ` — ${a.notes}` : ""}`);
      });
    }
    sections.push(`## Aktywnosci dzisiaj\n${activityLines.join("\n")}`);
  } else {
    sections.push(`## Aktywnosci dzisiaj\nBrak zarejestrowanych aktywnosci.`);
  }

  // Posilki
  if (todayLog?.meals && todayLog.meals.length > 0) {
    const totalKcal = todayLog.meals.reduce((s, m) => s + (m.calories ?? 0), 0);
    const totalProtein = todayLog.meals.reduce((s, m) => s + (m.protein ?? 0), 0);
    const totalCarbs = todayLog.meals.reduce((s, m) => s + (m.carbs ?? 0), 0);
    const totalFat = todayLog.meals.reduce((s, m) => s + (m.fat ?? 0), 0);
    const mealList = todayLog.meals.map((m) => `  - ${m.time} ${m.name}${m.calories ? ` (${m.calories} kcal)` : ""}`);
    sections.push(
      `## Posilki dzisiaj\n- Suma: ${totalKcal} kcal | B: ${totalProtein.toFixed(0)}g W: ${totalCarbs.toFixed(0)}g T: ${totalFat.toFixed(0)}g\n- Liczba posilkow: ${todayLog.meals.length}\n${mealList.join("\n")}`
    );
  }

  // Nawyki
  if (habits.length > 0) {
    const completionMap = new Map(
      todayHabitCompletions.map((c) => [c.habitId, c.completed])
    );
    const habitLines = habits.map((h) => {
      const done = completionMap.get(h.id) === true;
      return `- ${done ? "[x]" : "[ ]"} ${h.name}`;
    });
    const doneCount = habits.filter((h) => completionMap.get(h.id) === true).length;
    sections.push(
      `## Nawyki (${doneCount}/${habits.length} ukonczone)\n${habitLines.join("\n")}`
    );
  }

  // Treningi
  if (trainingLogs.length > 0) {
    const tlLines = trainingLogs.map((t) => {
      const parts: string[] = [t.exerciseName];
      if (t.sets) parts.push(`${t.sets} serii`);
      if (t.reps) parts.push(`${t.reps} powt.`);
      if (t.weightKg) parts.push(`${t.weightKg}kg`);
      if (t.durationMin) parts.push(`${t.durationMin}min`);
      if (t.distance) parts.push(`${t.distance}km`);
      if (t.rating) parts.push(`ocena ${t.rating}/10`);
      const areaName = t.lifeArea?.name ? ` [${t.lifeArea.name}]` : "";
      const noteStr = t.notes ? ` — ${t.notes}` : "";
      return `- ${parts.join(", ")}${areaName}${noteStr}`;
    });
    sections.push(`## Treningi dzisiaj\n${tlLines.join("\n")}`);
  }

  // Aktywne cele + postep
  if (activeGoals.length > 0) {
    const goalLines = activeGoals.map((g) => {
      const mentorTag = g.mentor ? ` (mentor: ${g.mentor.name})` : "";
      const deadline = g.targetDate
        ? `, do ${g.targetDate.toISOString().slice(0, 10)}`
        : "";
      return `- ${g.title} — ${g.progress}%${deadline}${mentorTag}`;
    });
    sections.push(`## Aktywne cele\n${goalLines.join("\n")}`);
  }

  // Aktywni mentorzy — zeby model wiedzial jakimi glosami moze mowic
  if (activeMentors.length > 0) {
    const mentorLines = activeMentors.map(
      (m) =>
        `- ${m.avatarEmoji ?? ""} ${m.name} (${m.role})${m.style ? ` — styl: ${m.style}` : ""}`
    );
    sections.push(
      `## Aktywni mentorzy (uzyj 2-3 z nich dla refleksji)\n${mentorLines.join("\n")}`
    );
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
