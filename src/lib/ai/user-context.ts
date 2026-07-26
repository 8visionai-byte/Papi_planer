/**
 * SINGLE SOURCE OF TRUTH for "what the AI knows about the user".
 *
 * Before this module the user context was assembled five times, in five different
 * shapes (mentor.ts, briefing/generator.ts, roundtable/engine.ts, plan-generator.ts,
 * cron/daily-plan/route.ts) — so adding one field (e.g. current weight) required five
 * edits and never actually happened. Every AI call now goes through `buildUserContext`.
 *
 * Design rules:
 *  - ONE `Promise.all` for every DB read, `select` only the columns we render.
 *  - Sections are toggled by flags; `scope` only picks a sensible default flag set.
 *  - Hard per-section character budgets so the prompt does not grow with user tenure.
 *    Target: ~1200-2000 tokens for the full context (PL ≈ 3.5 chars/token).
 *  - Journal is OFF by default and additionally gated on the profile opt-in
 *    `data.shareJournalWithMentors` — see PRIVACY note below.
 *
 * Long-term memory (`UserInsight`) is NOT queried here directly. It comes from
 * `insights-context.ts`, which swallows a missing-table error and returns "" —
 * so a database that has not run the ETAP 7 migration still serves AI normally
 * (BRAIN-SPEC risk R1).
 *
 * ETAP 8 (habit loop / goal lifecycle / taste memory) added three things, all of
 * them behind the same "the column may not exist yet" defence as above, because
 * production only gets the new schema when the container restarts:
 *  - "nawyki" carries the habit loop (cue, reward, what it replaces, and in a 1:1
 *    chat also the WHY), so a mentor works on the loop instead of preaching willpower;
 *  - "cele" stays strictly `status: "active"` and gains ONE history line with the
 *    last achievements. Closed goals are motivation, never a source of tasks — a
 *    karate exam that was passed must not come back in tomorrow's plan;
 *  - "dieta" carries what the user likes and what he refused (`MealIdea`), so EVERY
 *    mentor stops proposing the same 200 g of cottage cheese, not just the diet screen.
 *
 * All three respect the existing per-section budgets. Where the extra text does not
 * fit, the code drops whole items (a dish, one habit's loop) instead of letting the
 * final `cut()` amputate the tail of the section.
 */

import { prisma } from "@/lib/db/prisma";
import { startOfDay, subDays, addDays, format } from "date-fns";
import { pl } from "date-fns/locale";
import { getCurrentBodyMetrics } from "@/lib/ai/body-metrics";
import { getActiveInsights } from "@/lib/ai/insights-context";
import { getCalendarEvents, polishDayBounds } from "@/lib/google/calendar";

export const USER_CONTEXT_VERSION = "ctx-v1";

/** Profile flag (UserProfile.data) that unlocks the journal section. Default: off. */
export const SHARE_JOURNAL_FLAG = "shareJournalWithMentors";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export type ContextScope =
  | "chat" // 1:1 mentor conversation
  | "day-plan" // today's plan generation / replan
  | "goal-plan" // 4-week mentor plan for a goal
  | "activity-plan" // detailed plan for a single training slot
  | "briefing" // evening summary
  | "debate"; // Round Table

export type UserContextSectionKey =
  | "profil"
  | "wnioski"
  | "cele"
  | "plany"
  | "nawyki"
  | "treningi"
  | "dieta"
  | "dzis"
  | "briefingi"
  | "mentorzy"
  | "dziennik";

export interface UserContextOptions {
  /** Picks the default set of sections. Individual flags below always win. */
  scope?: ContextScope;
  /** Narrow goals / trainings / records to one discipline. */
  lifeAreaId?: string | null;
  /** Hard cap for the whole block, in characters. Default 6000 (~1700 tokens PL). */
  maxChars?: number;
  /**
   * Day the "dzis" section describes. Defaults to today.
   * Used by /api/briefing/finalize which summarizes a day that already ended.
   */
  referenceDate?: Date;

  includeProfile?: boolean;
  /** Long-term memory (UserInsight) rendered by insights-context.ts. */
  includeInsights?: boolean;
  includeGoals?: boolean;
  includeMentorPlans?: boolean;
  includeHabits?: boolean;
  includeTraining?: boolean;
  includeDiet?: boolean;
  includeToday?: boolean;
  includeBriefings?: boolean;
  includeMentors?: boolean;
  /**
   * PRIVACY: journal entries. OFF by default. Even when the caller passes `true`
   * the section is only rendered if the user opted in via
   * `UserProfile.data.shareJournalWithMentors`, and only `redactedText` is ever used.
   */
  includeJournal?: boolean;
  /**
   * Google Calendar meetings inside the "dzis" section. OFF by default because it is
   * a network round-trip outside the Promise.all. `plan-generator.ts` fetches the
   * calendar itself (it needs end times to block slots), so it leaves this off.
   */
  includeCalendar?: boolean;
}

export interface UserContextSection {
  key: UserContextSectionKey;
  title: string;
  body: string;
  /** Stable sections barely change during a day (prompt-caching candidates). */
  stable: boolean;
}

export interface UserContextFacts {
  firstName: string;
  currentWeightKg: number;
  bmr: number;
  tdee: number;
  targetCalories: number;
  activeGoalCount: number;
  /** Whether the journal opt-in flag is set on the profile. */
  journalShared: boolean;
}

export interface UserContext {
  userId: string;
  version: string;
  builtAt: Date;
  referenceDate: Date;
  /** Sections that actually produced content, in render order. */
  sections: UserContextSection[];
  /** Keys of the filled sections — handy for logging / assertions. */
  filled: UserContextSectionKey[];
  facts: UserContextFacts;
  /** Full markdown block, already capped at `maxChars`. */
  text: string;
  /** Stable half only (profile, mentors) — prompt-caching candidate. */
  stableText: string;
  /** Volatile half (today, last 7 days, ...). */
  volatileText: string;
  approxTokens: number;
  /** Re-render the block with a subset of sections. */
  toPromptString(sections?: UserContextSectionKey[]): string;
}

/* ------------------------------------------------------------------ */
/*  Budgets + small helpers                                            */
/* ------------------------------------------------------------------ */

const SECTION_BUDGET: Record<UserContextSectionKey, number> = {
  profil: 700,
  wnioski: 900,
  cele: 700,
  plany: 700,
  nawyki: 500,
  treningi: 700,
  dieta: 450,
  dzis: 600,
  briefingi: 700,
  mentorzy: 300,
  dziennik: 700,
};

const SECTION_TITLE: Record<UserContextSectionKey, string> = {
  profil: "Kim jest",
  wnioski: "Co juz wiemy o uzytkowniku",
  cele: "Aktywne cele",
  plany: "Plany mentorow",
  nawyki: "Nawyki",
  treningi: "Treningi i rekordy",
  dieta: "Dieta i waga",
  dzis: "Dzis",
  briefingi: "Ostatnie podsumowania dnia",
  mentorzy: "Aktywni mentorzy",
  dziennik: "Dziennik (za zgoda uzytkownika)",
};

/** Render order — identity first, most volatile day data last. */
const SECTION_ORDER: UserContextSectionKey[] = [
  "profil",
  "wnioski",
  "mentorzy",
  "cele",
  "plany",
  "nawyki",
  "treningi",
  "dieta",
  "dzis",
  "briefingi",
  "dziennik",
];

const STABLE_SECTIONS = new Set<UserContextSectionKey>([
  "profil",
  "wnioski",
  "mentorzy",
]);

function cut(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, Math.max(0, max - 3)).trimEnd() + "...";
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function dayKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

const GOAL_LABEL: Record<string, string> = {
  cut: "redukcja",
  bulk: "masa",
  maintain: "utrzymanie",
};

/**
 * `label` followed by as many comma-separated items as fit in `max` characters.
 * Drops whole items rather than cutting one in half: "Kurczak z ry..." is worse
 * for a model than one dish fewer.
 */
function joinFit(label: string, items: string[], max: number): string {
  if (items.length === 0 || max <= label.length) return "";
  const kept: string[] = [];
  let len = label.length;
  for (const raw of items) {
    const item = cut(raw, 45);
    if (!item) continue;
    const add = (kept.length > 0 ? 2 : 0) + item.length;
    if (len + add > max) break;
    kept.push(item);
    len += add;
  }
  return kept.length > 0 ? label + kept.join(", ") : "";
}

/* ------------------------------------------------------------------ */
/*  Reads that must survive an un-migrated database                    */
/* ------------------------------------------------------------------ */

/**
 * Shape the "nawyki" section renders. Declared explicitly so the degraded read
 * below returns the SAME type and the renderer never has to branch.
 */
interface HabitRow {
  id: string;
  name: string;
  timeOfDay: string;
  cue: string | null;
  reward: string | null;
  why: string | null;
  kind: string;
  replaces: string | null;
}

/**
 * Habits plus their loop. The loop columns reach the production database only
 * when the container boots with the new schema; until then Postgres answers
 * 42703 and a bare `findMany` would take the whole context down with it. On that
 * error we re-read the legacy shape, so the section degrades to exactly what it
 * printed before ETAP 8 instead of disappearing.
 */
async function loadHabits(userId: string): Promise<HabitRow[]> {
  const where = { userId, active: true };
  const common = { where, orderBy: { sortOrder: "asc" }, take: 12 } as const;
  try {
    return await prisma.habit.findMany({
      ...common,
      select: {
        id: true,
        name: true,
        timeOfDay: true,
        cue: true,
        reward: true,
        why: true,
        kind: true,
        replaces: true,
      },
    });
  } catch {
    try {
      const rows = await prisma.habit.findMany({
        ...common,
        select: { id: true, name: true, timeOfDay: true },
      });
      return rows.map((h) => ({
        ...h,
        cue: null,
        reward: null,
        why: null,
        kind: "build",
        replaces: null,
      }));
    } catch {
      return [];
    }
  }
}

/**
 * Last few goals the user actually closed. Motivation fuel only — see the render
 * site for why this is a single labelled line and never a task source.
 *
 * `"completed"` is in the filter because rows written before the goal lifecycle
 * existed still carry that value; skipping it would hide real achievements.
 */
async function loadAchievedGoals(
  userId: string,
  lifeAreaId: string | null
): Promise<{ title: string; achievedAt: Date | null }[]> {
  try {
    return await prisma.goal.findMany({
      where: {
        userId,
        status: { in: ["achieved", "completed"] },
        ...(lifeAreaId ? { lifeAreaId } : {}),
      },
      // Postgres puts NULLs first on DESC, which would float legacy rows with no
      // close date above genuinely recent wins.
      orderBy: { achievedAt: { sort: "desc", nulls: "last" } },
      take: 3,
      select: { title: true, achievedAt: true },
    });
  } catch {
    // `achieved_at` / `outcome` may not exist on this database yet.
    return [];
  }
}

/** What the user asked for more of, and what he refused. */
interface MealTastes {
  liked: string[];
  disliked: string[];
}

/**
 * Taste memory. Two queries, but they run concurrently inside one slot of the
 * caller's `Promise.all`, so this still costs a single database round trip.
 * The whole table is new, so a missing relation (P2021) must read as "no data".
 */
async function loadMealTastes(userId: string): Promise<MealTastes> {
  try {
    const [liked, disliked] = await Promise.all([
      prisma.mealIdea.findMany({
        where: { userId, OR: [{ rating: 1 }, { favorite: true }] },
        // Favourites first, then whatever he actually cooks most often.
        orderBy: [{ favorite: "desc" }, { timesCooked: "desc" }],
        take: 8,
        select: { title: true },
      }),
      prisma.mealIdea.findMany({
        where: { userId, rating: -1 },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { title: true },
      }),
    ]);
    return {
      liked: liked.map((m) => m.title),
      disliked: disliked.map((m) => m.title),
    };
  } catch {
    return { liked: [], disliked: [] };
  }
}

/* ------------------------------------------------------------------ */
/*  Scope presets                                                      */
/* ------------------------------------------------------------------ */

type SectionFlags = Required<
  Pick<
    UserContextOptions,
    | "includeProfile"
    | "includeInsights"
    | "includeGoals"
    | "includeMentorPlans"
    | "includeHabits"
    | "includeTraining"
    | "includeDiet"
    | "includeToday"
    | "includeBriefings"
    | "includeMentors"
    | "includeJournal"
    | "includeCalendar"
  >
>;

const ALL_ON: SectionFlags = {
  includeProfile: true,
  includeInsights: true,
  includeGoals: true,
  includeMentorPlans: true,
  includeHabits: true,
  includeTraining: true,
  includeDiet: true,
  includeToday: true,
  includeBriefings: true,
  includeMentors: false,
  includeJournal: false,
  includeCalendar: false,
};

const SCOPE_PRESETS: Record<ContextScope, SectionFlags> = {
  // Full picture — the mentor must be able to answer "how much do I weigh".
  // `includeJournal: true` only means "this scope MAY show the journal"; it stays
  // hidden until the user flips `shareJournalWithMentors` in the profile.
  chat: { ...ALL_ON, includeJournal: true },
  // Planning today: needs habits, yesterday's results, training load.
  "day-plan": { ...ALL_ON, includeMentors: true },
  // 4-week goal plan: long horizon, no need for today's meals.
  "goal-plan": {
    ...ALL_ON,
    includeDiet: false,
    includeToday: false,
    includeJournal: true,
  },
  // Single training slot: form, records, how the last days went.
  "activity-plan": {
    ...ALL_ON,
    includeMentorPlans: false,
    includeHabits: false,
    includeDiet: false,
  },
  // Evening summary: everything about the day being summarized.
  briefing: { ...ALL_ON, includeMentors: true },
  // Round Table sends the context (2N+2) times — keep it lean.
  debate: {
    ...ALL_ON,
    includeMentorPlans: false,
    includeDiet: false,
    includeBriefings: false,
    includeJournal: true,
  },
};

/**
 * Scopes allowed to see finished goals. Deliberately NOT "day-plan": the day
 * planner reading "cel osiagniety: egzamin karate" is exactly how a passed exam
 * came back as a task every single morning. Motivation belongs in a conversation
 * and in the evening summary, never in the list of things to do today.
 */
const ACHIEVED_GOAL_SCOPES = new Set<ContextScope>(["chat", "briefing"]);

const SCOPE_MAX_CHARS: Record<ContextScope, number> = {
  chat: 6000,
  "day-plan": 6000,
  "goal-plan": 5000,
  "activity-plan": 3500,
  briefing: 6000,
  debate: 3000,
};

/* ------------------------------------------------------------------ */
/*  Main builder                                                       */
/* ------------------------------------------------------------------ */

export async function buildUserContext(
  userId: string,
  opts: UserContextOptions = {}
): Promise<UserContext> {
  const scope = opts.scope ?? "chat";
  const preset = SCOPE_PRESETS[scope];
  const flags: SectionFlags = {
    includeProfile: opts.includeProfile ?? preset.includeProfile,
    includeInsights: opts.includeInsights ?? preset.includeInsights,
    includeGoals: opts.includeGoals ?? preset.includeGoals,
    includeMentorPlans: opts.includeMentorPlans ?? preset.includeMentorPlans,
    includeHabits: opts.includeHabits ?? preset.includeHabits,
    includeTraining: opts.includeTraining ?? preset.includeTraining,
    includeDiet: opts.includeDiet ?? preset.includeDiet,
    includeToday: opts.includeToday ?? preset.includeToday,
    includeBriefings: opts.includeBriefings ?? preset.includeBriefings,
    includeMentors: opts.includeMentors ?? preset.includeMentors,
    includeJournal: opts.includeJournal ?? preset.includeJournal,
    includeCalendar: opts.includeCalendar ?? preset.includeCalendar,
  };
  const maxChars = opts.maxChars ?? SCOPE_MAX_CHARS[scope];
  const lifeAreaId = opts.lifeAreaId ?? null;

  const refDay = startOfDay(opts.referenceDate ?? new Date());
  const nextDay = addDays(refDay, 1);
  const d7 = subDays(refDay, 7);
  const d30 = subDays(refDay, 30);
  const d35 = subDays(refDay, 35);

  const areaFilter = lifeAreaId ? { lifeAreaId } : {};

  /* ---------------- profile first (privacy gate) ------------------- */

  // Read the profile up front for ONE reason: the journal opt-in must be known
  // BEFORE we decide whether to read journal rows at all. The value is then
  // handed to body-metrics, so this costs no extra query overall.
  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: { data: true },
  });
  const p = (profile?.data ?? {}) as Record<string, unknown>;
  const journalShared = p[SHARE_JOURNAL_FLAG] === true;
  const renderJournal = flags.includeJournal && journalShared;

  /* ---------------- one Promise.all, selects only ------------------ */

  const [
    user,
    // Weight / BMR / TDEE / calorie target — owned by body-metrics.ts so the
    // numbers a mentor quotes are the SAME ones the dashboard and diet show.
    body,
    // Long-term memory (UserInsight). Self-defending: returns "" if the table is
    // not migrated yet, so a missing memory never takes the AI layer down (R1).
    insightsBlock,
    weights,
    goals,
    achievedGoals,
    mentorPlans,
    habits,
    habitDone,
    trainings,
    records,
    journal,
    briefings,
    mentors,
    logs,
    mealTastes,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    getCurrentBodyMetrics(userId, {
      profileData: profile?.data ?? null,
      now: opts.referenceDate ?? new Date(),
    }),
    flags.includeInsights
      ? getActiveInsights(userId, 8, { maxChars: SECTION_BUDGET.wnioski })
      : Promise.resolve(""),
    prisma.weightEntry.findMany({
      where: { userId, date: { gte: d35, lt: nextDay } },
      orderBy: { date: "desc" },
      take: 35,
      select: { date: true, weightKg: true },
    }),
    // CONTRACT: strictly "active". Not `not: "archived"`, not an `in` list.
    // "achieved", "abandoned" and "paused" all mean "stop reminding me about
    // this" — that is the entire point of closing or pausing a goal. Loosening
    // this filter resurrects finished goals in every mentor prompt.
    flags.includeGoals || flags.includeMentorPlans
      ? prisma.goal.findMany({
          where: { userId, status: "active", ...areaFilter },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: {
            id: true,
            title: true,
            progress: true,
            targetDate: true,
            mentor: { select: { name: true } },
            lifeArea: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    flags.includeGoals && ACHIEVED_GOAL_SCOPES.has(scope)
      ? loadAchievedGoals(userId, lifeAreaId)
      : Promise.resolve([]),
    flags.includeMentorPlans
      ? prisma.mentorPlan.findMany({
          // A plan hanging off a closed goal is the second door the same problem
          // walks through: the goal is gone from the context, but its unfinished
          // weekly tasks would still be pushed into today. Plans with no goal
          // (`goalId: null`) are standalone and stay.
          where: {
            userId,
            OR: [{ goalId: null }, { goal: { is: { status: "active" } } }],
          },
          orderBy: { weekNumber: "desc" },
          take: 8,
          select: {
            weekNumber: true,
            tasks: true,
            goalId: true,
            mentor: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    flags.includeHabits ? loadHabits(userId) : Promise.resolve([]),
    flags.includeHabits
      ? prisma.habitCompletion.findMany({
          where: {
            userId,
            completed: true,
            date: { gte: d30, lt: nextDay },
          },
          select: { habitId: true, date: true },
        })
      : Promise.resolve([]),
    flags.includeTraining
      ? prisma.trainingLog.findMany({
          where: { userId, ...areaFilter, date: { lt: nextDay } },
          orderBy: { date: "desc" },
          take: 12,
          select: {
            date: true,
            exerciseName: true,
            sets: true,
            reps: true,
            weightKg: true,
            durationMin: true,
            distance: true,
            rating: true,
            lifeArea: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    flags.includeTraining
      ? prisma.personalRecord.findMany({
          where: { userId, ...areaFilter },
          orderBy: { achievedAt: "desc" },
          take: 8,
          select: {
            exerciseName: true,
            value: true,
            unit: true,
            achievedAt: true,
            lifeArea: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    // PRIVACY: journal rows are not even READ unless the scope allows it AND the
    // user set `shareJournalWithMentors` on the profile.
    renderJournal
      ? prisma.journalEntry.findMany({
          where: { userId, createdAt: { gte: d30, lt: nextDay } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            createdAt: true,
            redactedText: true,
            category: true,
            topic: true,
          },
        })
      : Promise.resolve([]),
    flags.includeBriefings
      ? prisma.briefing.findMany({
          where: { userId, date: { gte: d7, lt: nextDay } },
          orderBy: { date: "desc" },
          take: 7,
          select: { date: true, content: true },
        })
      : Promise.resolve([]),
    flags.includeMentors
      ? prisma.mentor.findMany({
          where: { userId, active: true },
          orderBy: { sortOrder: "asc" },
          take: 6,
          select: { name: true, role: true, style: true, avatarEmoji: true },
        })
      : Promise.resolve([]),
    prisma.dailyLog.findMany({
      where: { userId, date: { gte: d7, lt: nextDay } },
      orderBy: { date: "desc" },
      take: 8,
      select: {
        date: true,
        energy: true,
        mood: true,
        sleepHours: true,
        sleepQuality: true,
        dayType: true,
        voiceTranscript: true,
        activities: {
          orderBy: { scheduledAt: "asc" },
          select: {
            name: true,
            type: true,
            scheduledAt: true,
            completed: true,
            metrics: true,
          },
        },
        meals: { select: { calories: true, protein: true } },
      },
    }),
    flags.includeDiet
      ? loadMealTastes(userId)
      : Promise.resolve({ liked: [], disliked: [] } as MealTastes),
  ]);

  /* ---------------- derived facts ---------------------------------- */

  const firstName = user?.name?.trim().split(/\s+/)[0] || "Uzytkownik";
  const currentWeightKg = body.latestWeightKg ?? body.weightKg;
  const { bmr, tdee, targetCalories } = body;

  const refLog = logs.find((l) => dayKey(l.date) === dayKey(refDay)) ?? null;

  /* ---------------- optional calendar (network, opt-in) ------------- */

  let meetings: string[] = [];
  if (flags.includeCalendar && p.showCalendarInPlan === true) {
    try {
      const { from, to } = polishDayBounds(refDay);
      const events = await getCalendarEvents(userId, { from, to });
      meetings = events
        .filter((e) => !e.allDay)
        .slice(0, 6)
        .map((e) => {
          const t = new Date(e.start).toLocaleTimeString("pl-PL", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "Europe/Warsaw",
          });
          return `${t} ${e.title}`;
        });
    } catch {
      // Token expired / calendar not connected — context must never break on this.
    }
  }

  /* ---------------- sections --------------------------------------- */

  const built = new Map<UserContextSectionKey, string>();

  // --- profil ---
  if (flags.includeProfile) {
    const goalLabel = body.goal;
    const weightNote = body.latestWeightDate
      ? ` (pomiar ${body.latestWeightDate})`
      : " (z profilu, brak swiezego pomiaru)";
    const avgNote =
      body.avg7dWeightKg !== null && body.avg7dWeightKg !== currentWeightKg
        ? `, srednia 7 dni ${body.avg7dWeightKg} kg`
        : "";
    const lines = [
      `Imie: ${firstName}`,
      `Wiek: ${body.age ?? "?"}, wzrost: ${body.heightCm ?? "?"} cm, plec: ${body.gender ?? "?"}`,
      `Waga: ${currentWeightKg} kg${weightNote}${avgNote}`,
      `Poziom aktywnosci: ${body.activityLevel ?? "moderate (domyslny)"}`,
      `Cel sylwetkowy: ${goalLabel ? (GOAL_LABEL[goalLabel] ?? goalLabel) : "brak"}${body.weeklyTargetKg ? `, tempo ${body.weeklyTargetKg} kg/tydzien` : ""}`,
      `Zapotrzebowanie: BMR ${bmr} kcal, TDEE ${tdee} kcal, cel dzienny ${targetCalories} kcal`,
      str(p.occupation) ? `Zawod: ${str(p.occupation)}` : "",
      str(p.trainingExperience) ? `Doswiadczenie treningowe: ${str(p.trainingExperience)}` : "",
      str(p.fitnessLevel) ? `Poziom formy: ${str(p.fitnessLevel)}` : "",
      str(p.medicalConditions) ? `Zdrowie: ${str(p.medicalConditions)}` : "",
      str(p.injuries) ? `Kontuzje: ${str(p.injuries)}` : "",
      str(p.allergies) ? `Alergie: ${str(p.allergies)}` : "",
    ].filter(Boolean);
    built.set("profil", lines.join("\n"));
  }

  // --- wnioski: long-term memory ---
  // getActiveInsights returns a finished markdown section including its own
  // "## Co juz wiemy o uzytkowniku" heading; strip it, the renderer adds the title.
  if (insightsBlock) {
    const withoutHeading = insightsBlock.replace(/^##[^\n]*\n?/, "").trim();
    if (withoutHeading) built.set("wnioski", withoutHeading);
  }

  // --- mentorzy ---
  if (flags.includeMentors && mentors.length > 0) {
    built.set(
      "mentorzy",
      mentors
        .map(
          (m) =>
            `- ${m.avatarEmoji ?? ""} ${m.name} (${m.role})${m.style ? ` — styl: ${m.style}` : ""}`
        )
        .join("\n")
    );
  }

  // --- cele (only "active"; closed ones get ONE history line) ---
  if (flags.includeGoals && (goals.length > 0 || achievedGoals.length > 0)) {
    const activeLines = goals.map((g) => {
      const deadline = g.targetDate ? `, termin ${dayKey(g.targetDate)}` : "";
      const mentorTag = g.mentor?.name ? `, mentor: ${g.mentor.name}` : "";
      const area = g.lifeArea?.name ? ` [${g.lifeArea.name}]` : "";
      return `- ${g.title}${area} — ${g.progress}%${deadline}${mentorTag}`;
    });

    // One line, explicitly labelled as history. It lives inside the goals section
    // (rather than a new one) so the section list, order and budgets stay as they
    // were, and the "nie planuj do nich zadan" clause is not decoration: without
    // it a model happily turns "osiagniete: egzamin karate" into today's task.
    const achievedLine =
      achievedGoals.length > 0
        ? "Osiagniete (zamkniete, nie planuj do nich zadan): " +
          achievedGoals
            .map((g) => {
              const when = g.achievedAt
                ? ` (${format(g.achievedAt, "LLLL yyyy", { locale: pl })})`
                : "";
              return `${cut(g.title, 60)}${when}`;
            })
            .join(", ")
        : "";

    // Reserve room for the motivation line BEFORE trimming the active goals,
    // otherwise the section-wide cut() at assembly time would always eat it.
    const activeBlock =
      activeLines.length > 0
        ? cut(
            activeLines.join("\n"),
            achievedLine
              ? Math.max(0, SECTION_BUDGET.cele - achievedLine.length - 1)
              : SECTION_BUDGET.cele
          )
        : "Brak aktywnych celow.";

    built.set("cele", [activeBlock, achievedLine].filter(Boolean).join("\n"));
  }

  // --- plany mentorow (current week + open tasks + user feedback) ---
  if (flags.includeMentorPlans && mentorPlans.length > 0) {
    type PlanTask = { title?: unknown; done?: unknown; feedback?: unknown };
    // Highest weekNumber per (mentor, goal) pair = the plan currently in play.
    const currentWeek = new Map<string, (typeof mentorPlans)[number]>();
    for (const plan of mentorPlans) {
      const key = `${plan.mentor.name}::${plan.goalId ?? "-"}`;
      const prev = currentWeek.get(key);
      if (!prev || plan.weekNumber > prev.weekNumber) currentWeek.set(key, plan);
    }

    const planLines: string[] = [];
    const openTasks: string[] = [];
    const feedbackLines: string[] = [];

    for (const plan of Array.from(currentWeek.values()).slice(0, 4)) {
      const tasks: PlanTask[] = Array.isArray(plan.tasks)
        ? (plan.tasks as PlanTask[])
        : [];
      const titled = tasks.filter((t) => typeof t.title === "string");
      const done = titled.filter((t) => t.done === true).length;
      planLines.push(
        `- ${plan.mentor.name}, tydzien ${plan.weekNumber}: zrobione ${done}/${titled.length}`
      );
      for (const t of titled) {
        const title = String(t.title);
        if (t.done !== true && openTasks.length < 6) {
          openTasks.push(`  - [${plan.mentor.name}] ${title}`);
        }
        const fb = str(t.feedback);
        if (fb && feedbackLines.length < 4) {
          feedbackLines.push(`  - "${title}": ${cut(fb, 120)}`);
        }
      }
    }

    const body = [
      planLines.join("\n"),
      openTasks.length > 0 ? `Otwarte zadania:\n${openTasks.join("\n")}` : "",
      feedbackLines.length > 0
        ? `Uwagi uzytkownika do zadan (uwzglednij je):\n${feedbackLines.join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (body) built.set("plany", body);
  }

  // --- nawyki: 7d / 30d rate + current streak ---
  if (flags.includeHabits && habits.length > 0) {
    const doneByHabit = new Map<string, Set<string>>();
    for (const c of habitDone) {
      let set = doneByHabit.get(c.habitId);
      if (!set) {
        set = new Set<string>();
        doneByHabit.set(c.habitId, set);
      }
      set.add(dayKey(c.date));
    }

    const last7Keys: string[] = [];
    for (let i = 0; i < 7; i += 1) last7Keys.push(dayKey(subDays(refDay, i)));

    const baseLines: string[] = [];
    // Habit loop, rendered as a suffix on the same line. Kept separate from the
    // statistics so the budget pass below can drop loops without losing habits.
    const loopSuffix: string[] = [];

    for (const h of habits.slice(0, 8)) {
      const days = doneByHabit.get(h.id) ?? new Set<string>();
      const in7 = last7Keys.filter((k) => days.has(k)).length;
      const in30 = days.size;
      // Streak: consecutive days back from the reference day. A habit not yet
      // ticked today should not zero the streak, so we allow a same-day miss.
      let streak = 0;
      let cursor = refDay;
      if (!days.has(dayKey(cursor))) cursor = subDays(cursor, 1);
      while (days.has(dayKey(cursor)) && streak < 400) {
        streak += 1;
        cursor = subDays(cursor, 1);
      }
      const when =
        h.timeOfDay && h.timeOfDay !== "any" ? ` (${h.timeOfDay})` : "";
      baseLines.push(
        `- ${h.name}${when}: 7 dni ${in7}/7, 30 dni ${in30}/30, seria ${streak} dni`
      );

      const bits: string[] = [];
      const cue = str(h.cue);
      const reward = str(h.reward);
      if (cue) bits.push(`wyzwalacz ${cut(cue, 60)}`);
      if (reward) bits.push(`nagroda ${cut(reward, 60)}`);
      // "replace" is a contract value, not prose: only then does `replaces` hold
      // the old behaviour being swapped out, and only then is it worth a mentor's
      // attention ("you are not deleting anything, you are trading it").
      if (h.kind === "replace") {
        const replaces = str(h.replaces);
        if (replaces) bits.push(`zastepuje ${cut(replaces, 60)}`);
      }
      // WHY is motivation, and motivation is a conversation. The day planner only
      // needs to know when the habit fires, so `why` never enters "day-plan".
      if (scope === "chat") {
        const why = str(h.why);
        if (why) bits.push(`po co: ${cut(why, 60)}`);
      }
      loopSuffix.push(bits.length > 0 ? `, ${bits.join(", ")}` : "");
    }

    // Budget-first assembly. Every habit keeps its statistics line; loop details
    // are attached top-down (habits come in the user's own sortOrder, so his most
    // important ones win) while they still fit. Appending everything and letting
    // the section-wide cut() truncate would cost the last habits their whole row.
    const lines = [...baseLines];
    let used = lines.join("\n").length;
    for (let i = 0; i < lines.length; i += 1) {
      const extra = loopSuffix[i];
      if (!extra) continue;
      if (used + extra.length > SECTION_BUDGET.nawyki) break;
      lines[i] += extra;
      used += extra.length;
    }
    built.set("nawyki", lines.join("\n"));
  }

  // --- treningi + rekordy (last sessions per discipline) ---
  if (flags.includeTraining && (trainings.length > 0 || records.length > 0)) {
    const perArea = new Map<string, string[]>();
    for (const t of trainings) {
      const area = t.lifeArea?.name ?? "inne";
      const bucket = perArea.get(area) ?? [];
      if (bucket.length >= 3) continue;
      const parts = [t.exerciseName];
      if (t.sets) parts.push(`${t.sets}x${t.reps ?? "?"}`);
      if (t.weightKg) parts.push(`${t.weightKg} kg`);
      if (t.durationMin) parts.push(`${t.durationMin} min`);
      if (t.distance) parts.push(`${t.distance} km`);
      if (t.rating) parts.push(`ocena ${t.rating}/10`);
      bucket.push(
        `  - ${format(t.date, "d MMM", { locale: pl })}: ${parts.join(", ")}`
      );
      perArea.set(area, bucket);
    }

    const trainingBlock = Array.from(perArea.entries())
      .slice(0, 4)
      .map(([area, rows]) => `${area}:\n${rows.join("\n")}`)
      .join("\n");

    const recordBlock =
      records.length > 0
        ? "Rekordy zyciowe:\n" +
          records
            .slice(0, 7)
            .map(
              (r) =>
                `  - ${r.exerciseName}: ${r.value} ${r.unit}${r.lifeArea?.name ? ` [${r.lifeArea.name}]` : ""} (${dayKey(r.achievedAt)})`
            )
            .join("\n")
        : "";

    const body = [trainingBlock, recordBlock].filter(Boolean).join("\n");
    if (body) built.set("treningi", body);
  }

  // --- dieta: 7d averages + reference-day balance + weight trend ---
  if (flags.includeDiet) {
    const dayTotals = logs
      .filter((l) => l.meals.length > 0)
      .map((l) => ({
        kcal: l.meals.reduce((s, m) => s + (m.calories ?? 0), 0),
        protein: l.meals.reduce((s, m) => s + (m.protein ?? 0), 0),
      }));
    const avgKcal = avg(dayTotals.map((d) => d.kcal));
    const avgProtein = avg(dayTotals.map((d) => d.protein));

    const eatenToday = refLog
      ? refLog.meals.reduce((s, m) => s + (m.calories ?? 0), 0)
      : 0;
    const burnedToday = refLog
      ? refLog.activities.reduce((s, a) => {
          const m = a.metrics as { caloriesBurned?: number } | null;
          return s + (a.completed && typeof m?.caloriesBurned === "number" ? m.caloriesBurned : 0);
        }, 0)
      : 0;

    // Weight trend: mean of the last 7 measured days vs the 7 before that.
    const recent7 = weights.slice(0, 7).map((w) => w.weightKg);
    const prev7 = weights.slice(7, 14).map((w) => w.weightKg);
    const a7 = avg(recent7);
    const b7 = avg(prev7);
    const trend7 = a7 !== null && b7 !== null ? a7 - b7 : null;
    // Needs at least two distinct measurements — one entry compared with itself
    // would print a fake "trend 0.0 kg".
    const in30 = weights.filter((w) => w.date >= d30);
    const oldest30 = in30.at(-1);
    const trend30 =
      in30.length >= 2 && oldest30 ? in30[0].weightKg - oldest30.weightKg : null;

    const lines = [
      avgKcal !== null
        ? `Srednia z ${dayTotals.length} dni: ${Math.round(avgKcal)} kcal, bialko ${Math.round(avgProtein ?? 0)} g (cel ${targetCalories} kcal)`
        : "Brak zapisanych posilkow w ostatnich 7 dniach",
      `Bilans ${dayKey(refDay)}: zjedzone ${eatenToday} kcal, spalone aktywnosciami ${burnedToday} kcal, BMR ${bmr} kcal`,
      trend7 !== null
        ? `Trend wagi 7 dni: ${trend7 > 0 ? "+" : ""}${trend7.toFixed(1)} kg`
        : "",
      trend30 !== null
        ? `Trend wagi 30 dni: ${trend30 > 0 ? "+" : ""}${trend30.toFixed(1)} kg`
        : "",
    ].filter(Boolean);

    // Taste memory (MealIdea). This is the reason it sits in the shared context
    // and not on the diet screen: every mentor who suggests food now knows what
    // was already rejected, so nobody proposes the same cottage cheese again.
    // "Nie lubi" is a hard no, not a hint.
    const numbers = lines.join("\n");
    const room = SECTION_BUDGET.dieta - numbers.length - 2;
    // Likes get the larger share (up to 8 titles vs 5), but the dislikes always
    // get whatever the likes did not take, so a refusal is never the line that
    // silently falls off the end.
    const likeLine = joinFit("Lubi: ", mealTastes.liked, Math.floor(room * 0.6));
    const dislikeLine = joinFit(
      "Nie lubi: ",
      mealTastes.disliked,
      room - (likeLine ? likeLine.length + 1 : 0)
    );

    built.set(
      "dieta",
      [numbers, likeLine, dislikeLine].filter(Boolean).join("\n")
    );
  }

  // --- dzis (or the reference day) + last-7-days roll-up ---
  if (flags.includeToday) {
    const lines: string[] = [
      `Data: ${format(refDay, "EEEE, d MMMM yyyy", { locale: pl })}`,
    ];
    if (refLog?.energy != null) lines.push(`Energia: ${refLog.energy}/10`);
    if (refLog?.mood) lines.push(`Nastroj: ${refLog.mood}`);
    if (refLog?.sleepHours != null)
      lines.push(
        `Sen: ${refLog.sleepHours}h${refLog.sleepQuality != null ? ` (jakosc ${refLog.sleepQuality}/10)` : ""}`
      );
    if (refLog?.dayType) lines.push(`Typ dnia: ${refLog.dayType}`);

    if (refLog && refLog.activities.length > 0) {
      const done = refLog.activities.filter((a) => a.completed);
      const pending = refLog.activities.filter((a) => !a.completed);
      lines.push(`Zadania: ${done.length}/${refLog.activities.length} zrobione`);
      if (done.length > 0) {
        lines.push(
          `Zrobione: ${done.slice(0, 7).map((a) => a.name).join(", ")}`
        );
      }
      if (pending.length > 0) {
        lines.push(
          `Niezrobione: ${pending
            .slice(0, 7)
            .map((a) => `${a.scheduledAt ? `${a.scheduledAt} ` : ""}${a.name}`)
            .join(", ")}`
        );
      }
    } else {
      lines.push("Zadania: brak zaplanowanych aktywnosci");
    }

    if (meetings.length > 0) {
      lines.push(`Spotkania z kalendarza: ${meetings.join(", ")}`);
    }
    const transcript = str(refLog?.voiceTranscript);
    if (transcript) lines.push(`Notatka glosowa: ${cut(transcript, 200)}`);

    // Previous days, so the mentor sees the trend, not just a snapshot.
    const previous = logs.filter((l) => dayKey(l.date) !== dayKey(refDay)).slice(0, 6);
    if (previous.length > 0) {
      lines.push(
        "Poprzednie dni:\n" +
          previous
            .map((l) => {
              const d = l.activities.filter((a) => a.completed).length;
              return `  - ${format(l.date, "EEE d MMM", { locale: pl })}: ${d}/${l.activities.length} zadan, energia ${l.energy ?? "?"}/10`;
            })
            .join("\n")
      );
    }
    built.set("dzis", lines.join("\n"));
  }

  // --- briefingi ---
  if (flags.includeBriefings && briefings.length > 0) {
    built.set(
      "briefingi",
      briefings
        .slice(0, 5)
        .map((b) => `- [${dayKey(b.date)}] ${cut(b.content, 150)}`)
        .join("\n")
    );
  }

  // --- dziennik (double-gated: scope allows it AND profile opt-in) ---
  if (renderJournal && journal.length > 0) {
    const rows = journal
      .map((e) => {
        const body = str(e.redactedText);
        if (!body) return "";
        return `- ${format(e.createdAt, "d MMM", { locale: pl })} [${e.category ?? "?"}/${e.topic ?? "?"}]: ${cut(body, 160)}`;
      })
      .filter(Boolean);
    if (rows.length > 0) built.set("dziennik", rows.join("\n"));
  }

  /* ---------------- assemble --------------------------------------- */

  const sections: UserContextSection[] = [];
  for (const key of SECTION_ORDER) {
    const raw = built.get(key);
    if (!raw || !raw.trim()) continue;
    sections.push({
      key,
      title: SECTION_TITLE[key],
      body: cut(raw, SECTION_BUDGET[key]),
      stable: STABLE_SECTIONS.has(key),
    });
  }

  // "profil", "dzis" and "dieta" render even for a brand-new account (defaults and
  // zeros), so counting sections would never detect an empty user. Only sections
  // that require the user to have actually DONE something count as evidence.
  const EVIDENCE: UserContextSectionKey[] = [
    "wnioski",
    "cele",
    "plany",
    "nawyki",
    "treningi",
    "briefingi",
    "dziennik",
  ];

  const render = (keys?: UserContextSectionKey[]): string => {
    const wanted = keys ? new Set(keys) : null;
    const picked = sections.filter((s) => !wanted || wanted.has(s.key));
    const head = `# KONTEKST UZYTKOWNIKA (${USER_CONTEXT_VERSION}, stan na ${format(refDay, "d MMMM yyyy", { locale: pl })})`;
    if (picked.length === 0) {
      return `${head}\n\nBrak danych o uzytkowniku. Zadawaj pytania zamiast zakladac fakty.`;
    }
    const body = picked.map((s) => `## ${s.title}\n${s.body}`).join("\n\n");
    // New account: nearly everything is empty and models start inventing facts.
    const evidence = picked.filter((s) => EVIDENCE.includes(s.key)).length;
    const thin =
      evidence < 2
        ? "\n\nUWAGA: to nowy uzytkownik, danych jest malo. Zadawaj pytania zamiast zakladac fakty i nie podawaj liczb, ktorych nie ma powyzej."
        : "";
    const out = `${head}\n\n${body}${thin}`;
    return out.length > maxChars ? out.slice(0, maxChars - 3).trimEnd() + "..." : out;
  };

  const text = render();
  const stableText = sections
    .filter((s) => s.stable)
    .map((s) => `## ${s.title}\n${s.body}`)
    .join("\n\n");
  const volatileText = sections
    .filter((s) => !s.stable)
    .map((s) => `## ${s.title}\n${s.body}`)
    .join("\n\n");

  return {
    userId,
    version: USER_CONTEXT_VERSION,
    builtAt: new Date(),
    referenceDate: refDay,
    sections,
    filled: sections.map((s) => s.key),
    facts: {
      firstName,
      currentWeightKg,
      bmr,
      tdee,
      targetCalories,
      activeGoalCount: goals.length,
      journalShared,
    },
    text,
    stableText,
    volatileText,
    // PL ≈ 3.5 characters per token. Estimate, not a measurement (BRAIN-SPEC R8).
    approxTokens: Math.round(text.length / 3.5),
    toPromptString: render,
  };
}

/* ------------------------------------------------------------------ */
/*  Convenience: ready-to-inject system-prompt block                   */
/* ------------------------------------------------------------------ */

/**
 * Standard instruction appended after the context so mentors quote real numbers
 * instead of inventing them.
 */
export const CONTEXT_USAGE_INSTRUCTION =
  "Odwoluj sie do KONKRETNYCH liczb i faktow z kontekstu powyzej. " +
  "Nie wymyslaj danych, ktorych tam nie ma — jesli czegos brakuje, zapytaj.";

/**
 * Builds `systemPrompt + user context + usage instruction` in one call.
 * Used by every mentor-facing route so the joining format stays identical.
 */
export async function withUserContext(
  systemPrompt: string,
  userId: string,
  opts: UserContextOptions = {}
): Promise<{ system: string; context: UserContext }> {
  const context = await buildUserContext(userId, opts);
  const system = [
    systemPrompt,
    "",
    "---",
    "",
    "## Kontekst o uzytkowniku",
    context.text,
    "",
    CONTEXT_USAGE_INSTRUCTION,
  ].join("\n");
  return { system, context };
}
