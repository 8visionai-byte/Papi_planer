import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS } from "@/lib/ai/claude";

export async function generateActivityPlan(
  activityId: string,
  userId: string
): Promise<string | null> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: { dailyLog: { select: { userId: true } } },
  });

  if (!activity || activity.dailyLog.userId !== userId || !activity.lifeAreaId) {
    return null;
  }

  const mentor = await prisma.mentor.findFirst({
    where: {
      userId,
      active: true,
      lifeAreas: { some: { id: activity.lifeAreaId } },
    },
    select: { systemPrompt: true, model: true, name: true },
  });

  if (!mentor) {
    return null;
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { data: true },
  });

  const profileJson = profile?.data ? JSON.stringify(profile.data) : "{}";
  const duration = activity.durationMin ?? 0;

  const userMsg = `Aktywność: ${activity.name}, Typ: ${activity.type}, Czas: ${duration} min. Profil użytkownika: ${profileJson}. Wygeneruj konkretny plan treningu — serie/powtórzenia/technika/cele. Krótko, max 500 znaków.`;

  const response = await anthropic.messages.create({
    model: mentor.model || MODELS.CHAT,
    max_tokens: 800,
    system: mentor.systemPrompt,
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return null;
  }

  return textBlock.text.trim();
}
