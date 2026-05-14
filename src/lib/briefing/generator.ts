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

export async function buildBriefingContext(userId: string): Promise<string> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const dayOfWeek = now.getDay(); // 0=Sun
  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Parallel queries
  const [profile, schedule, yesterdayLog, weeklyCheckin, lifeAreas, lastBriefing, user] =
    await Promise.all([
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.schedule.findMany({
        where: { userId, dayOfWeek },
        include: { lifeArea: true },
        orderBy: { time: "asc" },
      }),
      prisma.dailyLog.findUnique({
        where: { userId_date: { userId, date: yesterdayStart } },
        include: { activities: true, meals: true },
      }),
      prisma.weeklyCheckin.findFirst({
        where: { userId, date: { gte: sevenDaysAgo } },
        orderBy: { date: "desc" },
      }),
      prisma.lifeArea.findMany({
        where: { userId, active: true },
        orderBy: { priority: "desc" },
      }),
      prisma.briefing.findFirst({
        where: { userId },
        orderBy: { date: "desc" },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      }),
    ]);

  const sections: string[] = [];

  // User info
  const firstName = user?.name?.split(" ")[0] ?? "Uzytkownik";
  sections.push(`## Dane uzytkownika\n- Imie: ${firstName}`);

  if (profile?.data) {
    const data = profile.data as Record<string, unknown>;
    const profileLines: string[] = [];
    if (data.age) profileLines.push(`- Wiek: ${data.age}`);
    if (data.goals) profileLines.push(`- Cele: ${data.goals}`);
    if (data.occupation) profileLines.push(`- Zawod: ${data.occupation}`);
    if (data.fitnessLevel) profileLines.push(`- Poziom fitness: ${data.fitnessLevel}`);
    if (profileLines.length > 0) {
      sections.push(`## Profil\n${profileLines.join("\n")}`);
    }
  }

  // Today's date/day
  sections.push(
    `## Dzis\n- Data: ${todayStart.toISOString().split("T")[0]}\n- Dzien tygodnia: ${DAY_NAMES_PL[dayOfWeek]}`
  );

  // Schedule for today
  if (schedule.length > 0) {
    const scheduleLines = schedule.map(
      (s) =>
        `- ${s.time} — ${s.activityName}${s.lifeArea ? ` (${s.lifeArea.name})` : ""}${s.notes ? ` [${s.notes}]` : ""}`
    );
    sections.push(`## Plan na dzis\n${scheduleLines.join("\n")}`);
  } else {
    sections.push("## Plan na dzis\nBrak zaplanowanych aktywnosci.");
  }

  // Yesterday's log
  if (yesterdayLog) {
    const logLines: string[] = [];
    if (yesterdayLog.energy != null) logLines.push(`- Energia: ${yesterdayLog.energy}/10`);
    if (yesterdayLog.mood) logLines.push(`- Nastroj: ${yesterdayLog.mood}`);
    if (yesterdayLog.sleepHours != null) logLines.push(`- Sen: ${yesterdayLog.sleepHours}h`);
    if (yesterdayLog.sleepQuality != null)
      logLines.push(`- Jakosc snu: ${yesterdayLog.sleepQuality}/10`);
    if (yesterdayLog.dayType) logLines.push(`- Typ dnia: ${yesterdayLog.dayType}`);

    if (yesterdayLog.activities.length > 0) {
      const completed = yesterdayLog.activities.filter((a) => a.completed).length;
      const total = yesterdayLog.activities.length;
      logLines.push(`- Aktywnosci: ${completed}/${total} ukonczone`);
      const unfinished = yesterdayLog.activities
        .filter((a) => !a.completed)
        .map((a) => a.name);
      if (unfinished.length > 0) {
        logLines.push(`- Nieukonczone: ${unfinished.join(", ")}`);
      }
    }

    sections.push(`## Wczorajsze dane\n${logLines.join("\n")}`);
  } else {
    sections.push("## Wczorajsze dane\nBrak danych z wczoraj (pierwszy dzien lub przerwa).");
  }

  // Weekly checkin
  if (weeklyCheckin) {
    const wcLines: string[] = [];
    if (weeklyCheckin.weight) wcLines.push(`- Waga: ${weeklyCheckin.weight} kg`);
    if (weeklyCheckin.energyAvg) wcLines.push(`- Srednia energia: ${weeklyCheckin.energyAvg}/10`);
    if (weeklyCheckin.wins) wcLines.push(`- Sukcesy: ${weeklyCheckin.wins}`);
    if (weeklyCheckin.fails) wcLines.push(`- Wyzwania: ${weeklyCheckin.fails}`);
    if (wcLines.length > 0) {
      sections.push(`## Ostatni weekly check-in (tydzien ${weeklyCheckin.weekNumber})\n${wcLines.join("\n")}`);
    }
  }

  // Life areas
  if (lifeAreas.length > 0) {
    const areaLines = lifeAreas.map(
      (a) =>
        `- ${a.name}${a.category ? ` [${a.category}]` : ""}${a.description ? `: ${a.description}` : ""}`
    );
    sections.push(`## Aktywne obszary zycia\n${areaLines.join("\n")}`);
  }

  // Phase/week from last briefing
  if (lastBriefing?.phase != null) {
    sections.push(
      `## Faza transformacji\n- Faza: ${lastBriefing.phase}\n- Tydzien: ${lastBriefing.week ?? "?"}`
    );
  }

  return sections.join("\n\n");
}
