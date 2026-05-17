/**
 * BMR / TDEE calculator (Mifflin-St Jeor formula).
 *
 * BMR = basal metabolic rate (kcal/day burned at rest just to stay alive).
 * TDEE = total daily energy expenditure (BMR x activity factor).
 *
 * UserProfile.data is Json — fields may be missing or wrong types.
 * Always fall back to sensible defaults.
 */

export type Gender = "male" | "female" | "other";

export type ActivityLevel = "sedentary" | "light" | "moderate" | "high" | "very_high";

export type Goal = "cut" | "maintain" | "bulk";

export interface BmrInput {
  weightKg?: number | null;
  heightCm?: number | null;
  age?: number | null;
  gender?: string | null;
}

export interface BmrDefaults {
  weightKg: number;
  heightCm: number;
  age: number;
  gender: Gender;
}

export function getDefaults(): BmrDefaults {
  return { weightKg: 80, heightCm: 178, age: 38, gender: "male" };
}

function num(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function normalizeGender(v: unknown): Gender {
  if (typeof v !== "string") return "male";
  const g = v.trim().toLowerCase();
  if (g === "female" || g === "kobieta" || g === "k" || g === "f") return "female";
  if (g === "male" || g === "mezczyzna" || g === "mężczyzna" || g === "m") return "male";
  return "other";
}

/**
 * Mifflin-St Jeor BMR formula.
 *  - Men:    BMR = 10*weight + 6.25*height - 5*age + 5
 *  - Women:  BMR = 10*weight + 6.25*height - 5*age - 161
 *  - Other:  neutral midpoint (between the two constants: -78)
 */
export function calculateBMR(data: BmrInput): number {
  const defaults = getDefaults();
  const weight = num(data.weightKg, defaults.weightKg);
  const height = num(data.heightCm, defaults.heightCm);
  const age = num(data.age, defaults.age);
  const gender = normalizeGender(data.gender ?? defaults.gender);

  const base = 10 * weight + 6.25 * height - 5 * age;
  let bmr: number;
  if (gender === "male") bmr = base + 5;
  else if (gender === "female") bmr = base - 161;
  else bmr = base - 78; // neutral midpoint

  return Math.max(0, Math.round(bmr));
}

/**
 * Map activity level string → PAL (physical activity level multiplier).
 *   sedentary  → 1.2   (almost no exercise)
 *   light      → 1.375 (1-3x/week)
 *   moderate   → 1.55  (3-5x/week)  <- default for PapiCoach users
 *   high       → 1.725 (6-7x/week)
 *   very_high  → 1.9   (very intense daily training)
 * Unknown / missing → 1.55.
 */
export function getActivityFactor(level: string | null | undefined): number {
  if (typeof level !== "string") return 1.55;
  const k = level.trim().toLowerCase();
  switch (k) {
    case "sedentary":
      return 1.2;
    case "light":
      return 1.375;
    case "moderate":
      return 1.55;
    case "high":
      return 1.725;
    case "very_high":
    case "veryhigh":
    case "very high":
      return 1.9;
    default:
      return 1.55;
  }
}

/**
 * TDEE = BMR x activity factor.
 *
 * Accepts either:
 *  - an activity level string ("sedentary" | "light" | "moderate" | "high" | "very_high")
 *  - a raw factor number (back-compat)
 *  - nothing → defaults to moderate (1.55)
 */
export function calculateTDEE(bmr: number, activity?: string | number): number {
  let factor: number;
  if (typeof activity === "number") {
    factor = Number.isFinite(activity) && activity > 0 ? activity : 1.55;
  } else if (typeof activity === "string") {
    factor = getActivityFactor(activity);
  } else {
    factor = 1.55;
  }
  return Math.round(bmr * factor);
}

/**
 * Compute target daily calories from TDEE + goal.
 *  - maintain → tdee
 *  - cut      → tdee − (weeklyTargetKg ? weeklyTargetKg × 7700 / 7 : 500)
 *  - bulk     → tdee + (weeklyTargetKg ? weeklyTargetKg × 7700 / 7 : 300)
 *
 * 7700 kcal ≈ 1 kg body fat. Divide by 7 → daily deficit/surplus.
 */
export function calculateTargetCalories(
  tdee: number,
  goal: string | null | undefined,
  weeklyTargetKg?: number | null
): number {
  const g = typeof goal === "string" ? goal.trim().toLowerCase() : "maintain";
  const weekly =
    typeof weeklyTargetKg === "number" && Number.isFinite(weeklyTargetKg) && weeklyTargetKg > 0
      ? weeklyTargetKg
      : null;

  if (g === "cut") {
    const delta = weekly ? Math.round((weekly * 7700) / 7) : 500;
    return Math.max(0, Math.round(tdee - delta));
  }
  if (g === "bulk") {
    const delta = weekly ? Math.round((weekly * 7700) / 7) : 300;
    return Math.max(0, Math.round(tdee + delta));
  }
  // default maintain
  return Math.round(tdee);
}

/**
 * Fraction of daily BMR already "consumed" by the current time of day.
 * 12:00 -> ~50% of daily BMR burned, 18:00 -> ~75%, 23:59 -> ~100%.
 */
export function getBmrSoFarToday(bmr: number, now: Date = new Date()): number {
  const minutesIntoDay = now.getHours() * 60 + now.getMinutes();
  const fraction = Math.min(1, Math.max(0, minutesIntoDay / 1440));
  return Math.round(bmr * fraction);
}
