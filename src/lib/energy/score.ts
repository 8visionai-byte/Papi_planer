/**
 * Pure energy math — no database, no dates, no Prisma.
 *
 * Everything the daily energy percentage depends on lives in this file as plain
 * functions over numbers, so the whole rule can be checked by hand (and by a test)
 * without booting the app. The formulas come straight from docs/ENERGIA-SPEC.md.
 *
 * Rounding happens ONLY at the very end, in the caller that builds the API
 * response. Rounding a component before it is weighted would drift the day total
 * by a few points for no reason.
 */

import {
  CALORIES_COMPONENT_KEY,
  PROTEIN_COMPONENT_KEY,
  PROTEIN_G_PER_KG,
  WATER_COMPONENT_KEY,
  WATER_HEAT_BONUS_ML,
  WATER_MIN_ML,
  WATER_ML_PER_KG,
  WATER_ROUND_ML,
  WATER_TRAINING_BONUS_ML,
} from "./constants";

// Re-exported so the server side can keep importing everything from ./score.
export * from "./constants";

export type ComponentKind = "up" | "window" | "bool";

const COMPONENT_KINDS: ComponentKind[] = ["up", "window", "bool"];

/** The DB column is a plain String, so anything unexpected falls back to "up". */
export function normalizeKind(raw: unknown): ComponentKind {
  const s = typeof raw === "string" ? raw.toLowerCase() : "";
  return (COMPONENT_KINDS as string[]).includes(s) ? (s as ComponentKind) : "up";
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * One component -> a fraction between 0 and 1.
 *
 * `value === null` means "we do not know" (nothing logged, no source data). It
 * scores 0, because an unknown day cannot be rewarded, but the caller keeps the
 * null in the response so the UI can still show "brak danych" instead of "0".
 */
export function scoreComponent(
  kind: ComponentKind,
  value: number | null,
  target: number | null,
  tolerance: number | null
): number {
  if (value === null || !Number.isFinite(value)) return 0;

  switch (kind) {
    case "bool":
      // Booleans travel through the JSON blob as 0 / 1, the target is irrelevant.
      return value >= 1 ? 1 : 0;

    case "window": {
      // An uncomputable target (no weight, no profile) cannot be hit.
      if (target === null || !Number.isFinite(target)) return 0;
      // No tolerance means there is no slope to slide down: only an exact hit counts.
      if (tolerance === null || !Number.isFinite(tolerance) || tolerance <= 0) {
        return value === target ? 1 : 0;
      }
      return clamp01(1 - Math.abs(value - target) / tolerance);
    }

    case "up":
    default:
      // A target of zero (or nonsense) cannot be "reached", so it scores nothing
      // instead of dividing by zero and producing Infinity.
      if (target === null || !Number.isFinite(target) || target <= 0) return 0;
      return clamp01(value / target);
  }
}

export interface ScorableComponent {
  kind: ComponentKind;
  value: number | null;
  target: number | null;
  tolerance: number | null;
  /** Share of the pillar in percent. Components of one pillar should sum to 100. */
  weight: number;
  active?: boolean;
}

/**
 * Weighted mean of the ACTIVE components -> fraction 0..1.
 *
 * The divisor is the sum of the weights that actually took part, not a hard 100.
 * That way switching a component off reweights the pillar honestly instead of
 * silently capping it below 100%.
 */
export function scorePillar(components: ScorableComponent[]): number {
  let weighted = 0;
  let totalWeight = 0;

  for (const c of components) {
    if (c.active === false) continue;
    const weight = Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 0;
    if (weight === 0) continue;
    totalWeight += weight;
    weighted += scoreComponent(c.kind, c.value, c.target, c.tolerance) * weight;
  }

  if (totalWeight === 0) return 0;
  return weighted / totalWeight;
}

export interface ScorablePillar {
  /** Fill of the pillar as a fraction 0..1 (the raw output of `scorePillar`). */
  percent: number;
  /** Share of the whole day in percent. Active pillars should sum to 100. */
  weight: number;
  active?: boolean;
}

/** Whole day -> 0..100, unrounded. The caller rounds once, on the way out. */
export function scoreDay(pillars: ScorablePillar[]): number {
  let weighted = 0;
  let totalWeight = 0;

  for (const p of pillars) {
    if (p.active === false) continue;
    const weight = Number.isFinite(p.weight) && p.weight > 0 ? p.weight : 0;
    if (weight === 0) continue;
    totalWeight += weight;
    weighted += clamp01(p.percent) * weight;
  }

  if (totalWeight === 0) return 0;
  return (weighted / totalWeight) * 100;
}

/** Fraction 0..1 -> integer percent. The single rounding point of the module. */
export function toPercent(fraction: number): number {
  return Math.round(clamp01(fraction) * 100);
}

/* ------------------------------------------------------------------ */
/*  Targets that are not constant                                      */
/* ------------------------------------------------------------------ */

export interface TargetContext {
  /** True when the day has at least one COMPLETED movement activity. */
  trainedToday: boolean;
  /** True when the user ticked "dziś gorąco" for that day. */
  hotDay: boolean;
  /** Live body weight in kg (7-day average). null = the app cannot know it. */
  weightKg: number | null;
  /** TDEE computed from the live weight. null = not enough profile to compute it. */
  tdee: number | null;
  /**
   * The day's calorie goal, already resolved by `lib/ai/body-metrics.ts` — the same
   * number /dieta, /pulpit and the mentors quote. null = "brak danych".
   */
  targetCalories: number | null;
}

/**
 * Two components never use the number stored in the row as-is. Each of them stores
 * a RULE (a gram-per-kilo, a millilitre-per-kilo) and the real target is computed
 * from today's body:
 *
 *  - `bialko-g`  -> stored g/kg times the live weight,
 *  - `woda-ml`   -> stored ml/kg times the live weight, floored, plus training and heat.
 *
 * `kcal` is different: its goal is NOT computed here at all. It comes in through
 * `ctx.targetCalories` from `lib/ai/body-metrics.ts`, so the energy screen and the
 * diet screen can never show two different calorie goals. The `target` stored on the
 * `kcal` row is only a MIRROR of the profile deficit for the settings form.
 *
 * `null` means "today this target cannot be computed" (no weight, no profile). The
 * caller then shows "brak danych" and leaves the component OUT of the pillar average,
 * because an unknowable target must not push the pillar down (spec, section 2).
 */
export function effectiveTarget(
  componentKey: string,
  storedTarget: number,
  ctx: TargetContext
): number | null {
  switch (componentKey) {
    case CALORIES_COMPONENT_KEY: {
      const goal = ctx.targetCalories;
      if (goal === null || !Number.isFinite(goal) || goal <= 0) return null;
      return Math.round(goal);
    }

    case PROTEIN_COMPONENT_KEY: {
      if (ctx.weightKg === null || !Number.isFinite(ctx.weightKg) || ctx.weightKg <= 0) {
        return null;
      }
      const perKg =
        Number.isFinite(storedTarget) && storedTarget > 0 ? storedTarget : PROTEIN_G_PER_KG;
      return Math.round(perKg * ctx.weightKg);
    }

    case WATER_COMPONENT_KEY: {
      const perKg =
        Number.isFinite(storedTarget) && storedTarget > 0 ? storedTarget : WATER_ML_PER_KG;
      // Unknown weight still gets a usable goal: the spec's own floor of 2 litres.
      const base =
        ctx.weightKg !== null && Number.isFinite(ctx.weightKg) && ctx.weightKg > 0
          ? Math.max(
              WATER_MIN_ML,
              Math.round((perKg * ctx.weightKg) / WATER_ROUND_ML) * WATER_ROUND_ML
            )
          : WATER_MIN_ML;
      return (
        base +
        (ctx.trainedToday ? WATER_TRAINING_BONUS_ML : 0) +
        (ctx.hotDay ? WATER_HEAT_BONUS_ML : 0)
      );
    }

    default:
      return Number.isFinite(storedTarget) ? storedTarget : null;
  }
}
