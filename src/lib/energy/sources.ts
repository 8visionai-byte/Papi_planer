/**
 * Readers for the "auto" components — the ones the user must never type twice.
 *
 * Spec, section 3: values of `auto` components do NOT live in `EnergyEntry.values`.
 * They are read from the rest of the app every time the day is scored, so one truth
 * never ends up living in two places (a meal edited in /diet has to move the energy
 * ring without touching /energy).
 *
 * Two rules hold everywhere in this file:
 *  1. `null` means "we do not know", `0` means "we know, and it is zero". Scoring
 *     treats both as 0%, but the UI can tell them apart and say "brak danych".
 *  2. The whole day is loaded with ONE `Promise.all` (four queries), never one query
 *     per component. Every per-source function below is a pure read over that batch.
 */

import { prisma } from "@/lib/db/prisma";
import { detectActivityType } from "@/lib/ai/calorie-calculator";
import { getCurrentBodyMetrics } from "@/lib/ai/body-metrics";

export const ENERGY_SOURCES = [
  "calories",
  "protein",
  "activity-minutes",
  "study-minutes",
  "meditation-minutes",
  "sleep-hours",
  "habits-done",
] as const;

export type EnergySource = (typeof ENERGY_SOURCES)[number];

export function isEnergySource(raw: unknown): raw is EnergySource {
  return typeof raw === "string" && (ENERGY_SOURCES as readonly string[]).includes(raw);
}

/* ------------------------------------------------------------------ */
/*  Which activity counts as what                                      */
/* ------------------------------------------------------------------ */

/**
 * Movement types named in the build brief. These are the ones that fill `ruch-min`
 * and that flip the water target up by 500 ml.
 */
const MOVEMENT_TYPES_CORE = [
  "training",
  "running",
  "cycling",
  "swimming",
  "karate",
  "boxing",
  "walking",
  "stretching",
  "yoga",
];

/**
 * The same family of types that already exists in lib/ai/calorie-calculator.ts
 * (METS_BY_TYPE). Without them a logged "HIIT" or "crossfit" would score zero
 * movement minutes, which would be a lie about the day.
 */
const MOVEMENT_TYPES_EXTRA = [
  "workout",
  "exercise",
  "hiit",
  "crossfit",
  "rowing",
  "martial_arts",
  "pilates",
  "sport",
  "practice",
];

const MOVEMENT_TYPES = new Set([...MOVEMENT_TYPES_CORE, ...MOVEMENT_TYPES_EXTRA]);
const STUDY_TYPES = new Set(["study"]);
const MEDITATION_TYPES = new Set(["meditation"]);

/**
 * Coarse buckets where the activity NAME carries the real meaning, so the name gets
 * the last word. Verified against the owner's live plan on 2026-07-26:
 *   "Vipassana poranna"    -> type "mindset"  (not "meditation")
 *   "Spacer ze Stefanem"   -> type "health"   (not "walking")
 * The planner only ever writes training / exercise / study / work / health / mindset /
 * nutrition / rest / scheduled, so without this a real walk and a real meditation
 * would score zero. A declared "work", "rest" or "nutrition" is still trusted as-is.
 */
const NAME_DECIDES_TYPES = new Set([
  "",
  "scheduled",
  "manual",
  "other",
  "task",
  "custom",
  "health",
  "mindset",
]);

/** Language study, which the spec counts as Nauka but which has no own type. */
const LANGUAGE_KEYWORDS = [
  "jezyk",
  "język",
  "angielsk",
  "niemieck",
  "hiszpansk",
  "hiszpańsk",
  "francusk",
  "wlosk",
  "włosk",
  "rosyjsk",
  "duolingo",
  "english",
  "deutsch",
  "slowk", // "słówka"
  "słówk",
];

/** Habit names that mean "I meditated", used when there is no Activity row. */
const MEDITATION_HABIT_KEYWORDS = ["vipassana", "medytacj", "medytow", "medytuj"];

/**
 * One ticked meditation habit is worth one session. The spec fixes the length:
 * "Cel medytacji to dwie godziny: godzina rano i godzina wieczorem." So a habit tick
 * is 60 minutes, and the morning + evening pair adds up to exactly the 120 min target.
 */
export const MEDITATION_HABIT_MINUTES = 60;

/* ------------------------------------------------------------------ */
/*  Raw day                                                            */
/* ------------------------------------------------------------------ */

interface RawActivity {
  type: string;
  name: string;
  durationMin: number | null;
  completed: boolean;
}

interface RawMeal {
  calories: number | null;
  protein: number | null;
}

export interface RawDay {
  /** null = no DailyLog row for that date at all. */
  log: {
    sleepHours: number | null;
    meals: RawMeal[];
    activities: RawActivity[];
  } | null;
  habits: Array<{ id: string; name: string }>;
  doneHabitIds: Set<string>;
  profileData: unknown;
}

function emptyRawDay(): RawDay {
  return { log: null, habits: [], doneHabitIds: new Set(), profileData: null };
}

/**
 * Everything the auto components need, in one round of parallel queries.
 * `date` must be UTC midnight of the Polish calendar day (both `DailyLog.date` and
 * `HabitCompletion.date` are `@db.Date` columns).
 */
async function loadRawDay(userId: string, date: Date): Promise<RawDay> {
  try {
    const [log, habits, completions, profile] = await Promise.all([
      prisma.dailyLog.findUnique({
        where: { userId_date: { userId, date } },
        select: {
          sleepHours: true,
          meals: { select: { calories: true, protein: true } },
          activities: {
            select: { type: true, name: true, durationMin: true, completed: true },
          },
        },
      }),
      prisma.habit.findMany({
        where: { userId, active: true },
        select: { id: true, name: true },
      }),
      prisma.habitCompletion.findMany({
        where: { userId, date, completed: true },
        select: { habitId: true },
      }),
      prisma.userProfile.findUnique({ where: { userId }, select: { data: true } }),
    ]);

    return {
      log: log
        ? { sleepHours: log.sleepHours, meals: log.meals, activities: log.activities }
        : null,
      habits,
      doneHabitIds: new Set(completions.map((c) => c.habitId)),
      profileData: profile?.data ?? null,
    };
  } catch (err) {
    // The energy screen must render even when a table behind a source is missing.
    console.warn("[energy/sources] nie udalo sie wczytac dnia:", err);
    return emptyRawDay();
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers over the raw day                                           */
/* ------------------------------------------------------------------ */

function normalizeName(name: string): string {
  return (name || "").toLowerCase();
}

/**
 * The canonical type of an activity. A precise declared type always wins; the coarse
 * buckets get resolved from the name, reusing the keyword table that already drives
 * calorie estimation instead of inventing a second one.
 */
function resolvedType(a: RawActivity): string {
  const declared = (a.type || "").toLowerCase();
  if (!NAME_DECIDES_TYPES.has(declared)) return declared;
  return detectActivityType(a.name, declared).toLowerCase();
}

function isMovement(a: RawActivity): boolean {
  return MOVEMENT_TYPES.has(resolvedType(a));
}

function isStudy(a: RawActivity): boolean {
  if (STUDY_TYPES.has(resolvedType(a))) return true;
  // Languages are Nauka too, but no activity type carries that meaning.
  const n = normalizeName(a.name);
  return LANGUAGE_KEYWORDS.some((k) => n.includes(k));
}

function isMeditation(a: RawActivity): boolean {
  return MEDITATION_TYPES.has(resolvedType(a));
}

function minutesOf(a: RawActivity): number {
  return typeof a.durationMin === "number" && a.durationMin > 0 ? a.durationMin : 0;
}

/** Sum of completed activities matching `pick`. null when the day has no activities. */
function completedMinutes(raw: RawDay, pick: (a: RawActivity) => boolean): number | null {
  if (!raw.log) return null;
  if (raw.log.activities.length === 0) return null;
  let total = 0;
  for (const a of raw.log.activities) {
    if (!a.completed) continue;
    if (!pick(a)) continue;
    total += minutesOf(a);
  }
  return total;
}

/* ------------------------------------------------------------------ */
/*  One function per source                                            */
/* ------------------------------------------------------------------ */

/** Sum of kcal from the day's meals. null when nothing was logged. */
export function readCalories(raw: RawDay): number | null {
  if (!raw.log) return null;
  const withValue = raw.log.meals.filter((m) => typeof m.calories === "number");
  if (withValue.length === 0) return null;
  return withValue.reduce((sum, m) => sum + (m.calories ?? 0), 0);
}

/** Sum of protein (g) from the day's meals. null when nothing was logged. */
export function readProtein(raw: RawDay): number | null {
  if (!raw.log) return null;
  const withValue = raw.log.meals.filter((m) => typeof m.protein === "number");
  if (withValue.length === 0) return null;
  return withValue.reduce((sum, m) => sum + (m.protein ?? 0), 0);
}

/** Minutes of COMPLETED movement activities. */
export function readActivityMinutes(raw: RawDay): number | null {
  return completedMinutes(raw, isMovement);
}

/** Minutes of COMPLETED study, including language practice. */
export function readStudyMinutes(raw: RawDay): number | null {
  return completedMinutes(raw, isStudy);
}

/**
 * Minutes of meditation: completed meditation activities PLUS ticked meditation
 * habits (20 min each). Either source alone is enough to produce a number; only when
 * neither exists does the day stay unknown.
 */
export function readMeditationMinutes(raw: RawDay): number | null {
  const fromActivities = completedMinutes(raw, isMeditation);

  const meditationHabits = raw.habits.filter((h) => {
    const n = normalizeName(h.name);
    return MEDITATION_HABIT_KEYWORDS.some((k) => n.includes(k));
  });
  const fromHabits =
    meditationHabits.length === 0
      ? null
      : meditationHabits.filter((h) => raw.doneHabitIds.has(h.id)).length *
        MEDITATION_HABIT_MINUTES;

  if (fromActivities === null && fromHabits === null) return null;
  return (fromActivities ?? 0) + (fromHabits ?? 0);
}

/** Hours of sleep from the day's DailyLog. */
export function readSleepHours(raw: RawDay): number | null {
  if (!raw.log) return null;
  return typeof raw.log.sleepHours === "number" ? raw.log.sleepHours : null;
}

/**
 * Share of the day's habits that are ticked, as a fraction 0..1. A component wired
 * to this source should therefore be kind "up" with target 1.
 * null when the user has no active habits, because there is no share to compute.
 */
export function readHabitsDone(raw: RawDay): number | null {
  if (raw.habits.length === 0) return null;
  const done = raw.habits.filter((h) => raw.doneHabitIds.has(h.id)).length;
  return done / raw.habits.length;
}

/* ------------------------------------------------------------------ */
/*  Live body: the moving targets                                      */
/* ------------------------------------------------------------------ */

export interface BodyReading {
  /** 7-day average weight in kg. null = the app genuinely does not know it. */
  weightKg: number | null;
  /** TDEE from that weight. null = the profile is too empty to compute one. */
  tdee: number | null;
  /**
   * The calorie goal for that day, taken WHOLE from `lib/ai/body-metrics.ts`.
   *
   * The energy module used to build its own goal here (TDEE minus the deficit stored
   * on the `kcal` row) while /dieta read `getCurrentBodyMetrics().targetCalories`.
   * Two goals in one app is worse than none, so this module no longer computes one:
   * it passes through the number every other screen shows.
   * null = "brak danych", never a guessed goal.
   */
  targetCalories: number | null;
}

/**
 * Weight, TDEE and the calorie goal for the day being scored.
 *
 * `getCurrentBodyMetrics` never fails: with an empty profile it silently falls back
 * to 80 kg / 178 cm / 38 years. For the calorie target that fallback would be a lie
 * ("gdy nie da się policzyć TDEE... składowa pokazuje brak danych i nie psuje wyniku
 * filaru"), so `usedDefaults` is turned into an explicit null here.
 *
 * `now: date` on purpose: scoring an older day must use the weight that was true
 * then, not today's.
 */
async function readBody(userId: string, date: Date, profileData: unknown): Promise<BodyReading> {
  try {
    const metrics = await getCurrentBodyMetrics(userId, { profileData, now: date });
    if (metrics.usedDefaults) return { weightKg: null, tdee: null, targetCalories: null };
    return {
      weightKg: metrics.weightKg,
      tdee: metrics.tdee,
      // "awaryjny" is a flat constant, not a goal computed from this body. Scoring the
      // day against it would be exactly the "cel z sufitu" the spec forbids.
      targetCalories: metrics.targetSource === "awaryjny" ? null : metrics.targetCalories,
    };
  } catch (err) {
    console.warn("[energy/sources] nie udalo sie policzyc metryk ciala:", err);
    return { weightKg: null, tdee: null, targetCalories: null };
  }
}

/* ------------------------------------------------------------------ */
/*  Public entry point                                                 */
/* ------------------------------------------------------------------ */

export interface DaySourceReading {
  /** One value per source, `null` where the app has nothing to say about the day. */
  values: Record<EnergySource, number | null>;
  /** True when at least one movement activity is completed (raises the water target). */
  trainedToday: boolean;
  body: BodyReading;
}

export async function readDaySources(userId: string, date: Date): Promise<DaySourceReading> {
  const raw = await loadRawDay(userId, date);
  // Sequential on purpose: the profile is already in hand, so this saves a query
  // instead of making `getCurrentBodyMetrics` read it again.
  const body = await readBody(userId, date, raw.profileData);

  return {
    values: {
      calories: readCalories(raw),
      protein: readProtein(raw),
      "activity-minutes": readActivityMinutes(raw),
      "study-minutes": readStudyMinutes(raw),
      "meditation-minutes": readMeditationMinutes(raw),
      "sleep-hours": readSleepHours(raw),
      "habits-done": readHabitsDone(raw),
    },
    trainedToday: Boolean(raw.log?.activities.some((a) => a.completed && isMovement(a))),
    body,
  };
}
