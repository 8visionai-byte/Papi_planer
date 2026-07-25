import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS } from "@/lib/ai/claude";
import { buildUserContext } from "@/lib/ai/user-context";

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

  const duration = activity.durationMin ?? 0;

  // Context source: src/lib/ai/user-context.ts (scope "activity-plan"), narrowed to
  // this activity's life area — so the mentor sees the personal records and the last
  // sessions of THIS discipline, not just a raw profile JSON and 3 briefings.
  const userCtx = await buildUserContext(userId, {
    scope: "activity-plan",
    lifeAreaId: activity.lifeAreaId,
  });

  const userMsg =
    `${userCtx.text}\n\n` +
    `Aktywność: ${activity.name}, Typ: ${activity.type}, Czas: ${duration} min. ` +
    `Wygeneruj konkretny plan treningu — serie/powtórzenia/technika/cele. ` +
    `Obciążenia i tempo wyprowadź z rekordów i ostatnich treningów w kontekście, nie zgaduj. ` +
    `Dostosuj trudność/intensywność do tego co widzisz w ostatnich dniach. Krótko, max 500 znaków.`;

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
