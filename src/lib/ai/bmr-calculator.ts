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
 * TDEE = BMR x activity factor.
 *   1.2   - sedentary (almost no exercise)
 *   1.375 - light (1-3x/week)
 *   1.55  - moderate (3-5x/week)  <- default for PapiCoach users
 *   1.725 - high (6-7x/week)
 */
export function calculateTDEE(bmr: number, activityFactor: number = 1.55): number {
  const factor = Number.isFinite(activityFactor) && activityFactor > 0 ? activityFactor : 1.55;
  return Math.round(bmr * factor);
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
