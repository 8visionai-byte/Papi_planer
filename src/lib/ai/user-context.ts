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
 *
 * ZMIANY (2026-07-27) adds the section that outranks all of the above. The owner
 * passed his karate exam, wrote it down in his own words, and the next morning the
 * plan still told him to spare his legs before it. The exam survived in three places
 * at once: the mentors' `systemPrompt` ("Egzamin na zielona belke: za ~4 tygodnie",
 * pasted verbatim into the day-plan system prompt by plan-generator.ts), the week-4
 * `MentorPlan` rows (attached to goals that are legitimately still active, so the
 * "closed goal" filter below never saw them), and the day plan copying itself
 * forward. None of those can be fixed by filtering harder, because none of them is
 * wrong data - they are OLD data. So the context now states, at the very top and in
 * the user's own words, what has since changed, and says explicitly that it beats
 * everything below it. `plan-generator.ts` repeats the same rule at the end of the
 * prompt, where the model is actually writing tasks.
 *
 * ENERGIA (docs/ENERGIA-SPEC.md section 7) adds a fourth section under the same
 * defence: `energy_*` tables only reach production when the container restarts, so
 * the read is wrapped and a failure means "no section", never a broken context.
 * It is deliberately NOT in every scope — only "chat", "day-plan" and "briefing".
 * A 4-week goal plan or a single training slot does not get better from knowing
 * that today's water is at 30%, and the Round Table sends the context (2N+2) times.
 * The numbers themselves are never computed here: `getEnergySummary` owns the math,
 * this file only turns it into two sentences.
 */

import { prisma } from "@/lib/db/prisma";
import { startOfDay, subDays, addDays, format } from "date-fns";
import { pl } from "date-fns/locale";
import { getCurrentBodyMetrics } from "@/lib/ai/body-metrics";
import {
  getActiveInsights,
  listUserStatedInsights,
  type UserStatedInsight,
} from "@/lib/ai/insights-context";
import { getCalendarEvents, polishDayBounds } from "@/lib/google/calendar";
import { getEnergySummary, polishDateKey, type EnergySummary } from "@/lib/energy";

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
  | "zmiany"
  | "profil"
  | "wnioski"
  | "cele"
  | "plany"
  | "nawyki"
  | "treningi"
  | "dieta"
  | "energia"
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

  /**
   * "Co sie zmienilo" - what the user himself said has changed, plus the goals he
   * closed in the last 60 days. Rendered FIRST and declared as outranking every
   * other section. On in "chat", "day-plan", "briefing" and "debate".
   */
  includeChanges?: boolean;
  includeProfile?: boolean;
  /** Long-term memory (UserInsight) rendered by insights-context.ts. */
  includeInsights?: boolean;
  includeGoals?: boolean;
  includeMentorPlans?: boolean;
  includeHabits?: boolean;
  includeTraining?: boolean;
  includeDiet?: boolean;
  /**
   * "Energia dnia" — today's energy score, the weakest pillar and the 7-day average.
   * ON only in "chat", "day-plan" and "briefing"; see the note at the top of the file.
   * Silently skipped when the user has no pillars in the database yet.
   */
  includeEnergy?: boolean;
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
  /**
   * The raw numbers behind the "Energia dnia" section, or `null` when the section was
   * not built. Exposed so `plan-generator.ts` can apply the "pillar below 50%" rule
   * without a second round trip to the database, and without parsing its own prose.
   */
  energy: EnergySummary | null;
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

/**
 * Fixed opening of the "zmiany" section. It is not decoration and it is not
 * paraphrasable: every other section of this context, plus the mentors' system
 * prompts, plus the saved plans, are all older than these lines, and the model has
 * no other way of knowing that.
 */
const ZMIANY_PREAMBLE =
  "Ponizsze fakty sa AKTUALNE i uniewazniaja wszystko, co mowia o nich starsze dane: " +
  "profil, prompty mentorow, stare plany i cele. Jesli cos ponizej mowi, ze wydarzenie " +
  "juz sie odbylo, NIE planuj do niego przygotowan.";

/** Budget for the facts themselves. The preamble above is fixed and always fits. */
const ZMIANY_FACTS_BUDGET = 400;

const SECTION_BUDGET: Record<UserContextSectionKey, number> = {
  // Derived, not a magic number: the section is "fixed instruction + 400 characters
  // of facts", and hardcoding the sum here would silently eat the last fact the day
  // somebody rewords the preamble.
  zmiany: ZMIANY_PREAMBLE.length + 1 + ZMIANY_FACTS_BUDGET,
  profil: 700,
  wnioski: 900,
  cele: 700,
  plany: 700,
  nawyki: 500,
  treningi: 700,
  dieta: 450,
  // Two sentences, seven pillar names at most. Dense information, small budget.
  energia: 300,
  dzis: 600,
  briefingi: 700,
  mentorzy: 300,
  dziennik: 700,
};

/**
 * Heading of the "zmiany" section, exported so `plan-generator.ts` can quote it
 * character for character. A rule that says 'the section "Co się zmieniło" wins'
 * while the context prints "Co sie zmienilo (...)" asks the model to match two
 * strings that are not the same string.
 */
export const ZMIANY_SECTION_TITLE = "Co sie zmienilo (NAJWAZNIEJSZE, ma pierwszenstwo)";

const SECTION_TITLE: Record<UserContextSectionKey, string> = {
  // The parenthesis is part of the heading on purpose: a model skimming headings
  // has to see the priority before it reads a single fact.
  zmiany: ZMIANY_SECTION_TITLE,
  profil: "Kim jest",
  wnioski: "Co juz wiemy o uzytkowniku",
  cele: "Aktywne cele",
  plany: "Plany mentorow",
  nawyki: "Nawyki",
  treningi: "Treningi i rekordy",
  dieta: "Dieta i waga",
  // Contract from docs/ENERGIA-SPEC.md section 7 — the heading is part of the format.
  energia: "Energia dnia",
  dzis: "Dzis",
  briefingi: "Ostatnie podsumowania dnia",
  mentorzy: "Aktywni mentorzy",
  dziennik: "Dziennik (za zgoda uzytkownika)",
};

/** Render order — what changed first, then identity, most volatile day data last. */
const SECTION_ORDER: UserContextSectionKey[] = [
  // Above the profile, deliberately. A correction only works when it is read before
  // the thing it corrects, and the whole-block `maxChars` cut takes from the tail.
  "zmiany",
  "profil",
  "wnioski",
  "mentorzy",
  "cele",
  "plany",
  "nawyki",
  "treningi",
  "dieta",
  // Right before "dzis": both describe the same day, and a mentor reading "nawodnienie
  // 30%" immediately above today's task list connects the two without being told to.
  "energia",
  "dzis",
  "briefingi",
  "dziennik",
];

const STABLE_SECTIONS = new Set<UserContextSectionKey>([
  "zmiany",
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

/** Collapses newlines, so one fact stays exactly one bullet. */
function oneLine(s: string): string {
  return s.replace(/\s*\n+\s*/g, " ").trim();
}

/**
 * Shortens the user's own sentence without amputating it.
 *
 * `cut()` stops at the character, which is fine for a list of dish names and wrong
 * for a correction: "Zdalem egzamin, ale nadal chce trenowac..." cut after the comma
 * says the opposite of what he wrote. So whole sentences are kept, and only when not
 * even one sentence fits does it fall back to a word boundary.
 */
function cutSentences(s: string, max: number): string {
  const t = oneLine(s);
  if (t.length <= max) return t;

  const head = t.slice(0, max);
  const lastStop = Math.max(
    head.lastIndexOf(". "),
    head.lastIndexOf("! "),
    head.lastIndexOf("? ")
  );
  // 0.4 of the budget: below that a "whole sentence" would say too little to be worth
  // dropping the rest of the thought for.
  if (lastStop > max * 0.4) return head.slice(0, lastStop + 1).trimEnd();

  const lastSpace = head.lastIndexOf(" ");
  const body = lastSpace > max * 0.5 ? head.slice(0, lastSpace) : head;
  return `${body.trimEnd()}...`;
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

/**
 * Pillar name as the context writes it: no diacritics, lower case ("Świeże powietrze"
 * -> "swieze powietrze"), exactly like the format in the spec.
 *
 * The whole context block is deliberately diacritic-free, and pillar names are the
 * first strings here that come straight from the database, where the user may have
 * renamed them. NFD does NOT decompose "ł" (it is a single codepoint, not l + stroke),
 * so "Umysł" would come out as "umys" without the explicit replacement below.
 */
function pillarLabel(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .trim();
}

/** Hour of the day in Warsaw, regardless of the container clock (which is UTC). */
function polishHour(now: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    timeZone: "Europe/Warsaw",
  }).format(now);
  const n = Number(h);
  return Number.isFinite(n) ? n : 12;
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

/** A goal the user closed recently, whatever the outcome. */
interface ClosedGoal {
  title: string;
  status: string;
  closedAt: Date;
}

/**
 * Goals closed (achieved or abandoned) inside the window. Unlike
 * `loadAchievedGoals`, abandoned ones count too: "odpuscilem maraton" invalidates
 * a marathon plan exactly as hard as finishing it would.
 *
 * `achievedAt` is the close date, but rows written before that column existed have
 * it empty, so `updatedAt` stands in - a goal is only read here when it is already
 * closed, and the last write to a closed goal IS the moment it was closed.
 */
async function loadRecentlyClosedGoals(
  userId: string,
  lifeAreaId: string | null,
  since: Date
): Promise<ClosedGoal[]> {
  try {
    const rows = await prisma.goal.findMany({
      where: {
        userId,
        status: { in: ["achieved", "abandoned", "completed"] },
        ...(lifeAreaId ? { lifeAreaId } : {}),
        OR: [
          { achievedAt: { gte: since } },
          { AND: [{ achievedAt: null }, { updatedAt: { gte: since } }] },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { title: true, status: true, achievedAt: true, updatedAt: true },
    });
    return rows.map((g) => ({
      title: g.title,
      status: g.status,
      closedAt: g.achievedAt ?? g.updatedAt,
    }));
  } catch {
    // `achieved_at` may not exist on this database yet.
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  "Co sie zmienilo" - facts that outrank every other section         */
/* ------------------------------------------------------------------ */

/**
 * Written into `MentorPlan.notes` when the user accepts "wylacz ten plan"
 * (/api/proposals/[id]). `MentorPlan` has no `active` column and the schema is
 * frozen, and a plan is never deleted - the completed tasks inside it are the only
 * record that the work happened. So a retired plan stays in the table, carries this
 * marker, and stops reaching the AI here.
 */
export const MENTOR_PLAN_RETIRED_MARKER = "[plan zamkniety]";

export function isMentorPlanRetired(notes: string | null | undefined): boolean {
  return typeof notes === "string" && notes.includes(MENTOR_PLAN_RETIRED_MARKER);
}

/** Lower case, no Polish diacritics. "ł" is one codepoint, so NFD alone loses it. */
function deaccent(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase();
}

/** Length of the prefix used for matching. Polish inflects endings, not beginnings. */
const STEM_LEN = 6;

function stem(word: string): string {
  return word.slice(0, STEM_LEN);
}

/**
 * Words that must never become a "this is over" keyword. Two groups: Polish glue
 * ("poniewaz", "wszystko") and the vocabulary every training plan is written in
 * ("tydzien", "trening", "codziennie"). Without the second group, one note saying
 * "skonczylem tygodniowy cykl" would silently delete every plan in the app.
 */
const CHANGE_STOPWORDS = new Set(
  [
    "poniewaz", "dlatego", "wszystko", "wszystkie", "jeszcze", "bardziej", "naprawde",
    "wlasnie", "zostal", "zostala", "zostalo", "potrzebuje", "potrzeba", "przypomnien",
    "przypomnienie", "musialem", "chcialbym", "wiecej", "mniej", "troche", "zawsze",
    "nigdy", "czasami", "dzisiaj", "wczoraj", "teraz", "bardzo", "swoje", "swoja",
    "tydzien", "tygodnia", "tygodniu", "tygodniowo", "codziennie", "dziennie",
    "dzienny", "dziennych", "miesiac", "godzina", "godzin", "minuta", "minut",
    "trening", "treningu", "treningi", "cwiczenie", "cwiczenia", "powtorzenie",
    "powtorzen", "seria", "serie", "sesja", "sesje", "zdrowie", "dieta", "praca",
    "poziom", "efekt", "wynik", "forma", "ciala", "rano", "wieczorem", "poranna",
    "wieczorna", "nauka", "cwiczyc", "robilem", "robisz", "zrobic",
    // Measured, not guessed. The real note produced "egzami", "zielon" and "przygo".
    // The first one does all the work. The other two are ordinary words that would
    // also strike out "zielone warzywa" in a diet plan and "przygotowanie posilkow"
    // anywhere, and dropping them costs nothing: every task they caught says
    // "egzamin" as well.
    "przygotowanie", "przygotowania", "przygotowan", "zielony", "zielona", "zielone",
    "czerwony", "niebieski", "posilek", "posilki", "warzywa",
  ].map(stem)
);

/** Sentences in which the user says something is over. Nothing else feeds keywords. */
const DONE_MARKERS =
  /(zdal|zdan|skonczy|zakonczy|ukoncz|zalicz|osiagn|odbyl|minal|minela|przestal|juz nie|nie potrzebuj|nie robie|nie chodze|nie trenuj|mam juz|jest za mna|zrezygnowal|odpuscil)/;

/**
 * Nouns naming something that is over, taken from the user's own notes and from the
 * titles of goals he closed.
 *
 * Two rules keep this from turning into a wrecking ball:
 *  1. only sentences that actually say something ended contribute words, so
 *     "lubie poranne bieganie" never retires anything;
 *  2. any word that also appears in an ACTIVE goal, an active life area or an active
 *     habit is dropped. That single subtraction is what separates "egzamin" (over)
 *     from "karate" (very much not over - he still has two active karate goals).
 *
 * Exported together with {@link makeStaleMatcher} so the decision can be replayed on
 * real rows without a database: given a note and the active goals, the keyword list
 * is the whole behaviour, and it is not something to find out about in production.
 */
export function buildChangeKeywords(
  notes: UserStatedInsight[],
  closedGoals: ClosedGoal[],
  stillActive: string[]
): string[] {
  const protectedStems = new Set<string>();
  for (const text of stillActive) {
    for (const w of deaccent(text).split(/[^a-z0-9]+/)) {
      if (w.length >= STEM_LEN) protectedStems.add(stem(w));
    }
  }

  const picked = new Map<string, string>(); // stem -> first word seen (for logging)

  const harvest = (text: string) => {
    for (const raw of deaccent(text).split(/[^a-z0-9]+/)) {
      if (raw.length < STEM_LEN) continue;
      if (!/^[a-z][a-z0-9]*$/.test(raw)) continue;
      // The verb that ENDS something is not the thing that ended. Without this,
      // "zdalem egzamin" also harvested "zdalem", and "skonczylem kurs" would
      // harvest "skoncz" and then strike out an open task called "Skoncz rozdzial".
      if (DONE_MARKERS.test(raw)) continue;
      const s = stem(raw);
      if (CHANGE_STOPWORDS.has(s) || protectedStems.has(s)) continue;
      if (!picked.has(s)) picked.set(s, raw);
    }
  };

  for (const n of notes) {
    // Sentence by sentence: only the clause that says "it is over" names the thing
    // that is over. The rest of a note is usually about what he wants instead.
    for (const sentence of `${n.title}. ${n.content}`.split(/[.!?;\n]+/)) {
      if (DONE_MARKERS.test(deaccent(sentence))) harvest(sentence);
    }
  }
  // A closed goal's title is a closed subject in full - no sentence filter needed.
  for (const g of closedGoals) harvest(g.title);

  // Eight is plenty for one person's recent changes, and it caps the regex below.
  return Array.from(picked.keys()).slice(0, 8);
}

/**
 * `true` when the text talks about something the user has already finished.
 * Matches on a word BEGINNING ("egzamin" hits "egzaminowy", "egzaminacyjna",
 * "egzaminem") and never mid-word, so "dzienn" cannot swallow "codzienna".
 */
export function makeStaleMatcher(keywords: string[]): (text: string) => boolean {
  if (keywords.length === 0) return () => false;
  const re = new RegExp(`(?:^|[^a-z])(${keywords.join("|")})`, "i");
  return (text: string) => re.test(deaccent(text));
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

/**
 * Today's energy summary, or `null`.
 *
 * `getEnergySummary` already swallows its own errors, and it already returns `null`
 * for a user whose pillars are not in the database (scoring the code defaults would
 * invent a fact about him). The second try/catch here is not redundant: the three
 * `energy_*` tables only exist in production after the container restarts, and a
 * context that dies on a table which is minutes away would take EVERY mentor, the
 * day plan and the evening briefing down with it. One missing section is the correct
 * failure mode; a 500 is not.
 */
async function loadEnergySummary(userId: string): Promise<EnergySummary | null> {
  try {
    return await getEnergySummary(userId);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Scope presets                                                      */
/* ------------------------------------------------------------------ */

type SectionFlags = Required<
  Pick<
    UserContextOptions,
    | "includeChanges"
    | "includeProfile"
    | "includeInsights"
    | "includeGoals"
    | "includeMentorPlans"
    | "includeHabits"
    | "includeTraining"
    | "includeDiet"
    | "includeEnergy"
    | "includeToday"
    | "includeBriefings"
    | "includeMentors"
    | "includeJournal"
    | "includeCalendar"
  >
>;

const ALL_ON: SectionFlags = {
  // OFF in the base set, switched on below by the four scopes that plan or talk.
  // A single training slot does not need to be told the exam is over; the day plan
  // and every conversation do.
  includeChanges: false,
  includeProfile: true,
  includeInsights: true,
  includeGoals: true,
  includeMentorPlans: true,
  includeHabits: true,
  includeTraining: true,
  includeDiet: true,
  // OFF in the base set on purpose: the spec names exactly three scopes for it
  // (chat, day-plan, briefing) and they switch it on below.
  includeEnergy: false,
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
  chat: {
    ...ALL_ON,
    includeJournal: true,
    includeEnergy: true,
    includeChanges: true,
  },
  // Planning today: needs habits, yesterday's results, training load — and energy,
  // because a pillar below 50% is what the generator turns into one concrete task.
  // `includeChanges` is not optional here: this is the scope that kept planning a
  // warm-up for an exam that had already been passed.
  "day-plan": {
    ...ALL_ON,
    includeMentors: true,
    includeEnergy: true,
    includeChanges: true,
  },
  // 4-week goal plan: long horizon, no need for today's meals.
  // `includeChanges` belongs here more than anywhere else: this is the scope that
  // WRITES the weekly mentor plans, and "TYDZIEN EGZAMINOWY" was written by it. A
  // filter downstream can hide such a week, but only this flag stops it being born.
  "goal-plan": {
    ...ALL_ON,
    includeDiet: false,
    includeToday: false,
    includeJournal: true,
    includeChanges: true,
  },
  // Single training slot: form, records, how the last days went.
  "activity-plan": {
    ...ALL_ON,
    includeMentorPlans: false,
    includeHabits: false,
    includeDiet: false,
  },
  // Evening summary: everything about the day being summarized.
  briefing: {
    ...ALL_ON,
    includeMentors: true,
    includeEnergy: true,
    includeChanges: true,
  },
  // Round Table sends the context (2N+2) times — keep it lean.
  debate: {
    ...ALL_ON,
    includeMentorPlans: false,
    includeDiet: false,
    includeBriefings: false,
    includeJournal: true,
    includeChanges: true,
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
    includeChanges: opts.includeChanges ?? preset.includeChanges,
    includeProfile: opts.includeProfile ?? preset.includeProfile,
    includeInsights: opts.includeInsights ?? preset.includeInsights,
    includeGoals: opts.includeGoals ?? preset.includeGoals,
    includeMentorPlans: opts.includeMentorPlans ?? preset.includeMentorPlans,
    includeHabits: opts.includeHabits ?? preset.includeHabits,
    includeTraining: opts.includeTraining ?? preset.includeTraining,
    includeDiet: opts.includeDiet ?? preset.includeDiet,
    includeEnergy: opts.includeEnergy ?? preset.includeEnergy,
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
  // Window for "Co sie zmienilo". Two months is long enough that a change made
  // during a holiday still corrects the plans, and short enough that last spring's
  // wins do not squat on a 400-character budget.
  const d60 = subDays(refDay, 60);

  const areaFilter = lifeAreaId ? { lifeAreaId } : {};

  // The energy summary always describes TODAY (it goes through `polishDateKey`), so a
  // caller summarizing a day that already ended — /api/briefing/finalize passes
  // `referenceDate` — would get today's numbers printed under yesterday's heading.
  // Drop the section instead of lying. When no reference date is given we ARE building
  // for now, which keeps the normal path (chat, day plan, evening briefing) intact
  // even between Polish midnight and 02:00, where `refDay` still says "yesterday"
  // because the container clock is UTC.
  const energyIsAboutRefDay =
    !opts.referenceDate || polishDateKey(opts.referenceDate) === polishDateKey();

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
    energy,
    // "Co sie zmienilo": the user's own notes, and the goals he closed recently.
    userNotes,
    closedGoals,
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
            // Carries the "[plan zamkniety]" marker. Filtered in JS, not in the
            // query: `NOT { notes: { contains } }` drops rows whose notes are NULL,
            // because in SQL `NOT (NULL LIKE ...)` is NULL, not true - and almost
            // every plan in the table has no notes at all.
            notes: true,
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
          // A row flagged as a copy of a calendar meeting is hidden on the screen,
          // so it can never be ticked. Counting it here would tell every mentor
          // "2/10 zrobione" about a day where 2/9 was the truth, and would put the
          // meeting into "Niezrobione" a second time.
          where: { duplicateOfMeetingId: null },
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
    flags.includeEnergy && energyIsAboutRefDay
      ? loadEnergySummary(userId)
      : Promise.resolve(null),
    flags.includeChanges
      ? listUserStatedInsights(userId, 6)
      : Promise.resolve([] as UserStatedInsight[]),
    flags.includeChanges
      ? loadRecentlyClosedGoals(userId, lifeAreaId, d60)
      : Promise.resolve([] as ClosedGoal[]),
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

  // --- zmiany: what is no longer true, and beats everything below ---
  //
  // Built first because the rest of the function needs `staleKeywords`: the same
  // facts that tell the model "the exam is over" are what strike the exam-week tasks
  // out of the mentor plans further down.
  let staleKeywords: string[] = [];
  if (flags.includeChanges && (userNotes.length > 0 || closedGoals.length > 0)) {
    // His own words first: they are the newest and they are unambiguous. Closed
    // goals follow as the app's own record of the same kind of event.
    const facts: string[] = [
      // Quoted, not paraphrased. The app rewording "zdalem egzamin" into its own
      // summary is how the fact got soft enough to lose to a four-week-old plan.
      ...userNotes.map(
        (n) =>
          `- ${cutSentences(n.content || n.title, 170)} (napisal to sam, ${dayKey(n.createdAt)})`
      ),
      ...closedGoals.map((g) => {
        const verb = g.status === "abandoned" ? "Odpuszczony" : "Osiagniety";
        return `- Cel zamkniety, ${verb.toLowerCase()}: ${cut(g.title, 70)} (${dayKey(g.closedAt)})`;
      }),
    ];

    // Whole facts are dropped when the budget runs out, never half a sentence:
    // "Zdal egzamin na zielona..." is a worse thing to hand a planner than one
    // fact fewer.
    const kept: string[] = [];
    let used = 0;
    for (const f of facts) {
      if (used + f.length + 1 > ZMIANY_FACTS_BUDGET) continue;
      kept.push(f);
      used += f.length + 1;
    }

    if (kept.length > 0) {
      built.set("zmiany", [ZMIANY_PREAMBLE, ...kept].join("\n"));
    }

    // Words that must not resurrect: anything the user still has running is
    // subtracted, so closing an exam never retires the sport it belonged to.
    const stillActive = [
      ...goals.map((g) => g.title),
      ...habits.map((h) => h.name),
      ...mentors.map((m) => m.name),
    ];
    staleKeywords = buildChangeKeywords(userNotes, closedGoals, stillActive);
  }
  const isStale = makeStaleMatcher(staleKeywords);

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

    const taskTitles = (plan: (typeof mentorPlans)[number]): string[] =>
      (Array.isArray(plan.tasks) ? (plan.tasks as PlanTask[]) : [])
        .map((t) => (typeof t.title === "string" ? t.title : ""))
        .filter(Boolean);

    // Three ways a plan stops counting, in order of bluntness:
    //  1. the user switched it off (marker in `notes`);
    //  2. every task in it is about something that is already over. This is the case
    //     the "closed goal" filter in the query cannot reach: the week-4 karate plans
    //     hang off goals that are still perfectly active ("sila i szybkosc uderzen"),
    //     yet every task inside says "tydzien egzaminowy". The goal lives, the week
    //     does not;
    //  3. individual tasks below.
    const livePlans = mentorPlans.filter((plan) => {
      if (isMentorPlanRetired(plan.notes)) return false;
      const titles = taskTitles(plan);
      return titles.length === 0 || !titles.every((t) => isStale(t));
    });

    // Highest weekNumber per (mentor, goal) pair = the plan currently in play.
    // Filtered BEFORE this pick on purpose: when the exam week is dropped, week 3
    // becomes the current plan instead of the pair silently vanishing, so the mentor
    // still has real work in the context.
    const currentWeek = new Map<string, (typeof mentorPlans)[number]>();
    for (const plan of livePlans) {
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
        // The open-task list is the shortlist the day planner copies from, so a
        // single surviving "kata egzaminacyjna 5 min rano" is enough to put the
        // finished exam back into tomorrow morning. The counter above still shows
        // the honest total: the work was really planned, it is just no longer due.
        if (isStale(title)) continue;
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

  // --- energia (ENERGIA-SPEC section 7) ---
  // Two sentences, exactly the wording the spec fixes. The arithmetic is NOT redone
  // here: `getEnergySummary` is the same code path the ring on the dashboard uses, so
  // the number a mentor quotes and the number the user sees can never drift apart.
  //
  // No summary means NO section, not an empty heading: a bare "## Energia dnia" is an
  // invitation for the model to fill the silence with something plausible.
  if (flags.includeEnergy && energy?.today) {
    // "brak oceny" and "0/10" are two different facts. A mentor told "0/10" starts
    // consoling a man who has simply not touched the slider yet.
    const felt = energy.today.feltEnergy;
    const feltPart =
      felt !== null ? ` (odczuwana ${felt}/10)` : " (odczuwana: brak oceny)";

    const head: string[] = [`Dzis: ${energy.today.total}%${feltPart}.`];
    if (energy.weakestToday) {
      head.push(
        `Najslabszy filar: ${pillarLabel(energy.weakestToday.name)} ${energy.weakestToday.percent}%.`
      );
    }
    // Nothing is ticked off at 08:00, so the score is honestly low — and a model
    // reading "Dzis: 12%" in a morning plan will lecture the user for a day he has
    // not lived yet. Not in the spec, deliberate: it prevents a false accusation.
    if (polishHour(new Date()) < 20) {
      head.push("Dzien jeszcze trwa, liczby moga urosnac.");
    }
    const line1 = head.join(" ");

    const avgPart =
      energy.weekAverage !== null ? `Srednia z 7 dni: ${energy.weekAverage}%.` : "";

    // Budget-aware: with seven weak pillars the list would outgrow the section, and
    // `joinFit` drops whole pillars instead of leaving "swieze powie...".
    const room = SECTION_BUDGET.energia - line1.length - avgPart.length - 3;
    const belowJoined = joinFit(
      "Filary ponizej 60%: ",
      energy.belowTarget.map((p) => `${pillarLabel(p.name)} ${p.percent}%`),
      room
    );
    const belowPart = belowJoined
      ? `${belowJoined}.`
      : energy.belowTarget.length === 0
        ? "Zaden filar nie jest ponizej 60%."
        : "";

    const line2 = [avgPart, belowPart].filter(Boolean).join(" ");
    built.set("energia", [line1, line2].filter(Boolean).join("\n"));
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
            .map((a) => {
              const at = a.scheduledAt ? `${a.scheduledAt} ` : "";
              // Today's own plan is the shortest path back into tomorrow's plan
              // (a replan reads it verbatim). The row stays visible - it really is
              // on his screen - but it is labelled so nobody re-plans it.
              const flag = isStale(a.name) ? " [nieaktualne]" : "";
              return `${at}${a.name}${flag}`;
            })
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
    "zmiany",
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
    energy,
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
