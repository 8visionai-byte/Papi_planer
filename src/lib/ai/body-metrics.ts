/**
 * Single source of truth for "how much does the user weigh right now"
 * and everything derived from it (BMR / TDEE / calorie target).
 *
 * Before this module every caller read the FROZEN `UserProfile.data.weightKg`,
 * so daily `WeightEntry` rows changed nothing but their own chart
 * (dashboard/route.ts:144, meals/route.ts:20, activities/toggle/route.ts:75).
 *
 * Rules:
 *  - BMR/TDEE use the 7-day average weight (less noisy than a single morning
 *    measurement — water weight swings ±1.5 kg and would move BMR by ~15 kcal).
 *  - The UI shows `latestWeightKg` (what the user actually typed last).
 *  - Fallback chain: 7-day avg -> newest entry (<=14 days) -> profile -> 80 kg.
 */

import { prisma } from "@/lib/db/prisma";
import {
  calculateBMR,
  calculateTDEE,
  calculateTargetCalories,
  getActivityFactor,
  getBmrSoFarToday,
  getDefaults,
} from "@/lib/ai/bmr-calculator";

/** How far back a single measurement is still considered "current". */
const LATEST_WEIGHT_MAX_AGE_DAYS = 14;
/** Window for the averaged weight used in BMR. */
const AVG_WINDOW_DAYS = 7;
/** Never recommend fewer calories than this, whatever the profile says. */
const MIN_SAFE_KCAL = 1200;
/** Same legacy default as `meals/route.ts` when the profile has no goal. */
const FALLBACK_TARGET_KCAL = 2500;

export type WeightSource = "avg7d" | "latest" | "profile" | "default";

export interface BodyMetrics {
  /** Newest WeightEntry within 14 days. Show THIS to the user. */
  latestWeightKg: number | null;
  /** Date (YYYY-MM-DD) of `latestWeightKg`. */
  latestWeightDate: string | null;
  /** Mean of WeightEntry rows from the last 7 days. */
  avg7dWeightKg: number | null;
  /** Weight actually fed into the BMR formula. */
  weightKg: number;
  /** Which fallback step produced `weightKg`. */
  weightSource: WeightSource;
  /** Frozen value from UserProfile.data (kept for diagnostics). */
  profileWeightKg: number | null;

  heightCm: number | null;
  age: number | null;
  gender: string | null;
  activityLevel: string | null;
  activityFactor: number;
  goal: string | null;
  weeklyTargetKg: number | null;

  bmr: number;
  tdee: number;
  targetCalories: number;
  /** Share of daily BMR already burned by now. */
  bmrSoFarToday: number;
  /** True when the profile has no biometrics at all (BMR is a pure guess). */
  usedDefaults: boolean;
}

export interface BodyMetricsOptions {
  /**
   * Pre-loaded `UserProfile.data` — pass it when the caller already read the
   * profile, to skip a second round-trip.
   */
  profileData?: unknown;
  /** Reference "now", for tests and for historical recalculation. */
  now?: Date;
}

interface ProfileFields {
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
  gender: string | null;
  activityLevel: string | null;
  goal: string | null;
  weeklyTargetKg: number | null;
  targetCalories: number | null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function readProfileFields(profileData: unknown): ProfileFields {
  if (!profileData || typeof profileData !== "object") {
    return {
      weightKg: null,
      heightCm: null,
      age: null,
      gender: null,
      activityLevel: null,
      goal: null,
      weeklyTargetKg: null,
      targetCalories: null,
    };
  }
  const d = profileData as Record<string, unknown>;
  return {
    weightKg: numOrNull(d.weightKg),
    heightCm: numOrNull(d.heightCm),
    age: numOrNull(d.age),
    gender: strOrNull(d.gender),
    activityLevel: strOrNull(d.activityLevel),
    goal: strOrNull(d.goal),
    weeklyTargetKg: numOrNull(d.weeklyTargetKg),
    targetCalories: numOrNull(d.targetCalories),
  };
}

/** UTC midnight of a date — WeightEntry.date is a `@db.Date` column. */
function toDateOnlyUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Full picture of the user's body + energy numbers, built from LIVE data.
 * One DB query when `profileData` is supplied, two otherwise.
 */
export async function getCurrentBodyMetrics(
  userId: string,
  options: BodyMetricsOptions = {}
): Promise<BodyMetrics> {
  const now = options.now ?? new Date();
  const since = toDateOnlyUTC(now);
  since.setUTCDate(since.getUTCDate() - (LATEST_WEIGHT_MAX_AGE_DAYS - 1));

  const [profileData, entries] = await Promise.all([
    options.profileData !== undefined
      ? Promise.resolve(options.profileData)
      : prisma.userProfile
          .findUnique({ where: { userId }, select: { data: true } })
          .then((p) => p?.data ?? null),
    prisma.weightEntry.findMany({
      where: { userId, date: { gte: since } },
      orderBy: { date: "desc" },
      select: { date: true, weightKg: true },
    }),
  ]);

  const fields = readProfileFields(profileData);

  // --- weight resolution -------------------------------------------------
  const latest = entries[0] ?? null;
  const latestWeightKg = latest ? latest.weightKg : null;
  const latestWeightDate = latest ? latest.date.toISOString().slice(0, 10) : null;

  const avgCutoff = toDateOnlyUTC(now);
  avgCutoff.setUTCDate(avgCutoff.getUTCDate() - (AVG_WINDOW_DAYS - 1));
  const inWindow = entries.filter((e) => e.date.getTime() >= avgCutoff.getTime());
  const avg7dWeightKg = inWindow.length
    ? round1(inWindow.reduce((s, e) => s + e.weightKg, 0) / inWindow.length)
    : null;

  let weightKg: number;
  let weightSource: WeightSource;
  if (avg7dWeightKg !== null) {
    weightKg = avg7dWeightKg;
    weightSource = "avg7d";
  } else if (latestWeightKg !== null) {
    weightKg = latestWeightKg;
    weightSource = "latest";
  } else if (fields.weightKg !== null) {
    weightKg = fields.weightKg;
    weightSource = "profile";
  } else {
    weightKg = getDefaults().weightKg;
    weightSource = "default";
  }

  // --- energy numbers ----------------------------------------------------
  const bmr = calculateBMR({
    weightKg,
    heightCm: fields.heightCm,
    age: fields.age,
    gender: fields.gender,
  });
  const tdee = calculateTDEE(bmr, fields.activityLevel ?? undefined);

  let targetCalories: number;
  if (fields.targetCalories !== null) {
    targetCalories = Math.max(MIN_SAFE_KCAL, Math.round(fields.targetCalories));
  } else if (fields.goal) {
    targetCalories = Math.max(
      MIN_SAFE_KCAL,
      calculateTargetCalories(tdee, fields.goal, fields.weeklyTargetKg)
    );
  } else {
    targetCalories = FALLBACK_TARGET_KCAL;
  }

  return {
    latestWeightKg,
    latestWeightDate,
    avg7dWeightKg,
    weightKg,
    weightSource,
    profileWeightKg: fields.weightKg,
    heightCm: fields.heightCm,
    age: fields.age,
    gender: fields.gender,
    activityLevel: fields.activityLevel,
    activityFactor: getActivityFactor(fields.activityLevel),
    goal: fields.goal,
    weeklyTargetKg: fields.weeklyTargetKg,
    bmr,
    tdee,
    targetCalories,
    bmrSoFarToday: getBmrSoFarToday(bmr, now),
    usedDefaults:
      weightSource === "default" && fields.heightCm === null && fields.age === null,
  };
}

/**
 * Shorthand for callers that only need a number to multiply by METs.
 * Same fallback chain as `getCurrentBodyMetrics`.
 */
export async function getCurrentWeightKg(userId: string): Promise<number> {
  const metrics = await getCurrentBodyMetrics(userId);
  return metrics.weightKg;
}
