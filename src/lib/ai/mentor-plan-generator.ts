import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS } from "@/lib/ai/claude";

export interface GeneratedWeekPlan {
  weekNumber: number;
  tasks: Array<{ title: string; done: boolean }>;
}

export interface ClarifyingQuestionsResult {
  questions: string[];
  mentorId: string;
  mentorName: string;
}

export interface GenerateMentorPlanResult {
  plans: GeneratedWeekPlan[];
  mentorId: string;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

type GoalRow = {
  id: string;
  userId: string;
  mentorId: string | null;
  lifeAreaId: string | null;
  title: string;
  description: string | null;
  targetDate: Date | null;
};

type MentorRow = NonNullable<Awaited<ReturnType<typeof prisma.mentor.findFirst>>>;

async function loadGoal(goalId: string, userId: string): Promise<GoalRow | null> {
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
  if (!goal || goal.userId !== userId) return null;
  return goal;
}

async function resolveMentor(
  goal: GoalRow,
  userId: string,
  explicitMentorId?: string
): Promise<MentorRow | null> {
  // Explicit mentorId from caller takes precedence
  if (explicitMentorId) {
    const m = await prisma.mentor.findFirst({
      where: { id: explicitMentorId, userId, active: true },
    });
    if (m) return m;
  }

  // Goal's stored mentorId
  if (goal.mentorId) {
    const m = await prisma.mentor.findFirst({
      where: { id: goal.mentorId, userId, active: true },
    });
    if (m) return m;
  }

  // LifeArea match
  if (goal.lifeAreaId) {
    const m = await prisma.mentor.findFirst({
      where: {
        userId,
        active: true,
        lifeAreas: { some: { id: goal.lifeAreaId } },
      },
      orderBy: { sortOrder: "asc" },
    });
    if (m) return m;
  }

  // Any active mentor
  const fallback = await prisma.mentor.findFirst({
    where: { userId, active: true },
    orderBy: { sortOrder: "asc" },
  });
  return fallback;
}

function describeGoal(goal: GoalRow): string {
  const targetDateStr = goal.targetDate
    ? goal.targetDate.toISOString().slice(0, 10)
    : "brak";
  const descStr = goal.description?.trim() || "brak";
  return `Cel: ${goal.title}\nOpis: ${descStr}\nTermin: ${targetDateStr}`;
}

/* ------------------------------------------------------------------ */
/*  Step 1 — Clarifying questions                                      */
/* ------------------------------------------------------------------ */

export async function generateClarifyingQuestions(
  goalId: string,
  userId: string
): Promise<ClarifyingQuestionsResult | null> {
  const goal = await loadGoal(goalId, userId);
  if (!goal) return null;

  const mentor = await resolveMentor(goal, userId);
  if (!mentor) return null;

  const userMsg =
    `Twój podopieczny chce osiągnąć następujący cel:\n\n` +
    `${describeGoal(goal)}\n\n` +
    `Zanim stworzysz mu szczegółowy plan, zadaj 3-5 KRÓTKICH, KONKRETNYCH pytań doprecyzowujących. ` +
    `Pytania powinny dotyczyć: obecnego poziomu / formy, dostępnego czasu tygodniowo, ograniczeń (kontuzje, zasoby, sprzęt), priorytetów (np. szybkość vs bezpieczeństwo), preferencji dotyczących stylu pracy. ` +
    `Pytania mają być konkretne dla TEGO celu, nie ogólne.\n\n` +
    `Zwróć wyłącznie poprawny JSON w formacie:\n` +
    `{"questions":["Pytanie 1?","Pytanie 2?","Pytanie 3?"]}\n\n` +
    `Bez komentarzy, bez markdown, bez żadnego tekstu poza JSON-em.`;

  // Persist mentorId on goal so the second step keeps the same mentor
  if (!goal.mentorId) {
    await prisma.goal.update({
      where: { id: goal.id },
      data: { mentorId: mentor.id },
    });
  }

  const response = await anthropic.messages.create({
    model: mentor.model || MODELS.CHAT,
    max_tokens: 800,
    system: mentor.systemPrompt,
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;

  const raw = textBlock.text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.questions)) return null;

  const questions = obj.questions
    .map((q) => (typeof q === "string" ? q.trim() : ""))
    .filter((q) => q.length > 0)
    .slice(0, 5);

  if (questions.length === 0) return null;

  return {
    questions,
    mentorId: mentor.id,
    mentorName: mentor.name,
  };
}

/* ------------------------------------------------------------------ */
/*  Step 2 — Plan from answers                                         */
/* ------------------------------------------------------------------ */

export async function generatePlanFromAnswers(
  goalId: string,
  userId: string,
  mentorId: string,
  answers: Array<{ question: string; answer: string }>
): Promise<GenerateMentorPlanResult | null> {
  const goal = await loadGoal(goalId, userId);
  if (!goal) return null;

  const mentor = await resolveMentor(goal, userId, mentorId);
  if (!mentor) return null;

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { data: true },
  });

  const profileJson = profile?.data ? JSON.stringify(profile.data) : "{}";

  const qaBlock =
    answers.length > 0
      ? answers
          .map(
            (qa, i) =>
              `${i + 1}. P: ${qa.question.trim()}\n   O: ${qa.answer.trim() || "brak odpowiedzi"}`
          )
          .join("\n")
      : "(brak odpowiedzi)";

  const userMsg =
    `Twój podopieczny ma cel:\n\n` +
    `${describeGoal(goal)}\n\n` +
    `Profil użytkownika: ${profileJson}\n\n` +
    `Zadałeś mu pytania doprecyzowujące i otrzymałeś następujące odpowiedzi:\n\n` +
    `${qaBlock}\n\n` +
    `Na podstawie powyższego kontekstu wygeneruj 4-tygodniowy plan działania dopasowany do TEGO konkretnego użytkownika i jego odpowiedzi. ` +
    `Każdy tydzień powinien zawierać 3-5 konkretnych, mierzalnych zadań.\n\n` +
    `Zwróć WYŁĄCZNIE poprawny JSON (tablica), bez komentarzy, bez markdown:\n` +
    `[{"weekNumber":1,"tasks":[{"title":"Konkretne zadanie","done":false}]},{"weekNumber":2,"tasks":[...]},{"weekNumber":3,"tasks":[...]},{"weekNumber":4,"tasks":[...]}]`;

  const response = await anthropic.messages.create({
    model: mentor.model || MODELS.CHAT,
    max_tokens: 3000,
    system: mentor.systemPrompt,
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;

  const raw = textBlock.text;
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

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

  if (plans.length === 0) return null;

  // Persist mentorId on goal if not yet set
  if (!goal.mentorId) {
    await prisma.goal.update({
      where: { id: goal.id },
      data: { mentorId: mentor.id },
    });
  }

  const resolvedMentorId = mentor.id;
  const phaseForWeek = (w: number) => Math.max(1, Math.ceil(w / 4));

  await Promise.all(
    plans.map((p) =>
      prisma.mentorPlan.upsert({
        where: {
          mentorId_userId_weekNumber: {
            mentorId: resolvedMentorId,
            userId,
            weekNumber: p.weekNumber,
          },
        },
        update: {
          tasks: p.tasks,
          phase: phaseForWeek(p.weekNumber),
        },
        create: {
          mentorId: resolvedMentorId,
          userId,
          weekNumber: p.weekNumber,
          phase: phaseForWeek(p.weekNumber),
          tasks: p.tasks,
        },
      })
    )
  );

  return { plans, mentorId: resolvedMentorId };
}

/* ------------------------------------------------------------------ */
/*  Legacy single-step (kept for backward compatibility callers)       */
/* ------------------------------------------------------------------ */

export async function generateMentorPlanForGoal(
  goalId: string,
  userId: string
): Promise<GenerateMentorPlanResult | null> {
  // One-shot fallback used when a caller (e.g. goal creation) wants a plan
  // without going through the interactive 2-step flow.
  const goal = await loadGoal(goalId, userId);
  if (!goal) return null;

  const mentor = await resolveMentor(goal, userId);
  if (!mentor) return null;

  // Skip the questions and go straight to plan with empty answers
  return generatePlanFromAnswers(goalId, userId, mentor.id, []);
}
