import { prisma } from "@/lib/db/prisma";
import { subDays, format } from "date-fns";
import { pl } from "date-fns/locale";

export interface MentorContext {
  systemPrompt: string;
  userContext: string;
  mentorName: string;
  mentorRole: string;
}

export async function buildMentorContext(
  mentorId: string,
  userId: string
): Promise<MentorContext> {
  const sevenDaysAgo = subDays(new Date(), 7);

  const [mentor, userProfile, recentLogs] = await Promise.all([
    prisma.mentor.findUnique({
      where: { id: mentorId },
      include: { lifeAreas: true },
    }),
    prisma.userProfile.findUnique({
      where: { userId },
    }),
    prisma.dailyLog.findMany({
      where: {
        userId,
        date: { gte: sevenDaysAgo },
      },
      orderBy: { date: "desc" },
      include: {
        activities: true,
        meals: true,
      },
    }),
  ]);

  if (!mentor) {
    throw new Error(`Mentor ${mentorId} not found`);
  }

  if (mentor.userId !== userId) {
    throw new Error("Unauthorized access to mentor");
  }

  // Build user context string
  const contextParts: string[] = [];

  // Profile data
  if (userProfile?.data) {
    const data = userProfile.data as Record<string, unknown>;
    contextParts.push(
      `## Profil użytkownika\n${JSON.stringify(data, null, 2)}`
    );
  }

  // Life areas this mentor covers
  if (mentor.lifeAreas.length > 0) {
    const areas = mentor.lifeAreas
      .map((a) => `- ${a.name}${a.description ? `: ${a.description}` : ""}`)
      .join("\n");
    contextParts.push(`## Obszary życia mentora\n${areas}`);
  }

  // Recent daily logs
  if (recentLogs.length > 0) {
    const logsSummary = recentLogs
      .map((log) => {
        const dateStr = format(log.date, "EEEE, d MMMM", { locale: pl });
        const parts = [`### ${dateStr}`];
        if (log.energy != null) parts.push(`Energia: ${log.energy}/10`);
        if (log.mood) parts.push(`Nastrój: ${log.mood}`);
        if (log.sleepHours != null)
          parts.push(`Sen: ${log.sleepHours}h (jakość: ${log.sleepQuality ?? "?"})/10`);
        if (log.dayType) parts.push(`Typ dnia: ${log.dayType}`);

        if (log.activities.length > 0) {
          const acts = log.activities
            .map(
              (a) =>
                `- ${a.name} ${a.completed ? "[done]" : "[pending]"}${a.notes ? ` — ${a.notes}` : ""}`
            )
            .join("\n");
          parts.push(`Aktywności:\n${acts}`);
        }

        if (log.meals.length > 0) {
          const mealsStr = log.meals
            .map((m) => `- ${m.name}${m.calories ? ` (${m.calories} kcal)` : ""}`)
            .join("\n");
          parts.push(`Posiłki:\n${mealsStr}`);
        }

        return parts.join("\n");
      })
      .join("\n\n");

    contextParts.push(`## Ostatnie 7 dni\n${logsSummary}`);
  }

  return {
    systemPrompt: mentor.systemPrompt,
    userContext: contextParts.join("\n\n"),
    mentorName: mentor.name,
    mentorRole: mentor.role,
  };
}
