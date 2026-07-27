/**
 * Public API of the energy module.
 *
 * The route handlers under src/app/api/energy/* should not touch Prisma or the math
 * directly: everything they need is here, already shaped like the API contract in
 * docs/ENERGIA-SPEC.md section 4.
 *
 * Dates: every day is a Polish calendar day. The container runs on UTC, so
 * `new Date()` is NOT the user's day; `polishDateKey` goes through `polishDayBounds`
 * and hands back a "YYYY-MM-DD" string, and `dateKeyToDate` turns it into the UTC
 * midnight that `@db.Date` columns store.
 */

import { prisma } from "@/lib/db/prisma";
import { polishDayBounds } from "@/lib/google/calendar";
import type { Prisma } from "@/generated/prisma/client";

import { ENERGY_DEFAULTS, ensureEnergySetup } from "./defaults";
import { isEnergySource, readDaySources, type DaySourceReading } from "./sources";
import {
  CALORIES_COMPONENT_KEY,
  CALORIE_DEFICIT_MAX,
  CALORIE_DEFICIT_MIN,
  HOT_DAY_COMPONENT_KEY,
  PROTEIN_COMPONENT_KEY,
  WATER_COMPONENT_KEY,
} from "./constants";
import {
  effectiveTarget,
  normalizeKind,
  scoreComponent,
  scoreDay,
  scorePillar,
  toPercent,
  type ComponentKind,
  type TargetContext,
} from "./score";

export { ENERGY_DEFAULTS, ensureEnergySetup } from "./defaults";
export { ENERGY_SOURCES, type EnergySource } from "./sources";
export * from "./constants";
export { scoreComponent, scorePillar, scoreDay, effectiveTarget, type ComponentKind } from "./score";
// Small steps that raise a weak pillar, plus the multi-day weakness streak they are
// announced with. `./boosters` imports nothing from this file, so this is not a cycle.
export * from "./boosters";

/* ------------------------------------------------------------------ */
/*  Dates                                                              */
/* ------------------------------------------------------------------ */

const POLISH_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today in Warsaw as "YYYY-MM-DD", even though the server clock is UTC. */
export function polishDateKey(now: Date = new Date()): string {
  const { from } = polishDayBounds(now);
  // `from` is Polish midnight expressed as a UTC instant; formatting it back in
  // Warsaw returns the calendar date the user is actually living in.
  return POLISH_DATE_FMT.format(from);
}

/** Validates "YYYY-MM-DD" and rejects impossible days like 2026-02-31. */
export function parseDateKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === s ? s : null;
}

/** "YYYY-MM-DD" -> UTC midnight, which is what a `@db.Date` column holds. */
export function dateKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function dateToDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/*  Missing tables                                                     */
/* ------------------------------------------------------------------ */

/**
 * The three energy tables land in production only after the container restarts and
 * `prisma db push` runs. Until then every read must degrade into "no data" instead
 * of a 500, otherwise the whole screen dies on a schema that is minutes away.
 */
function isMissingRelation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "P2021" || e.code === "P2022") return true;
  if (e.code === "42P01" || e.code === "42703") return true;
  const msg = typeof e.message === "string" ? e.message : "";
  return /relation .* does not exist|column .* does not exist|table .* does not exist/i.test(msg);
}

/* ------------------------------------------------------------------ */
/*  Internal records                                                   */
/* ------------------------------------------------------------------ */

export interface ComponentRecord {
  /** null only in degraded mode, where the shape comes from the defaults in code. */
  id: string | null;
  key: string;
  label: string;
  kind: ComponentKind;
  source: string | null;
  target: number;
  tolerance: number | null;
  unit: string | null;
  weight: number;
  hint: string | null;
  sortOrder: number;
  active: boolean;
}

export interface PillarRecord {
  id: string | null;
  key: string;
  name: string;
  emoji: string;
  weight: number;
  lifeAreaId: string | null;
  sortOrder: number;
  active: boolean;
  components: ComponentRecord[];
}

function defaultsAsRecords(): PillarRecord[] {
  return ENERGY_DEFAULTS.map((p, pi) => ({
    id: null,
    key: p.key,
    name: p.name,
    emoji: p.emoji,
    weight: p.weight,
    lifeAreaId: null,
    sortOrder: pi,
    active: true,
    components: p.components.map((c, ci) => ({
      id: null,
      key: c.key,
      label: c.label,
      kind: c.kind,
      source: c.source,
      target: c.target,
      tolerance: c.tolerance,
      unit: c.unit,
      weight: c.weight,
      hint: c.hint,
      sortOrder: ci,
      active: true,
    })),
  }));
}

interface LoadedPillars {
  pillars: PillarRecord[];
  /** True when the shape comes from code, not from the database. */
  degraded: boolean;
}

async function fetchPillars(userId: string): Promise<PillarRecord[]> {
  const rows = await prisma.energyPillar.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
    include: { components: { orderBy: [{ sortOrder: "asc" }, { key: "asc" }] } },
  });

  return rows.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    emoji: p.emoji,
    weight: p.weight,
    lifeAreaId: p.lifeAreaId,
    sortOrder: p.sortOrder,
    active: p.active,
    components: p.components.map((c) => ({
      id: c.id,
      key: c.key,
      label: c.label,
      kind: normalizeKind(c.kind),
      source: c.source,
      target: c.target,
      tolerance: c.tolerance,
      unit: c.unit,
      weight: c.weight,
      hint: c.hint,
      sortOrder: c.sortOrder,
      active: c.active,
    })),
  }));
}

/**
 * Pillars for a user, seeding them on first use when `init` is left on (that is the
 * lazy initialisation the spec asks GET /api/energy for).
 */
async function loadPillars(userId: string, opts: { init?: boolean } = {}): Promise<LoadedPillars> {
  const init = opts.init !== false;
  try {
    let pillars = await fetchPillars(userId);
    if (pillars.length === 0 && init) {
      await ensureEnergySetup(userId);
      pillars = await fetchPillars(userId);
    }
    if (pillars.length === 0) return { pillars: defaultsAsRecords(), degraded: true };
    return { pillars, degraded: false };
  } catch (err) {
    if (isMissingRelation(err)) {
      console.warn("[energy] tabele energii jeszcze nie istnieja, dzialam na domyslnych");
      return { pillars: defaultsAsRecords(), degraded: true };
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/*  Day view                                                           */
/* ------------------------------------------------------------------ */

export interface EnergyComponentView {
  key: string;
  label: string;
  kind: ComponentKind;
  source: string | null;
  /**
   * Already resolved for today: the calorie goal is TDEE minus the stored deficit,
   * protein is g/kg times the live weight, water is ml/kg plus training and heat.
   * `null` = today it cannot be computed, and the component is then left out of the
   * pillar average instead of scoring it a zero.
   */
  target: number | null;
  tolerance: number | null;
  unit: string | null;
  weight: number;
  hint: string | null;
  /** null = nothing known for this day. The UI shows "brak danych", not "0". */
  value: number | null;
  percent: number;
  auto: boolean;
}

export interface EnergyPillarView {
  key: string;
  name: string;
  emoji: string;
  weight: number;
  percent: number;
  components: EnergyComponentView[];
}

export interface EnergyDayView {
  date: string;
  total: number;
  feltEnergy: number | null;
  note: string | null;
  pillars: EnergyPillarView[];
}

export interface EnergyScore {
  total: number;
  pillars: Record<string, number>;
}

function readStoredValues(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : NaN;
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function parseStoredScore(raw: unknown): EnergyScore | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const total = typeof obj.total === "number" ? obj.total : null;
  if (total === null) return null;
  const pillars: Record<string, number> = {};
  if (obj.pillars && typeof obj.pillars === "object" && !Array.isArray(obj.pillars)) {
    for (const [k, v] of Object.entries(obj.pillars as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) pillars[k] = v;
    }
  }
  return { total, pillars };
}

/**
 * The one place where pillars, stored manual values and live auto readings turn into
 * the response. Pure apart from its inputs, so both GET and PATCH share it and can
 * never drift apart.
 */
function composeDay(
  dateKey: string,
  pillars: PillarRecord[],
  values: Record<string, number>,
  reading: DaySourceReading,
  feltEnergy: number | null,
  note: string | null
): { view: EnergyDayView; score: EnergyScore } {
  const ctx: TargetContext = {
    trainedToday: reading.trainedToday,
    // "dziś gorąco" is a manual toggle stored like any other bool value.
    hotDay: (values[HOT_DAY_COMPONENT_KEY] ?? 0) > 0,
    weightKg: reading.body.weightKg,
    tdee: reading.body.tdee,
    // Single source of truth for the calorie goal — see lib/ai/body-metrics.ts.
    targetCalories: reading.body.targetCalories,
  };

  const pillarViews: EnergyPillarView[] = [];
  const scorable: Array<{ percent: number; weight: number }> = [];
  const scorePillars: Record<string, number> = {};

  for (const p of pillars) {
    if (!p.active) continue;

    const componentViews: EnergyComponentView[] = [];
    const scorableComponents = [];

    for (const c of p.components) {
      if (!c.active) continue;

      const target = effectiveTarget(c.key, c.target, ctx);
      const auto = Boolean(c.source);
      const value = auto
        ? isEnergySource(c.source)
          ? reading.values[c.source]
          : null
        : (values[c.key] ?? null);

      const fraction = scoreComponent(c.kind, value, target, c.tolerance);

      componentViews.push({
        key: c.key,
        label: c.label,
        kind: c.kind,
        source: c.source,
        target,
        tolerance: c.tolerance,
        unit: c.unit,
        weight: c.weight,
        hint: c.hint,
        value,
        percent: toPercent(fraction),
        auto,
      });

      // A target that cannot be computed today (no weight, no profile) stays OUT of
      // the average entirely. Scoring it zero would punish the user for a gap in his
      // profile, which the spec forbids: "nie psuje wyniku filaru".
      if (target === null && c.kind !== "bool") continue;

      scorableComponents.push({
        kind: c.kind,
        value,
        target,
        tolerance: c.tolerance,
        weight: c.weight,
      });
    }

    // Unrounded on purpose: the day total is built from the exact fractions and
    // rounded once, at the end.
    const pillarFraction = scorePillar(scorableComponents);
    const pillarPercent = toPercent(pillarFraction);

    pillarViews.push({
      key: p.key,
      name: p.name,
      emoji: p.emoji,
      weight: p.weight,
      percent: pillarPercent,
      components: componentViews,
    });
    scorable.push({ percent: pillarFraction, weight: p.weight });
    scorePillars[p.key] = pillarPercent;
  }

  const total = Math.round(scoreDay(scorable));

  return {
    view: { date: dateKey, total, feltEnergy, note, pillars: pillarViews },
    score: { total, pillars: scorePillars },
  };
}

/**
 * Whole score comparison, not just the total. Two different days can add up to the
 * same number while their pillars moved (more water, less sleep), and the trend chart
 * reads the cached PILLARS, so refreshing only on a changed total would leave the
 * pillar averages stale.
 */
function sameScore(a: EnergyScore, b: EnergyScore): boolean {
  if (a.total !== b.total) return false;
  const keys = new Set([...Object.keys(a.pillars), ...Object.keys(b.pillars)]);
  for (const k of keys) {
    if (a.pillars[k] !== b.pillars[k]) return false;
  }
  return true;
}

async function loadEntry(userId: string, date: Date) {
  try {
    return await prisma.energyEntry.findUnique({ where: { userId_date: { userId, date } } });
  } catch (err) {
    if (isMissingRelation(err)) return null;
    throw err;
  }
}

/**
 * The day as the "Dziś" tab needs it. Seeds the seven pillars on first use.
 *
 * Side effect on purpose: when an entry already exists and its cached `score` no
 * longer matches (a meal was added in /diet after the last save), the cache is
 * refreshed. It never CREATES a row, so simply looking at a day does not fabricate
 * history in the trend.
 */
export async function buildEnergyDay(
  userId: string,
  dateKey: string,
  opts: { init?: boolean } = {}
): Promise<EnergyDayView> {
  return (await buildDay(userId, dateKey, opts)).view;
}

/**
 * Same as `buildEnergyDay`, plus the flag saying whether the shape came from the
 * database or from the defaults in code. The AI context needs that flag: a day built
 * from defaults for a user who has never opened /energy is not a fact about him.
 */
async function buildDay(
  userId: string,
  dateKey: string,
  opts: { init?: boolean } = {}
): Promise<{ view: EnergyDayView; degraded: boolean }> {
  const date = dateKeyToDate(dateKey);

  const [loaded, entry, reading] = await Promise.all([
    loadPillars(userId, opts),
    loadEntry(userId, date),
    readDaySources(userId, date),
  ]);

  const { view, score } = composeDay(
    dateKey,
    loaded.pillars,
    readStoredValues(entry?.values),
    reading,
    entry?.feltEnergy ?? null,
    entry?.note ?? null
  );

  if (entry) {
    const stored = parseStoredScore(entry.score);
    if (!stored || !sameScore(stored, score)) {
      try {
        await prisma.energyEntry.update({
          where: { id: entry.id },
          data: { score: score as unknown as Prisma.InputJsonValue },
        });
      } catch (err) {
        // A stale cache is not worth failing the request over.
        if (!isMissingRelation(err)) console.warn("[energy] nie udalo sie odswiezyc score:", err);
      }
    }
  }

  return { view, degraded: loaded.degraded };
}

/* ------------------------------------------------------------------ */
/*  Patch                                                              */
/* ------------------------------------------------------------------ */

const MAX_NOTE = 1000;

export interface EnergyPatch {
  values?: unknown;
  feltEnergy?: unknown;
  note?: unknown;
}

function coerceValue(kind: ComponentKind, raw: unknown): number | null {
  if (raw === null) return null;
  if (typeof raw === "boolean") return raw ? 1 : 0;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  if (kind === "bool") return n >= 1 ? 1 : 0;
  // Negative minutes / millilitres are always a client bug, not a measurement.
  return n < 0 ? 0 : n;
}

/**
 * Merge (never replace) the manual values of one day, recompute and store.
 *
 * Keys that do not exist, and keys of `auto` components, are dropped: an auto value
 * is read from the rest of the app, so storing it here would create a second truth.
 */
export async function patchEnergyDay(
  userId: string,
  dateKey: string,
  patch: EnergyPatch
): Promise<EnergyDayView> {
  const date = dateKeyToDate(dateKey);

  const [loaded, entry, reading] = await Promise.all([
    loadPillars(userId),
    loadEntry(userId, date),
    readDaySources(userId, date),
  ]);

  const manual = new Map<string, ComponentRecord>();
  for (const p of loaded.pillars) {
    for (const c of p.components) {
      if (!c.source) manual.set(c.key, c);
    }
  }

  const merged = readStoredValues(entry?.values);
  if (patch.values && typeof patch.values === "object" && !Array.isArray(patch.values)) {
    for (const [key, raw] of Object.entries(patch.values as Record<string, unknown>)) {
      const component = manual.get(key);
      if (!component) continue; // unknown or auto -> rejected
      const value = coerceValue(component.kind, raw);
      if (value === null) {
        delete merged[key]; // explicit null clears the field back to "brak danych"
      } else {
        merged[key] = value;
      }
    }
  }

  let feltEnergy: number | null = entry?.feltEnergy ?? null;
  if (patch.feltEnergy !== undefined) {
    if (patch.feltEnergy === null) {
      feltEnergy = null;
    } else {
      const n = Number(patch.feltEnergy);
      feltEnergy = Number.isFinite(n) ? Math.max(1, Math.min(10, Math.round(n))) : feltEnergy;
    }
  }

  let note: string | null = entry?.note ?? null;
  if (patch.note !== undefined) {
    if (patch.note === null) {
      note = null;
    } else {
      const s = String(patch.note).trim();
      note = s ? s.slice(0, MAX_NOTE) : null;
    }
  }

  const { view, score } = composeDay(dateKey, loaded.pillars, merged, reading, feltEnergy, note);

  try {
    await prisma.energyEntry.upsert({
      where: { userId_date: { userId, date } },
      create: {
        userId,
        date,
        values: merged as unknown as Prisma.InputJsonValue,
        score: score as unknown as Prisma.InputJsonValue,
        feltEnergy,
        note,
      },
      update: {
        values: merged as unknown as Prisma.InputJsonValue,
        score: score as unknown as Prisma.InputJsonValue,
        feltEnergy,
        note,
      },
    });
  } catch (err) {
    if (!isMissingRelation(err)) throw err;
    // No table yet: the user still gets the recomputed day back, it just is not saved.
    console.warn("[energy] brak tabeli energy_entries, zapis pominiety");
  }

  return view;
}

/* ------------------------------------------------------------------ */
/*  Trend                                                              */
/* ------------------------------------------------------------------ */

export interface EnergyTrendDay {
  date: string;
  total: number;
  feltEnergy: number | null;
  pillars: Record<string, number>;
}

export interface EnergyInsight {
  text: string;
  /** "dependency" = a pillar that splits good days from bad ones. */
  kind: "dependency";
}

export interface EnergyTrendView {
  days: EnergyTrendDay[];
  averages: { total: number; pillars: Record<string, number> };
  weakest: { key: string; name: string; percent: number } | null;
  insights: EnergyInsight[];
  /**
   * Not in the spec's shape, but the spec asks for "komunikat, że dane jeszcze
   * rosną" when there is not enough rated history. Null once insights can be built.
   */
  note: string | null;
}

/** Spec: a pillar splits good from bad days only above 20 percentage points. */
const INSIGHT_THRESHOLD = 20;
/** Spec: at least 5 days with a felt rating before any dependency is claimed. */
const INSIGHT_MIN_RATED_DAYS = 5;

const LOW_FELT = 5;
const HIGH_FELT = 8;

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * The dependency rule from the spec, as a pure function so it can be checked with a
 * handful of made-up days instead of a database.
 *
 * For every pillar: average fill on days the user felt bad (felt <= 5) against days
 * he felt good (felt >= 8). A gap wider than 20 percentage points becomes a sentence.
 * Below 5 rated days nothing is claimed at all, because three coincidences are not a
 * pattern and this screen is supposed to be trustworthy.
 */
export function computeTrendInsights(
  days: EnergyTrendDay[],
  pillars: Array<{ key: string; name: string }>
): { insights: EnergyInsight[]; note: string | null } {
  const rated = days.filter((d) => typeof d.feltEnergy === "number");

  if (rated.length < INSIGHT_MIN_RATED_DAYS) {
    return {
      insights: [],
      note: `Zbieram dane. Oceń swoje samopoczucie w co najmniej ${INSIGHT_MIN_RATED_DAYS} dniach, a pokażę zależności. Masz ${rated.length}.`,
    };
  }

  const low = rated.filter((d) => (d.feltEnergy ?? 0) <= LOW_FELT);
  const high = rated.filter((d) => (d.feltEnergy ?? 0) >= HIGH_FELT);

  if (low.length === 0 || high.length === 0) {
    return {
      insights: [],
      note: "Potrzebuję i słabych, i dobrych dni, żeby je porównać. Na razie wszystkie oceny są podobne.",
    };
  }

  const found: Array<{ diff: number; insight: EnergyInsight }> = [];
  for (const p of pillars) {
    const lowVals = low.map((d) => d.pillars[p.key]).filter((v): v is number => typeof v === "number");
    const highVals = high
      .map((d) => d.pillars[p.key])
      .filter((v): v is number => typeof v === "number");
    if (lowVals.length === 0 || highVals.length === 0) continue;

    const lowAvg = Math.round(average(lowVals));
    const highAvg = Math.round(average(highVals));
    const diff = Math.abs(highAvg - lowAvg);
    if (diff <= INSIGHT_THRESHOLD) continue;

    found.push({
      diff,
      insight: {
        // Wording kept grammar-safe for all seven names (no declension traps).
        text: `${p.name}: w dni, gdy czułeś się słabo, średnio ${lowAvg}%. W dobre dni ${highAvg}%. Różnica ${diff} punktów.`,
        kind: "dependency",
      },
    });
  }

  found.sort((a, b) => b.diff - a.diff);
  const insights = found.map((f) => f.insight);

  return {
    insights,
    note:
      insights.length === 0
        ? "Żaden filar nie różnicuje jeszcze dobrych i słabych dni na tyle, żeby coś twierdzić."
        : null,
  };
}

export async function buildEnergyTrend(userId: string, days: number): Promise<EnergyTrendView> {
  const span = Math.max(1, Math.min(365, Math.round(days)));
  const todayKey = polishDateKey();
  const to = dateKeyToDate(todayKey);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (span - 1));

  let entries: Array<{ date: Date; score: unknown; feltEnergy: number | null }> = [];
  let pillars: PillarRecord[] = [];

  try {
    const [rows, loaded] = await Promise.all([
      prisma.energyEntry.findMany({
        where: { userId, date: { gte: from, lte: to } },
        orderBy: { date: "asc" },
        select: { date: true, score: true, feltEnergy: true },
      }),
      // No lazy init here: a trend screen must never write anything.
      loadPillars(userId, { init: false }),
    ]);
    entries = rows;
    pillars = loaded.pillars;
  } catch (err) {
    if (!isMissingRelation(err)) throw err;
    return {
      days: [],
      averages: { total: 0, pillars: {} },
      weakest: null,
      insights: [],
      note: "Zbieram dane. Wypełnij kilka dni, a pokażę zależności.",
    };
  }

  const activePillars = pillars.filter((p) => p.active);
  const nameByKey = new Map(activePillars.map((p) => [p.key, p.name]));

  const trendDays: EnergyTrendDay[] = [];
  for (const e of entries) {
    const score = parseStoredScore(e.score);
    // An entry saved before scoring existed carries no cached score; showing it as
    // 0% would be a lie, so it simply does not enter the trend.
    if (!score) continue;
    trendDays.push({
      date: dateToDateKey(e.date),
      total: score.total,
      feltEnergy: e.feltEnergy,
      pillars: score.pillars,
    });
  }

  const averagesByPillar: Record<string, number> = {};
  for (const p of activePillars) {
    const vals = trendDays
      .map((d) => d.pillars[p.key])
      .filter((v): v is number => typeof v === "number");
    if (vals.length > 0) averagesByPillar[p.key] = Math.round(average(vals));
  }

  const averageTotal = Math.round(average(trendDays.map((d) => d.total)));

  let weakest: EnergyTrendView["weakest"] = null;
  for (const [key, percent] of Object.entries(averagesByPillar)) {
    if (!weakest || percent < weakest.percent) {
      weakest = { key, name: nameByKey.get(key) ?? key, percent };
    }
  }

  const { insights, note } = computeTrendInsights(trendDays, activePillars);

  return {
    days: trendDays,
    averages: { total: averageTotal, pillars: averagesByPillar },
    weakest,
    insights,
    note,
  };
}

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

export interface EnergyConfigComponent {
  id: string | null;
  key: string;
  label: string;
  kind: ComponentKind;
  source: string | null;
  target: number;
  tolerance: number | null;
  unit: string | null;
  weight: number;
  hint: string | null;
  sortOrder: number;
  active: boolean;
}

export interface EnergyConfigPillar {
  id: string | null;
  key: string;
  name: string;
  emoji: string;
  weight: number;
  lifeAreaId: string | null;
  sortOrder: number;
  active: boolean;
  components: EnergyConfigComponent[];
}

export interface EnergyConfigView {
  pillars: EnergyConfigPillar[];
  /** Live weight sums, so the settings screen can show its "must be 100" counter. */
  totals: { pillars: number; byPillar: Record<string, number> };
  /** True when the tables are not in the database yet and this is code defaults. */
  degraded: boolean;
}

function toConfigView(pillars: PillarRecord[], degraded: boolean): EnergyConfigView {
  const byPillar: Record<string, number> = {};
  let pillarsTotal = 0;
  for (const p of pillars) {
    if (p.active) pillarsTotal += p.weight;
    byPillar[p.key] = p.components.reduce((sum, c) => sum + (c.active ? c.weight : 0), 0);
  }
  return {
    pillars: pillars.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      emoji: p.emoji,
      weight: p.weight,
      lifeAreaId: p.lifeAreaId,
      sortOrder: p.sortOrder,
      active: p.active,
      components: p.components.map((c) => ({
        id: c.id,
        key: c.key,
        label: c.label,
        kind: c.kind,
        source: c.source,
        target: c.target,
        tolerance: c.tolerance,
        unit: c.unit,
        weight: c.weight,
        hint: c.hint,
        sortOrder: c.sortOrder,
        active: c.active,
      })),
    })),
    totals: { pillars: pillarsTotal, byPillar },
    degraded,
  };
}

export async function readEnergyConfig(
  userId: string,
  opts: { init?: boolean } = {}
): Promise<EnergyConfigView> {
  const loaded = await loadPillars(userId, opts);
  return toConfigView(loaded.pillars, loaded.degraded);
}

export interface EnergyConfigPatch {
  pillars?: unknown;
  components?: unknown;
}

export type EnergyConfigResult =
  | { ok: true; config: EnergyConfigView }
  | { ok: false; error: string };

function optionalInt(raw: unknown, min: number, max: number): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function optionalFloat(raw: unknown, min: number): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, n);
}

function optionalBool(raw: unknown): boolean | undefined {
  return typeof raw === "boolean" ? raw : undefined;
}

function optionalString(raw: unknown, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  return s ? s.slice(0, max) : undefined;
}

/**
 * Three components store a RULE, not a goal, so their editable range is not "any
 * positive number": a deficit of 5000 kcal or 300 ml of water per kilogram would be
 * dangerous nonsense. The spec fixes the calorie range explicitly (0-700); the other
 * two get sane physiological bounds around the values it names (2 g/kg, 30 ml/kg).
 */
function boundTarget(componentKey: string, value: number): number {
  switch (componentKey) {
    case CALORIES_COMPONENT_KEY:
      return Math.max(CALORIE_DEFICIT_MIN, Math.min(CALORIE_DEFICIT_MAX, Math.round(value)));
    case PROTEIN_COMPONENT_KEY:
      return Math.max(0.5, Math.min(4, value));
    case WATER_COMPONENT_KEY:
      return Math.max(10, Math.min(60, value));
    default:
      return value;
  }
}

/**
 * Spread a pillar's active component weights back to exactly 100, keeping their
 * proportions.
 *
 * Needed because two rules in the spec collide: section 5 says the user may switch a
 * component off, section 4 says the active components of a pillar must sum to 100.
 * Without this, ticking off "Omega 3" left the pillar at 80 and EVERY save came back
 * 400 - the switch existed but could never be used.
 *
 * Components with weight 0 (the "dziś gorąco" toggle) stay at 0: they are conditions,
 * not scored items, and must never earn a share of the pillar.
 * Returns null when there is nothing left to carry the pillar.
 */
function rebalanceComponents(pillar: PillarRecord): Array<{ id: string; weight: number }> | null {
  const scored = pillar.components.filter((c) => c.active && c.weight > 0 && c.id);
  const total = scored.reduce((sum, c) => sum + c.weight, 0);
  if (scored.length === 0 || total <= 0) return null;
  if (total === 100) return [];

  // Largest-remainder distribution, so the parts are integers and add up to 100 exactly.
  const exact = scored.map((c) => ({ c, raw: (c.weight * 100) / total }));
  const out = exact.map((e) => ({ c: e.c, weight: Math.floor(e.raw), rest: e.raw - Math.floor(e.raw) }));
  let left = 100 - out.reduce((sum, o) => sum + o.weight, 0);
  for (const o of [...out].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    o.weight += 1;
    left -= 1;
  }

  const changed: Array<{ id: string; weight: number }> = [];
  for (const o of out) {
    if (o.weight === o.c.weight) continue;
    o.c.weight = o.weight;
    changed.push({ id: o.c.id as string, weight: o.weight });
  }
  return changed;
}

function asArray(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object");
}

export type ConfigPlan =
  | { ok: false; error: string }
  | {
      ok: true;
      pillarUpdates: Array<{ id: string; data: Record<string, unknown> }>;
      componentUpdates: Array<{ id: string; data: Record<string, unknown> }>;
    };

/**
 * Apply a config patch to the in-memory pillars and decide whether it may be saved.
 *
 * Split out of the database call on purpose: this is where the spec's weight rules
 * live, so it has to be checkable with a handful of made-up pillars. It MUTATES the
 * records it is given, which is why the caller reloads from the database afterwards.
 *
 * Validation follows the spec: active pillars must sum to 100, and the active
 * components of a pillar must sum to 100. It is applied to the state AFTER the patch
 * and only to what the patch touched, so an unrelated edit is never blocked by an
 * imbalance somewhere else on the screen.
 */
export function planConfigUpdate(pillars: PillarRecord[], patch: EnergyConfigPatch): ConfigPlan {
  const pillarById = new Map(pillars.filter((p) => p.id).map((p) => [p.id as string, p]));
  const pillarByKey = new Map(pillars.map((p) => [p.key, p]));

  const componentOwner = new Map<string, PillarRecord>();
  const componentById = new Map<string, ComponentRecord>();
  const componentByKey = new Map<string, ComponentRecord>();
  for (const p of pillars) {
    for (const c of p.components) {
      componentOwner.set(c.key, p);
      if (c.id) componentById.set(c.id, c);
      componentByKey.set(c.key, c);
    }
  }

  const pillarUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const componentUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const touchedPillars = new Set<string>();
  /** Pillars where the request set a component weight explicitly. */
  const handWeightedPillars = new Set<string>();
  let pillarWeightsTouched = false;

  for (const raw of asArray(patch.pillars)) {
    const target =
      (typeof raw.id === "string" ? pillarById.get(raw.id) : undefined) ??
      (typeof raw.key === "string" ? pillarByKey.get(raw.key) : undefined);
    if (!target || !target.id) continue;

    const data: Record<string, unknown> = {};

    const weight = optionalInt(raw.weight, 0, 100);
    if (weight !== undefined && weight !== target.weight) {
      target.weight = weight;
      data.weight = weight;
      pillarWeightsTouched = true;
    }

    const active = optionalBool(raw.active);
    if (active !== undefined && active !== target.active) {
      target.active = active;
      data.active = active;
      pillarWeightsTouched = true;
    }

    const sortOrder = optionalInt(raw.sortOrder, 0, 999);
    if (sortOrder !== undefined) {
      target.sortOrder = sortOrder;
      data.sortOrder = sortOrder;
    }

    const name = optionalString(raw.name, 60);
    if (name !== undefined) {
      target.name = name;
      data.name = name;
    }

    const emoji = optionalString(raw.emoji, 8);
    if (emoji !== undefined) {
      target.emoji = emoji;
      data.emoji = emoji;
    }

    if (raw.lifeAreaId !== undefined) {
      const lifeAreaId = typeof raw.lifeAreaId === "string" ? raw.lifeAreaId : null;
      target.lifeAreaId = lifeAreaId;
      data.lifeAreaId = lifeAreaId;
    }

    if (Object.keys(data).length > 0) pillarUpdates.push({ id: target.id, data });
  }

  for (const raw of asArray(patch.components)) {
    const target =
      (typeof raw.id === "string" ? componentById.get(raw.id) : undefined) ??
      (typeof raw.key === "string" ? componentByKey.get(raw.key) : undefined);
    if (!target || !target.id) continue;

    const owner = componentOwner.get(target.key);
    const data: Record<string, unknown> = {};

    const weight = optionalInt(raw.weight, 0, 100);
    if (weight !== undefined && weight !== target.weight) {
      target.weight = weight;
      data.weight = weight;
      if (owner) {
        touchedPillars.add(owner.key);
        // The user set this weight by hand, so a mismatch is HIS to fix: no silent
        // rebalancing behind his back, he gets the error message instead.
        handWeightedPillars.add(owner.key);
      }
    }

    const active = optionalBool(raw.active);
    if (active !== undefined && active !== target.active) {
      target.active = active;
      data.active = active;
      if (owner) touchedPillars.add(owner.key);
    }

    /* Equality checks on purpose: the settings screen posts EVERY component on every
       save, so without them one tap would issue two dozen pointless UPDATEs. */
    const targetValue = optionalFloat(raw.target, 0);
    if (targetValue !== undefined) {
      const bounded = boundTarget(target.key, targetValue);
      if (bounded !== target.target) {
        target.target = bounded;
        data.target = bounded;
      }
    }

    if (raw.tolerance !== undefined) {
      const tolerance = raw.tolerance === null ? null : optionalFloat(raw.tolerance, 0);
      if (tolerance !== undefined && tolerance !== target.tolerance) {
        target.tolerance = tolerance;
        data.tolerance = tolerance;
      }
    }

    const sortOrder = optionalInt(raw.sortOrder, 0, 999);
    if (sortOrder !== undefined) {
      target.sortOrder = sortOrder;
      data.sortOrder = sortOrder;
    }

    const label = optionalString(raw.label, 80);
    if (label !== undefined) {
      target.label = label;
      data.label = label;
    }

    if (raw.hint !== undefined) {
      const hint = raw.hint === null ? null : (optionalString(raw.hint, 200) ?? null);
      target.hint = hint;
      data.hint = hint;
    }

    if (raw.unit !== undefined) {
      const unit = raw.unit === null ? null : (optionalString(raw.unit, 16) ?? null);
      target.unit = unit;
      data.unit = unit;
    }

    if (Object.keys(data).length > 0) componentUpdates.push({ id: target.id, data });
  }

  if (pillarWeightsTouched) {
    const sum = pillars.reduce((acc, p) => acc + (p.active ? p.weight : 0), 0);
    if (sum !== 100) {
      return {
        ok: false,
        error: `Wagi włączonych filarów muszą sumować się do 100. Teraz jest ${sum}.`,
      };
    }
  }

  for (const key of touchedPillars) {
    const pillar = pillarByKey.get(key);
    if (!pillar || !pillar.active) continue;
    const sum = pillar.components.reduce((acc, c) => acc + (c.active ? c.weight : 0), 0);
    if (sum === 100) continue;

    if (handWeightedPillars.has(key)) {
      return {
        ok: false,
        error: `Wagi włączonych składowych w filarze ${pillar.name} muszą sumować się do 100. Teraz jest ${sum}.`,
      };
    }

    // Only an on/off switch was flipped, so the app does the arithmetic instead of
    // handing the user a form he cannot satisfy.
    const rebalanced = rebalanceComponents(pillar);
    if (rebalanced === null) {
      return {
        ok: false,
        error: `Zostaw w filarze ${pillar.name} przynajmniej jedną włączoną składową, inaczej nie ma z czego liczyć wyniku.`,
      };
    }
    for (const r of rebalanced) {
      const existing = componentUpdates.find((u) => u.id === r.id);
      if (existing) existing.data.weight = r.weight;
      else componentUpdates.push({ id: r.id, data: { weight: r.weight } });
    }
  }

  return { ok: true, pillarUpdates, componentUpdates };
}

/** Thin database wrapper around `planConfigUpdate`. */
export async function updateEnergyConfig(
  userId: string,
  patch: EnergyConfigPatch
): Promise<EnergyConfigResult> {
  const loaded = await loadPillars(userId);
  if (loaded.degraded) {
    return {
      ok: false,
      error:
        "Filary energii nie są jeszcze zapisane w bazie. Otwórz ekran Energia i spróbuj ponownie.",
    };
  }

  const plan = planConfigUpdate(loaded.pillars, patch);
  if (!plan.ok) return { ok: false, error: plan.error };

  if (plan.pillarUpdates.length > 0 || plan.componentUpdates.length > 0) {
    await prisma.$transaction([
      ...plan.pillarUpdates.map((u) =>
        prisma.energyPillar.update({ where: { id: u.id }, data: u.data })
      ),
      ...plan.componentUpdates.map((u) =>
        prisma.energyComponent.update({ where: { id: u.id }, data: u.data })
      ),
    ]);
  }

  const fresh = await loadPillars(userId, { init: false });
  return { ok: true, config: toConfigView(fresh.pillars, fresh.degraded) };
}

/* ------------------------------------------------------------------ */
/*  Summary for the AI context                                         */
/* ------------------------------------------------------------------ */

export interface EnergySummary {
  today: { total: number; feltEnergy: number | null } | null;
  weakestToday: { key: string; name: string; percent: number } | null;
  weekAverage: number | null;
  /** Pillars below 60% today, weakest first. */
  belowTarget: Array<{ key: string; name: string; percent: number }>;
}

/**
 * Compact numbers for src/lib/ai/user-context.ts (section "Energia dnia" of the
 * spec). Kept here so the context file only formats a sentence and never has to
 * know how the score is built.
 */
export async function getEnergySummary(userId: string): Promise<EnergySummary | null> {
  try {
    const todayKey = polishDateKey();
    const [built, trend] = await Promise.all([
      buildDay(userId, todayKey, { init: false }),
      buildEnergyTrend(userId, 7),
    ]);

    const day = built.view;
    // `degraded` = the user has no energy setup in the database, so this "day" is the
    // code defaults scored against his logs. Telling a mentor "Dzis: 12%" off that
    // would be an invented fact, so the section is dropped instead.
    if (built.degraded || day.pillars.length === 0) return null;

    const sorted = [...day.pillars].sort((a, b) => a.percent - b.percent);
    const weakest = sorted[0]
      ? { key: sorted[0].key, name: sorted[0].name, percent: sorted[0].percent }
      : null;

    return {
      today: { total: day.total, feltEnergy: day.feltEnergy },
      weakestToday: weakest,
      weekAverage: trend.days.length > 0 ? trend.averages.total : null,
      belowTarget: sorted
        .filter((p) => p.percent < 60)
        .map((p) => ({ key: p.key, name: p.name, percent: p.percent })),
    };
  } catch (err) {
    console.warn("[energy] nie udalo sie zbudowac podsumowania energii:", err);
    return null;
  }
}
