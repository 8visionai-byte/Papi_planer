import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS } from "@/lib/ai/claude";
import { loadRecentBriefings } from "@/lib/briefing/generator";

/**
 * Formats the last `days` of briefings as a human-readable block for prompt context.
 * Returns an empty string when there are no briefings to share.
 */
async function buildRecentBriefingsBlock(
  userId: string,
  days: number,
  maxChars = 300
): Promise<string> {
  const briefings = await loadRecentBriefings(userId, days, maxChars);
  if (briefings.length === 0) return "";
  const lines = briefings.map(
    (b) => `### ${b.date}\n${b.summary}${b.summary.length >= maxChars ? "..." : ""}`
  );
  return (
    `Ostatnie podsumowania dnia (zobaczy kontekst):\n\n` + lines.join("\n\n")
  );
}

export interface PlanTask {
  title: string;
  done: boolean;
  feedback?: string;
}

export interface GeneratedWeekPlan {
  weekNumber: number;
  tasks: PlanTask[];
}

export interface ClarifyingQuestion {
  question: string;
  mentorId: string;
  mentorName: string;
  mentorEmoji: string | null;
}

export interface ClarifyingQuestionsResult {
  /** Flat list — each entry tagged with the mentor that asked it. */
  questions: ClarifyingQuestion[];
  /** Primary mentor id (first in the list); persisted onto the goal. */
  mentorId: string;
  /** Primary mentor name (for legacy callers / UI fallback). */
  mentorName: string;
  /** Every mentor that contributed. */
  mentors: Array<{ id: string; name: string; avatarEmoji: string | null }>;
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
  mentorIds: string[];
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
      mentorIds: true,
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
  if (explicitMentorId) {
    const m = await prisma.mentor.findFirst({
      where: { id: explicitMentorId, userId, active: true },
    });
    if (m) return m;
  }

  if (goal.mentorId) {
    const m = await prisma.mentor.findFirst({
      where: { id: goal.mentorId, userId, active: true },
    });
    if (m) return m;
  }

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

  const fallback = await prisma.mentor.findFirst({
    where: { userId, active: true },
    orderBy: { sortOrder: "asc" },
  });
  return fallback;
}

/**
 * Resolves a list of mentors.
 * Priority: explicit IDs from caller → goal.mentorIds → goal.mentorId → fallback.
 */
async function resolveMentors(
  goal: GoalRow,
  userId: string,
  explicitMentorIds: string[] | undefined
): Promise<MentorRow[]> {
  const explicit = (explicitMentorIds || []).map((s) => s.trim()).filter(Boolean);
  const fromGoal = (goal.mentorIds || []).map((s) => s.trim()).filter(Boolean);
  const candidates = explicit.length > 0 ? explicit : fromGoal;

  if (candidates.length > 0) {
    const rows = await prisma.mentor.findMany({
      where: { id: { in: candidates }, userId, active: true },
    });
    const byId = new Map(rows.map((m) => [m.id, m]));
    const ordered = candidates.map((id) => byId.get(id)).filter((m): m is MentorRow => !!m);
    if (ordered.length > 0) return ordered;
  }

  // Fallback: legacy single mentor / lifeArea-based / first active mentor
  const single = await resolveMentor(goal, userId);
  return single ? [single] : [];
}

function describeGoal(goal: GoalRow): string {
  const targetDateStr = goal.targetDate
    ? goal.targetDate.toISOString().slice(0, 10)
    : "brak";
  const descStr = goal.description?.trim() || "brak";
  return `Cel: ${goal.title}\nOpis: ${descStr}\nTermin: ${targetDateStr}`;
}

/**
 * Pull existing MentorPlan rows scoped to THIS goal (per-goal isolation),
 * for the given mentor(s) + user. Falls back to legacy plans (goalId null)
 * only if there are zero per-goal rows — so we don't lose prior feedback.
 */
async function loadExistingPlans(
  goalId: string,
  mentorIds: string[],
  userId: string
) {
  if (mentorIds.length === 0) return [];
  const scoped = await prisma.mentorPlan.findMany({
    where: { userId, mentorId: { in: mentorIds }, goalId },
    orderBy: [{ mentorId: "asc" }, { weekNumber: "asc" }],
  });
  if (scoped.length > 0) return scoped;
  // Legacy fallback: plans created before goalId existed
  return prisma.mentorPlan.findMany({
    where: { userId, mentorId: { in: mentorIds }, goalId: null },
    orderBy: [{ mentorId: "asc" }, { weekNumber: "asc" }],
  });
}

/** Build a prompt block describing prior user feedback on tasks. */
function buildPriorFeedbackBlock(
  plans: Awaited<ReturnType<typeof loadExistingPlans>>
): string {
  const items: string[] = [];
  for (const p of plans) {
    const tasks = Array.isArray(p.tasks) ? (p.tasks as unknown as PlanTask[]) : [];
    for (const t of tasks) {
      if (t.feedback && t.feedback.trim().length > 0) {
        const status = t.done ? "ZROBIONE" : "DO ZROBIENIA";
        items.push(`- [${status}] "${t.title}" — uwaga użytkownika: ${t.feedback.trim()}`);
      }
    }
  }
  if (items.length === 0) return "";
  return (
    `Wcześniejsze uwagi użytkownika do zadań z poprzednich wersji planu:\n` +
    items.join("\n") +
    `\n\nUwzględnij te uwagi — nie powielaj zadań, które okazały się za trudne / niepotrzebne, ` +
    `i dostosuj nowe zadania do feedbacku.`
  );
}

/**
 * Build the "done tasks to preserve" lookup keyed by `weekNumber -> Set<title>`.
 * Used so a regenerated plan keeps existing completed tasks intact.
 */
function buildDoneTaskIndex(
  plans: Awaited<ReturnType<typeof loadExistingPlans>>,
  mentorId: string
): Map<number, PlanTask[]> {
  const index = new Map<number, PlanTask[]>();
  for (const p of plans) {
    if (p.mentorId !== mentorId) continue;
    const tasks = Array.isArray(p.tasks) ? (p.tasks as unknown as PlanTask[]) : [];
    const doneOnly = tasks.filter((t) => t.done === true);
    if (doneOnly.length > 0) index.set(p.weekNumber, doneOnly);
  }
  return index;
}

/* ------------------------------------------------------------------ */
/*  Step 1 — Clarifying questions                                      */
/* ------------------------------------------------------------------ */

const SOLO_QUESTIONS_PROMPT_TAIL =
  `Zanim stworzysz mu szczegółowy plan, zadaj 3-5 KRÓTKICH, KONKRETNYCH pytań doprecyzowujących. ` +
  `Pytania powinny dotyczyć: obecnego poziomu / formy, dostępnego czasu tygodniowo, ograniczeń ` +
  `(kontuzje, zasoby, sprzęt), priorytetów, preferencji dotyczących stylu pracy. ` +
  `Pytania mają być konkretne dla TEGO celu, nie ogólne.\n\n` +
  `Zwróć WYŁĄCZNIE poprawny JSON w formacie:\n` +
  `{"questions":["Pytanie 1?","Pytanie 2?","Pytanie 3?"]}\n\n` +
  `Bez komentarzy, bez markdown, bez żadnego tekstu poza JSON-em.`;

const COLLAB_QUESTIONS_PROMPT_TAIL =
  `Pracujesz z innymi mentorami, którzy też zadają pytania. ZADAJ TYLKO 2-3 KRÓTKIE, KONKRETNE pytania ` +
  `Z TWOJEJ specjalizacji — nie powielaj tematów, które są oczywiste dla innych mentorów. ` +
  `Skup się na tym, co tylko TY musisz wiedzieć, by ułożyć dobry plan.\n\n` +
  `Zwróć WYŁĄCZNIE poprawny JSON w formacie:\n` +
  `{"questions":["Pytanie 1?","Pytanie 2?"]}\n\n` +
  `Bez komentarzy, bez markdown, bez żadnego tekstu poza JSON-em.`;

async function askMentorForQuestions(
  mentor: MentorRow,
  goal: GoalRow,
  recentBriefings: string,
  solo: boolean,
  priorFeedback: string,
  alreadyAsked: string[]
): Promise<string[]> {
  const dedupBlock =
    alreadyAsked.length > 0
      ? `Inni mentorzy zadali już TE pytania (NIE powielaj ich, nawet w innym brzmieniu — zadaj rzeczy z TWOJEJ specjalizacji, których jeszcze nikt nie zapytał):\n` +
        alreadyAsked.map((q, i) => `${i + 1}. ${q}`).join("\n") +
        `\n\n`
      : "";

  const userMsg =
    `Twój podopieczny chce osiągnąć następujący cel:\n\n` +
    `${describeGoal(goal)}\n\n` +
    (recentBriefings ? `${recentBriefings}\n\n` : ``) +
    (priorFeedback ? `${priorFeedback}\n\n` : ``) +
    dedupBlock +
    (solo ? SOLO_QUESTIONS_PROMPT_TAIL : COLLAB_QUESTIONS_PROMPT_TAIL);

  let response;
  try {
    response = await anthropic.messages.create({
      model: mentor.model || MODELS.CHAT,
      max_tokens: 800,
      system: mentor.systemPrompt,
      messages: [{ role: "user", content: userMsg }],
    });
  } catch (err) {
    console.error(`[mentor-plan-generator] mentor ${mentor.id} questions failed`, err);
    return [];
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return [];

  const raw = textBlock.text;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }

  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.questions)) return [];

  return obj.questions
    .map((q) => (typeof q === "string" ? q.trim() : ""))
    .filter((q) => q.length > 0)
    .slice(0, solo ? 5 : 3);
}

/**
 * Lightweight token-overlap dedupe — drop later questions whose normalized
 * token set overlaps >70% with any previously accepted question.
 */
function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[?.!,;:]/g, "").trim();
}
function tokenSet(q: string): Set<string> {
  return new Set(
    normalizeQuestion(q)
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}
function isDuplicate(candidate: string, accepted: string[]): boolean {
  const c = tokenSet(candidate);
  if (c.size === 0) return false;
  for (const a of accepted) {
    const aSet = tokenSet(a);
    if (aSet.size === 0) continue;
    let overlap = 0;
    for (const w of c) if (aSet.has(w)) overlap += 1;
    const smaller = Math.min(c.size, aSet.size);
    if (smaller === 0) continue;
    if (overlap / smaller > 0.7) return true;
  }
  return false;
}

export async function generateClarifyingQuestions(
  goalId: string,
  userId: string,
  mentorIds?: string[]
): Promise<ClarifyingQuestionsResult | null> {
  const goal = await loadGoal(goalId, userId);
  if (!goal) return null;

  const mentors = await resolveMentors(goal, userId, mentorIds);
  if (mentors.length === 0) return null;

  const recentBriefings = await buildRecentBriefingsBlock(userId, 7);
  const existingPlans = await loadExistingPlans(
    goal.id,
    mentors.map((m) => m.id),
    userId
  );
  const priorFeedbackBlock = buildPriorFeedbackBlock(existingPlans);

  // Persist primary mentorId / mentorIds onto goal if missing
  const primary = mentors[0];
  const goalUpdates: { mentorId?: string; mentorIds?: string[] } = {};
  if (!goal.mentorId) goalUpdates.mentorId = primary.id;
  if (!goal.mentorIds || goal.mentorIds.length === 0) {
    goalUpdates.mentorIds = mentors.map((m) => m.id);
  }
  if (Object.keys(goalUpdates).length > 0) {
    await prisma.goal.update({ where: { id: goal.id }, data: goalUpdates });
  }

  const solo = mentors.length === 1;

  // SEQUENTIAL passes so each mentor sees prior mentors' questions and avoids duplication.
  const combined: ClarifyingQuestion[] = [];
  const alreadyAsked: string[] = [];
  for (const mentor of mentors) {
    const questions = await askMentorForQuestions(
      mentor,
      goal,
      recentBriefings,
      solo,
      priorFeedbackBlock,
      alreadyAsked
    );
    for (const q of questions) {
      if (isDuplicate(q, alreadyAsked)) continue;
      combined.push({
        question: q,
        mentorId: mentor.id,
        mentorName: mentor.name,
        mentorEmoji: mentor.avatarEmoji,
      });
      alreadyAsked.push(q);
    }
  }

  if (combined.length === 0) return null;

  return {
    questions: combined,
    mentorId: primary.id,
    mentorName: primary.name,
    mentors: mentors.map((m) => ({
      id: m.id,
      name: m.name,
      avatarEmoji: m.avatarEmoji,
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Step 2 — Plan from answers                                         */
/* ------------------------------------------------------------------ */

export async function generatePlanFromAnswers(
  goalId: string,
  userId: string,
  mentorId: string,
  answers: Array<{ question: string; answer: string }>,
  mentorIds?: string[]
): Promise<GenerateMentorPlanResult | null> {
  const goal = await loadGoal(goalId, userId);
  if (!goal) return null;

  // Primary mentor (the one who'll author + own the persisted plan)
  const primary = await resolveMentor(goal, userId, mentorId);
  if (!primary) return null;

  // Collaborators: explicit list takes priority, else use goal.mentorIds
  const collabSource = (mentorIds && mentorIds.length > 0)
    ? mentorIds
    : (goal.mentorIds || []);
  let collaborators: MentorRow[] = [];
  const others = collabSource.filter((id) => id && id !== primary.id);
  if (others.length > 0) {
    const rows = await prisma.mentor.findMany({
      where: { id: { in: others }, userId, active: true },
    });
    const byId = new Map(rows.map((m) => [m.id, m]));
    collaborators = others.map((id) => byId.get(id)).filter((m): m is MentorRow => !!m);
  }

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

  const recentBriefings = await buildRecentBriefingsBlock(userId, 7);

  // Pull any prior plans (scoped to THIS goal) to recover feedback + done tasks
  const allMentorIds = [primary.id, ...collaborators.map((c) => c.id)];
  const existingPlans = await loadExistingPlans(goal.id, allMentorIds, userId);
  const priorFeedbackBlock = buildPriorFeedbackBlock(existingPlans);
  const doneTaskIndex = buildDoneTaskIndex(existingPlans, primary.id);

  const collabBlock =
    collaborators.length > 0
      ? `Współpracujący mentorzy (uwzględnij ich perspektywę przy budowaniu planu):\n` +
        collaborators
          .map(
            (c) =>
              `### ${c.name} (${c.role})\n` +
              c.systemPrompt.slice(0, 500) +
              (c.systemPrompt.length > 500 ? "..." : "")
          )
          .join("\n\n")
      : "";

  const userMsg =
    `Twój podopieczny ma cel:\n\n` +
    `${describeGoal(goal)}\n\n` +
    `Profil użytkownika: ${profileJson}\n\n` +
    (recentBriefings ? `${recentBriefings}\n\n` : ``) +
    (collabBlock ? `${collabBlock}\n\n` : ``) +
    (priorFeedbackBlock ? `${priorFeedbackBlock}\n\n` : ``) +
    `Zadałeś (i ewentualnie współpracujący mentorzy) pytania doprecyzowujące i otrzymałeś następujące odpowiedzi:\n\n` +
    `${qaBlock}\n\n` +
    `Na podstawie powyższego kontekstu wygeneruj 4-tygodniowy plan działania dopasowany do TEGO konkretnego celu i odpowiedzi użytkownika. ` +
    `Każdy tydzień powinien zawierać 3-5 konkretnych, mierzalnych zadań. ` +
    (collaborators.length > 0
      ? `Plan ma scalać perspektywy wszystkich mentorów — zadania mogą wynikać z różnych specjalizacji. `
      : ``) +
    `Nie powtarzaj zadań, które użytkownik oznaczył jako za trudne / niepotrzebne w prior feedback.\n\n` +
    `Zwróć WYŁĄCZNIE poprawny JSON (tablica), bez komentarzy, bez markdown:\n` +
    `[{"weekNumber":1,"tasks":[{"title":"Konkretne zadanie","done":false}]},{"weekNumber":2,"tasks":[...]},{"weekNumber":3,"tasks":[...]},{"weekNumber":4,"tasks":[...]}]`;

  const response = await anthropic.messages.create({
    model: primary.model || MODELS.CHAT,
    max_tokens: 3000,
    system: primary.systemPrompt,
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
        return { title, done: tObj.done === true } as PlanTask;
      })
      .filter((t): t is PlanTask => t !== null);
    if (tasks.length === 0) continue;
    plans.push({ weekNumber, tasks });
  }

  if (plans.length === 0) return null;

  // Merge in any preserved "done" tasks from existing plans so progress is not lost
  for (const p of plans) {
    const preserved = doneTaskIndex.get(p.weekNumber);
    if (!preserved || preserved.length === 0) continue;
    const seen = new Set(p.tasks.map((t) => t.title.toLowerCase()));
    for (const old of preserved) {
      if (!seen.has(old.title.toLowerCase())) {
        // Prepend to keep done tasks visible at the top
        p.tasks.unshift({ title: old.title, done: true, ...(old.feedback ? { feedback: old.feedback } : {}) });
      }
    }
  }

  // Persist mentor info on goal if not yet set
  const goalUpdates: { mentorId?: string; mentorIds?: string[] } = {};
  if (!goal.mentorId) goalUpdates.mentorId = primary.id;
  if (!goal.mentorIds || goal.mentorIds.length === 0) {
    goalUpdates.mentorIds = allMentorIds;
  }
  if (Object.keys(goalUpdates).length > 0) {
    await prisma.goal.update({ where: { id: goal.id }, data: goalUpdates });
  }

  const resolvedMentorId = primary.id;
  const phaseForWeek = (w: number) => Math.max(1, Math.ceil(w / 4));

  // Per-goal isolation: upsert keyed by [goalId, mentorId, weekNumber]
  // — this prevents plans for OTHER goals of the same mentor from being touched.
  await Promise.all(
    plans.map((p) =>
      prisma.mentorPlan.upsert({
        where: {
          goalId_mentorId_weekNumber: {
            goalId: goal.id,
            mentorId: resolvedMentorId,
            weekNumber: p.weekNumber,
          },
        },
        update: {
          tasks: p.tasks as unknown as object,
          phase: phaseForWeek(p.weekNumber),
        },
        create: {
          mentorId: resolvedMentorId,
          userId,
          goalId: goal.id,
          weekNumber: p.weekNumber,
          phase: phaseForWeek(p.weekNumber),
          tasks: p.tasks as unknown as object,
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

  return generatePlanFromAnswers(goalId, userId, mentor.id, []);
}
