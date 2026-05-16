import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS } from "@/lib/ai/claude";

export interface GeneratedWeekPlan {
  weekNumber: number;
  tasks: Array<{ title: string; done: boolean }>;
}

export interface GenerateMentorPlanResult {
  plans: GeneratedWeekPlan[];
  mentorId: string;
}

export async function generateMentorPlanForGoal(
  goalId: string,
  userId: string
): Promise<GenerateMentorPlanResult | null> {
  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: {
      id: true,
      userId: true,
      mentorId: true,
      lifeAreaId: true,
      title: true,
      description: true,
      targetDate: true,
    },
  });

  if (!goal || goal.userId !== userId) {
    return null;
  }

  // Resolve mentor: explicit → lifeArea match → any active mentor
  let mentor = null as Awaited<ReturnType<typeof prisma.mentor.findFirst>> | null;

  if (goal.mentorId) {
    mentor = await prisma.mentor.findFirst({
      where: { id: goal.mentorId, userId, active: true },
    });
  }

  if (!mentor && goal.lifeAreaId) {
    mentor = await prisma.mentor.findFirst({
      where: {
        userId,
        active: true,
        lifeAreas: { some: { id: goal.lifeAreaId } },
      },
      orderBy: { sortOrder: "asc" },
    });
  }

  if (!mentor) {
    mentor = await prisma.mentor.findFirst({
      where: { userId, active: true },
      orderBy: { sortOrder: "asc" },
    });
  }

  if (!mentor) {
    return null;
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { data: true },
  });

  const profileJson = profile?.data ? JSON.stringify(profile.data) : "{}";
  const targetDateStr = goal.targetDate
    ? goal.targetDate.toISOString().slice(0, 10)
    : "brak";
  const descStr = goal.description?.trim() || "brak";

  const userMsg =
    `Cel: ${goal.title}. ` +
    `Opis: ${descStr}. ` +
    `Termin: ${targetDateStr}. ` +
    `Profil: ${profileJson}. ` +
    `Wygeneruj 4-tygodniowy plan działania. ` +
    `Format JSON: [{"weekNumber":1,"tasks":[{"title":"...","done":false}]}, ...]. ` +
    `Każdy tydzień 3-5 zadań konkretnych. Tylko JSON, bez komentarzy.`;

  const response = await anthropic.messages.create({
    model: mentor.model || MODELS.CHAT,
    max_tokens: 2000,
    system: mentor.systemPrompt,
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return null;
  }

  const raw = textBlock.text;
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  const plans: GeneratedWeekPlan[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const weekNumber = Number(obj.weekNumber);
    if (!Number.isFinite(weekNumber) || weekNumber < 1 || weekNumber > 12) continue;
    const tasksRaw = Array.isArray(obj.tasks) ? obj.tasks : [];
    const tasks = tasksRaw
      .map((t) => {
        if (!t || typeof t !== "object") return null;
        const tObj = t as Record<string, unknown>;
        const title = typeof tObj.title === "string" ? tObj.title.trim() : "";
        if (!title) return null;
        return { title, done: tObj.done === true };
      })
      .filter((t): t is { title: string; done: boolean } => t !== null);
    if (tasks.length === 0) continue;
    plans.push({ weekNumber, tasks });
  }

  if (plans.length === 0) {
    return null;
  }

  // Persist mentorId on goal if it wasn't set
  if (!goal.mentorId) {
    await prisma.goal.update({
      where: { id: goal.id },
      data: { mentorId: mentor.id },
    });
  }

  const mentorId = mentor.id;
  const phaseForWeek = (w: number) => Math.max(1, Math.ceil(w / 4));

  await Promise.all(
    plans.map((p) =>
      prisma.mentorPlan.upsert({
        where: {
          mentorId_userId_weekNumber: {
            mentorId,
            userId,
            weekNumber: p.weekNumber,
          },
        },
        update: {
          tasks: p.tasks,
          phase: phaseForWeek(p.weekNumber),
        },
        create: {
          mentorId,
          userId,
          weekNumber: p.weekNumber,
          phase: phaseForWeek(p.weekNumber),
          tasks: p.tasks,
        },
      })
    )
  );

  return { plans, mentorId };
}
