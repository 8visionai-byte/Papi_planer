/**
 * Long-term memory: turns raw activity into a small set of durable conclusions.
 *
 * The point (BRAIN-SPEC section 4): raw data stays a fixed size in the AI context,
 * while the *knowledge* layer grows. Every function here writes rows into
 * `UserInsight`, which `src/lib/ai/insights-context.ts` renders back into the
 * prompt of every agent.
 *
 * Three producers:
 *  - `generateWeeklySummary` - one narrative row per ISO week (kind "weekly_summary")
 *  - `detectPatterns`        - repeating behaviour over 28 days   (kind "pattern")
 *  - `inferPreferences`      - what the user actually prefers     (kind "preference")
 *
 * All three are cheap on purpose: the heavy lifting (counting, bucketing,
 * correlating) happens in plain TypeScript, and the model is only asked to phrase
 * the numbers in Polish. That keeps max_tokens low and stops the model from
 * inventing statistics it was never given.
 */

import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS, DEFAULTS } from "@/lib/ai/claude";
import type { Prisma } from "@/generated/prisma/client";
import {
  addWeeks,
  endOfISOWeek,
  getISOWeek,
  getISOWeekYear,
  startOfDay,
  startOfISOWeek,
  subDays,
  subWeeks,
  format,
} from "date-fns";
import { pl } from "date-fns/locale";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type InsightKind = "weekly_summary" | "pattern" | "preference" | "milestone";

export interface GeneratedInsight {
  id: string;
  kind: InsightKind;
  period: string | null;
  title: string;
  content: string;
  confidence: number;
}

/** Window sizes, in days. Exported so the cron can report what it looked at. */
export const PATTERN_WINDOW_DAYS = 28;
export const PREFERENCE_WINDOW_DAYS = 60;

/**
 * Weekly summaries are the one narrative artefact a human reads on the "Wnioski"
 * screen, so they get the balanced model. Patterns and preferences are pure
 * rephrasing of numbers we already computed, so Haiku is enough (and ~10x cheaper).
 */
const MODEL_WEEKLY = MODELS.CHAT;
const MODEL_DERIVED = MODELS.FAST;

/* ------------------------------------------------------------------ */
/*  ISO week helpers                                                   */
/* ------------------------------------------------------------------ */

/** "2026-W31" for any date. Matches `UserInsight.period` for weekly summaries. */
export function isoWeekLabel(date: Date): string {
  return `${getISOWeekYear(date)}-W${String(getISOWeek(date)).padStart(2, "0")}`;
}

/** Label of the week that just ended - what a Sunday-evening cron should summarize. */
export function previousIsoWeekLabel(now: Date = new Date()): string {
  return isoWeekLabel(subWeeks(now, 1));
}

/** Inclusive day range of an ISO week label. Returns null when the label is malformed. */
export function isoWeekRange(isoWeek: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(isoWeek.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;

  // 4 January is always inside ISO week 1, in every year.
  const week1Start = startOfISOWeek(new Date(year, 0, 4));
  const start = startOfDay(addWeeks(week1Start, week - 1));
  return { start, end: endOfISOWeek(start) };
}

/* ------------------------------------------------------------------ */
/*  Claude plumbing                                                    */
/* ------------------------------------------------------------------ */

function stripFences(text: string): string {
  return text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
}

function parseJsonObject<T>(text: string): T | null {
  const cleaned = stripFences(text);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function parseJsonArray<T>(text: string): T[] | null {
  const cleaned = stripFences(text);
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

async function askClaude(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<string | null> {
  try {
    const res = await anthropic.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      temperature: DEFAULTS.ANALYSIS_TEMPERATURE,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    });
    const block = res.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : null;
  } catch {
    // A failed insight is never worth failing the caller (cron loops over users).
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

function clampConfidence(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function trimTo(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Deactivates every insight of one kind before a fresh batch is written.
 * Insights are never deleted - the user (and the cron) only flip `active`, so the
 * history of what the app once believed stays auditable.
 */
async function deactivateKind(userId: string, kind: InsightKind): Promise<number> {
  const res = await prisma.userInsight.updateMany({
    where: { userId, kind, active: true },
    data: { active: false },
  });
  return res.count;
}

/* ------------------------------------------------------------------ */
/*  1. Weekly summary                                                  */
/* ------------------------------------------------------------------ */

interface WeeklyFacts {
  daysLogged: number;
  activitiesPlanned: number;
  activitiesDone: number;
  completionPct: number;
  habitsExpected: number;
  habitsDone: number;
  habitsPct: number;
  trainings: number;
  trainingMinutes: number;
  caloriesEatenAvg: number | null;
  caloriesBurnedTotal: number;
  weightStart: number | null;
  weightEnd: number | null;
  weightDelta: number | null;
  energyAvg: number | null;
  sleepAvg: number | null;
  activeGoals: { title: string; progress: number }[];
  briefingCount: number;
  worstDay: string | null;
  bestDay: string | null;
}

interface ActivityMetricsShape {
  caloriesBurned?: number;
}

function caloriesBurnedOf(metrics: unknown): number {
  const m = metrics as ActivityMetricsShape | null | undefined;
  return m && typeof m === "object" && typeof m.caloriesBurned === "number"
    ? m.caloriesBurned
    : 0;
}

/** Hour (0-23) from a "HH:MM" string, or null. */
function hourOf(scheduledAt: string | null): number | null {
  if (!scheduledAt) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(scheduledAt.trim());
  if (!m) return null;
  const h = Number(m[1]);
  return h >= 0 && h <= 23 ? h : null;
}

async function collectWeeklyFacts(
  userId: string,
  start: Date,
  end: Date,
): Promise<WeeklyFacts> {
  const [logs, habits, habitCompletions, trainings, weights, goals, briefings] =
    await Promise.all([
      prisma.dailyLog.findMany({
        where: { userId, date: { gte: start, lte: end } },
        include: { activities: true, meals: true },
        orderBy: { date: "asc" },
      }),
      prisma.habit.findMany({ where: { userId, active: true } }),
      prisma.habitCompletion.findMany({
        where: { userId, date: { gte: start, lte: end } },
      }),
      prisma.trainingLog.findMany({
        where: { userId, date: { gte: start, lte: end } },
        orderBy: { date: "asc" },
      }),
      prisma.weightEntry.findMany({
        where: { userId, date: { gte: subDays(start, 7), lte: end } },
        orderBy: { date: "asc" },
      }),
      prisma.goal.findMany({
        where: { userId, status: "active" },
        select: { title: true, progress: true },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.briefing.findMany({
        where: { userId, date: { gte: start, lte: end } },
        select: { id: true },
      }),
    ]);

  let planned = 0;
  let done = 0;
  let burned = 0;
  let eatenDays = 0;
  let eatenTotal = 0;
  const energies: number[] = [];
  const sleeps: number[] = [];
  let worst: { label: string; pct: number } | null = null;
  let best: { label: string; pct: number } | null = null;

  for (const log of logs) {
    planned += log.activities.length;
    const dayDone = log.activities.filter((a) => a.completed).length;
    done += dayDone;
    burned += log.activities.reduce((sum, a) => sum + caloriesBurnedOf(a.metrics), 0);

    const dayCalories = log.meals.reduce((sum, m) => sum + (m.calories ?? 0), 0);
    if (log.meals.length > 0) {
      eatenDays += 1;
      eatenTotal += dayCalories;
    }
    if (log.energy != null) energies.push(log.energy);
    if (log.sleepHours != null) sleeps.push(log.sleepHours);

    if (log.activities.length > 0) {
      const pct = Math.round((dayDone / log.activities.length) * 100);
      const label = format(log.date, "EEEE", { locale: pl });
      if (!worst || pct < worst.pct) worst = { label, pct };
      if (!best || pct > best.pct) best = { label, pct };
    }
  }

  const daysInRange = Math.min(
    7,
    Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1),
  );
  const habitsExpected = habits.length * daysInRange;
  const habitsDone = habitCompletions.filter((c) => c.completed).length;

  const weightStart = weights.length > 0 ? weights[0].weightKg : null;
  const weightEnd = weights.length > 0 ? weights[weights.length - 1].weightKg : null;

  const avg = (xs: number[]) =>
    xs.length > 0 ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

  return {
    daysLogged: logs.length,
    activitiesPlanned: planned,
    activitiesDone: done,
    completionPct: planned > 0 ? Math.round((done / planned) * 100) : 0,
    habitsExpected,
    habitsDone,
    habitsPct: habitsExpected > 0 ? Math.round((habitsDone / habitsExpected) * 100) : 0,
    trainings: trainings.length,
    trainingMinutes: trainings.reduce((sum, t) => sum + (t.durationMin ?? 0), 0),
    caloriesEatenAvg: eatenDays > 0 ? Math.round(eatenTotal / eatenDays) : null,
    caloriesBurnedTotal: Math.round(burned),
    weightStart,
    weightEnd,
    weightDelta:
      weightStart != null && weightEnd != null
        ? Math.round((weightEnd - weightStart) * 10) / 10
        : null,
    energyAvg: avg(energies),
    sleepAvg: avg(sleeps),
    activeGoals: goals.map((g) => ({ title: g.title, progress: g.progress })),
    briefingCount: briefings.length,
    worstDay: worst ? `${worst.label} (${worst.pct}%)` : null,
    bestDay: best ? `${best.label} (${best.pct}%)` : null,
  };
}

function weeklyFactsToText(facts: WeeklyFacts, isoWeek: string): string {
  const lines: string[] = [`Tydzien: ${isoWeek}`];
  lines.push(`Dni z zapisanym planem: ${facts.daysLogged}/7`);
  lines.push(
    `Zadania: ${facts.activitiesDone}/${facts.activitiesPlanned} wykonanych (${facts.completionPct}%)`,
  );
  if (facts.habitsExpected > 0) {
    lines.push(
      `Nawyki: ${facts.habitsDone}/${facts.habitsExpected} odhaczen (${facts.habitsPct}%)`,
    );
  }
  lines.push(`Treningi: ${facts.trainings}, lacznie ${facts.trainingMinutes} min`);
  if (facts.caloriesEatenAvg != null) {
    lines.push(`Srednie spozycie: ${facts.caloriesEatenAvg} kcal/dzien`);
  }
  if (facts.caloriesBurnedTotal > 0) {
    lines.push(`Spalone w aktywnosciach: ${facts.caloriesBurnedTotal} kcal w tygodniu`);
  }
  if (facts.weightStart != null && facts.weightEnd != null) {
    lines.push(
      `Waga: ${facts.weightStart} kg -> ${facts.weightEnd} kg (zmiana ${facts.weightDelta} kg)`,
    );
  }
  if (facts.energyAvg != null) lines.push(`Srednia energia: ${facts.energyAvg}/10`);
  if (facts.sleepAvg != null) lines.push(`Sredni sen: ${facts.sleepAvg} h`);
  if (facts.bestDay) lines.push(`Najlepszy dzien: ${facts.bestDay}`);
  if (facts.worstDay) lines.push(`Najslabszy dzien: ${facts.worstDay}`);
  if (facts.briefingCount > 0) lines.push(`Briefingi wieczorne: ${facts.briefingCount}`);
  if (facts.activeGoals.length > 0) {
    lines.push(
      `Aktywne cele: ${facts.activeGoals.map((g) => `${g.title} (${g.progress}%)`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

const WEEKLY_SYSTEM = `Jestes analitykiem, ktory pisze krotkie podsumowanie tygodnia dla uzytkownika aplikacji do rozwoju osobistego.

ZASADY:
- Piszesz po polsku, prostym jezykiem, bezposrednio do uzytkownika ("zrobiles", "pomijales").
- Uzywasz WYLACZNIE liczb podanych w danych. Nie wymyslasz zadnych innych.
- Bez lania wody, bez motywacyjnych frazesow, bez emoji.
- Struktura tresci: 1) co szlo dobrze, 2) co nie szlo, 3) kluczowe liczby, 4) jeden konkretny wniosek na przyszly tydzien.
- Calosc do 900 znakow.
- confidence: 0.3 gdy danych bylo malo (mniej niz 3 dni z zapisami), 0.6 przy czesciowych, 0.9 przy pelnym tygodniu.

Odpowiedz TYLKO jako JSON:
{"title":"krotki tytul do 60 znakow","content":"tresc","confidence":0.7}`;

/**
 * Builds (or refreshes) the summary of one ISO week and stores it as
 * `kind: "weekly_summary"`, `period: "YYYY-Www"`.
 *
 * @param userId  owner
 * @param isoWeek e.g. "2026-W31". Defaults to the week that has just ended.
 * @returns the stored insight, or null when there was nothing to summarize.
 */
export async function generateWeeklySummary(
  userId: string,
  isoWeek?: string,
): Promise<GeneratedInsight | null> {
  const period = isoWeek ?? previousIsoWeekLabel();
  const range = isoWeekRange(period);
  if (!range) return null;

  const facts = await collectWeeklyFacts(userId, range.start, range.end);

  // Nothing happened: writing "byles nieaktywny" would be noise, not knowledge.
  if (
    facts.daysLogged === 0 &&
    facts.habitsDone === 0 &&
    facts.trainings === 0 &&
    facts.weightEnd == null
  ) {
    return null;
  }

  const text = await askClaude({
    model: MODEL_WEEKLY,
    system: WEEKLY_SYSTEM,
    user: weeklyFactsToText(facts, period),
    maxTokens: 900,
  });
  if (!text) return null;

  const parsed = parseJsonObject<{ title?: string; content?: string; confidence?: number }>(
    text,
  );
  if (!parsed?.content) return null;

  const dateLabel = `${format(range.start, "d MMM", { locale: pl })} - ${format(range.end, "d MMM yyyy", { locale: pl })}`;

  const row = await prisma.userInsight.upsert({
    where: { userId_kind_period: { userId, kind: "weekly_summary", period } },
    create: {
      userId,
      kind: "weekly_summary",
      period,
      title: trimTo(parsed.title || `Tydzien ${period}`, 80),
      content: trimTo(parsed.content, 1200),
      evidence: { range: dateLabel, facts } as unknown as Prisma.InputJsonValue,
      confidence: clampConfidence(parsed.confidence, 0.6),
      active: true,
    },
    update: {
      title: trimTo(parsed.title || `Tydzien ${period}`, 80),
      content: trimTo(parsed.content, 1200),
      evidence: { range: dateLabel, facts } as unknown as Prisma.InputJsonValue,
      confidence: clampConfidence(parsed.confidence, 0.6),
      active: true,
    },
  });

  return {
    id: row.id,
    kind: "weekly_summary",
    period: row.period,
    title: row.title,
    content: row.content,
    confidence: row.confidence,
  };
}

/* ------------------------------------------------------------------ */
/*  2. Patterns                                                        */
/* ------------------------------------------------------------------ */

interface PatternStats {
  windowDays: number;
  /** Activity types skipped most often, with the hour they were scheduled at. */
  skippedByType: { type: string; skipped: number; planned: number; peakHour: number | null }[];
  /** Same, but by activity name - catches "poranna medytacja" specifically. */
  skippedByName: { name: string; skipped: number; planned: number; peakHour: number | null }[];
  /** Plan completion split by sleep and by energy. */
  sleepVsCompletion: { goodSleepPct: number | null; poorSleepPct: number | null; threshold: number };
  energyVsCompletion: { highEnergyPct: number | null; lowEnergyPct: number | null; threshold: number };
  /** Worst-performing habits over the window. */
  weakestHabits: { name: string; done: number; expected: number; pct: number }[];
  /** Four-week trend of weight against the average daily calorie balance. */
  weightVsBalance: {
    week: string;
    avgWeightKg: number | null;
    avgNetCalories: number | null;
    deltaKg: number | null;
  }[];
}

function pct(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

function peakHourOf(hours: number[]): number | null {
  if (hours.length === 0) return null;
  const counts = new Map<number, number>();
  for (const h of hours) counts.set(h, (counts.get(h) ?? 0) + 1);
  let bestHour: number | null = null;
  let bestCount = 0;
  for (const [h, c] of counts) {
    if (c > bestCount) {
      bestCount = c;
      bestHour = h;
    }
  }
  return bestHour;
}

async function collectPatternStats(userId: string): Promise<PatternStats> {
  const today = startOfDay(new Date());
  const since = subDays(today, PATTERN_WINDOW_DAYS - 1);
  const since4w = subDays(today, 27);

  const [logs, habits, habitCompletions, weights] = await Promise.all([
    prisma.dailyLog.findMany({
      where: { userId, date: { gte: since, lte: today } },
      include: { activities: true, meals: true },
      orderBy: { date: "asc" },
    }),
    prisma.habit.findMany({ where: { userId, active: true } }),
    prisma.habitCompletion.findMany({
      where: { userId, date: { gte: since, lte: today } },
    }),
    prisma.weightEntry.findMany({
      where: { userId, date: { gte: since4w, lte: today } },
      orderBy: { date: "asc" },
    }),
  ]);

  /* --- skipped activities, by type and by name --- */
  const byType = new Map<string, { planned: number; skipped: number; hours: number[] }>();
  const byName = new Map<string, { planned: number; skipped: number; hours: number[] }>();

  for (const log of logs) {
    for (const a of log.activities) {
      const t = byType.get(a.type) ?? { planned: 0, skipped: 0, hours: [] };
      t.planned += 1;
      const n = byName.get(a.name) ?? { planned: 0, skipped: 0, hours: [] };
      n.planned += 1;
      if (!a.completed) {
        t.skipped += 1;
        n.skipped += 1;
        const h = hourOf(a.scheduledAt);
        if (h != null) {
          t.hours.push(h);
          n.hours.push(h);
        }
      }
      byType.set(a.type, t);
      byName.set(a.name, n);
    }
  }

  const toRanked = (map: Map<string, { planned: number; skipped: number; hours: number[] }>) =>
    [...map.entries()]
      .filter(([, v]) => v.skipped >= 2)
      .sort((a, b) => b[1].skipped - a[1].skipped)
      .slice(0, 5);

  /* --- sleep / energy vs plan completion --- */
  let goodSleepDone = 0;
  let goodSleepPlanned = 0;
  let poorSleepDone = 0;
  let poorSleepPlanned = 0;
  let highEnergyDone = 0;
  let highEnergyPlanned = 0;
  let lowEnergyDone = 0;
  let lowEnergyPlanned = 0;

  for (const log of logs) {
    if (log.activities.length === 0) continue;
    const done = log.activities.filter((a) => a.completed).length;
    if (log.sleepHours != null) {
      if (log.sleepHours >= 7) {
        goodSleepDone += done;
        goodSleepPlanned += log.activities.length;
      } else {
        poorSleepDone += done;
        poorSleepPlanned += log.activities.length;
      }
    }
    if (log.energy != null) {
      if (log.energy >= 7) {
        highEnergyDone += done;
        highEnergyPlanned += log.activities.length;
      } else {
        lowEnergyDone += done;
        lowEnergyPlanned += log.activities.length;
      }
    }
  }

  /* --- habits --- */
  const doneByHabit = new Map<string, number>();
  for (const c of habitCompletions) {
    if (c.completed) doneByHabit.set(c.habitId, (doneByHabit.get(c.habitId) ?? 0) + 1);
  }
  const weakestHabits = habits
    .map((h) => {
      // A habit created mid-window is only expected on the days it existed.
      const createdDaysAgo = Math.max(
        1,
        Math.min(
          PATTERN_WINDOW_DAYS,
          Math.round((today.getTime() - startOfDay(h.createdAt).getTime()) / 86_400_000) + 1,
        ),
      );
      const done = doneByHabit.get(h.id) ?? 0;
      return {
        name: h.name,
        done,
        expected: createdDaysAgo,
        pct: Math.round((done / createdDaysAgo) * 100),
      };
    })
    .filter((h) => h.expected >= 7)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3);

  /* --- weight vs calorie balance, week by week --- */
  const weekBuckets = new Map<
    string,
    { weights: number[]; netCalories: number[] }
  >();
  for (const w of weights) {
    const key = isoWeekLabel(w.date);
    const b = weekBuckets.get(key) ?? { weights: [], netCalories: [] };
    b.weights.push(w.weightKg);
    weekBuckets.set(key, b);
  }
  for (const log of logs) {
    const eaten = log.meals.reduce((sum, m) => sum + (m.calories ?? 0), 0);
    if (eaten === 0) continue;
    const burnedDay = log.activities.reduce((sum, a) => sum + caloriesBurnedOf(a.metrics), 0);
    const key = isoWeekLabel(log.date);
    const b = weekBuckets.get(key) ?? { weights: [], netCalories: [] };
    b.netCalories.push(Math.round(eaten - burnedDay));
    weekBuckets.set(key, b);
  }

  const avgOf = (xs: number[]) =>
    xs.length > 0 ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

  const weekKeys = [...weekBuckets.keys()].sort();
  const weightVsBalance = weekKeys.map((key, i) => {
    const b = weekBuckets.get(key)!;
    const avgWeightKg = avgOf(b.weights);
    const prev = i > 0 ? weekBuckets.get(weekKeys[i - 1])! : null;
    const prevAvg = prev ? avgOf(prev.weights) : null;
    return {
      week: key,
      avgWeightKg,
      avgNetCalories: b.netCalories.length > 0 ? Math.round(avgOf(b.netCalories)!) : null,
      deltaKg:
        avgWeightKg != null && prevAvg != null
          ? Math.round((avgWeightKg - prevAvg) * 10) / 10
          : null,
    };
  });

  return {
    windowDays: PATTERN_WINDOW_DAYS,
    skippedByType: toRanked(byType).map(([type, v]) => ({
      type,
      skipped: v.skipped,
      planned: v.planned,
      peakHour: peakHourOf(v.hours),
    })),
    skippedByName: toRanked(byName).map(([name, v]) => ({
      name,
      skipped: v.skipped,
      planned: v.planned,
      peakHour: peakHourOf(v.hours),
    })),
    sleepVsCompletion: {
      goodSleepPct: pct(goodSleepDone, goodSleepPlanned),
      poorSleepPct: pct(poorSleepDone, poorSleepPlanned),
      threshold: 7,
    },
    energyVsCompletion: {
      highEnergyPct: pct(highEnergyDone, highEnergyPlanned),
      lowEnergyPct: pct(lowEnergyDone, lowEnergyPlanned),
      threshold: 7,
    },
    weakestHabits,
    weightVsBalance,
  };
}

function patternStatsToText(stats: PatternStats): string {
  const lines: string[] = [`Okno obserwacji: ostatnie ${stats.windowDays} dni`];

  if (stats.skippedByType.length > 0) {
    lines.push("\nPomijane typy zadan:");
    for (const s of stats.skippedByType) {
      lines.push(
        `- typ "${s.type}": pominiete ${s.skipped} z ${s.planned}${s.peakHour != null ? `, najczesciej o ${String(s.peakHour).padStart(2, "0")}:00` : ""}`,
      );
    }
  }
  if (stats.skippedByName.length > 0) {
    lines.push("\nPomijane konkretne zadania:");
    for (const s of stats.skippedByName) {
      lines.push(
        `- "${s.name}": pominiete ${s.skipped} z ${s.planned}${s.peakHour != null ? `, najczesciej o ${String(s.peakHour).padStart(2, "0")}:00` : ""}`,
      );
    }
  }

  const sl = stats.sleepVsCompletion;
  if (sl.goodSleepPct != null && sl.poorSleepPct != null) {
    lines.push(
      `\nSen a plan: po >= ${sl.threshold}h snu wykonanie ${sl.goodSleepPct}%, po krotszym ${sl.poorSleepPct}%`,
    );
  }
  const en = stats.energyVsCompletion;
  if (en.highEnergyPct != null && en.lowEnergyPct != null) {
    lines.push(
      `Energia a plan: przy energii >= ${en.threshold}/10 wykonanie ${en.highEnergyPct}%, przy nizszej ${en.lowEnergyPct}%`,
    );
  }
  if (stats.weakestHabits.length > 0) {
    lines.push("\nNajslabsze nawyki:");
    for (const h of stats.weakestHabits) {
      lines.push(`- "${h.name}": ${h.done}/${h.expected} dni (${h.pct}%)`);
    }
  }
  if (stats.weightVsBalance.length > 0) {
    lines.push("\nWaga a bilans kaloryczny (tydzien po tygodniu):");
    for (const w of stats.weightVsBalance) {
      lines.push(
        `- ${w.week}: srednia waga ${w.avgWeightKg ?? "brak"} kg, zmiana ${w.deltaKg ?? "brak"} kg, sredni bilans ${w.avgNetCalories ?? "brak"} kcal/dzien`,
      );
    }
  }
  return lines.join("\n");
}

const PATTERN_SYSTEM = `Jestes analitykiem zachowan. Dostajesz POLICZONE statystyki uzytkownika aplikacji rozwojowej i masz nazwac powtarzalne wzorce.

ZASADY:
- Po polsku, prostym jezykiem, do 3 wzorcow. Mniej znaczy lepiej.
- Kazdy wzorzec MUSI opierac sie na liczbach z danych i cytowac je w tresci.
- Nie wymyslasz liczb, ktorych nie ma. Jesli dane sa slabe, zwroc mniej wzorcow albo pusta tablice.
- Bez motywacji i bez ocen moralnych. Opisujesz fakt i jego konsekwencje dla planowania.
- title do 60 znakow, content do 320 znakow.
- confidence: ile probek stoi za wnioskiem. 3-5 obserwacji = 0.4, 6-10 = 0.6, powyzej 10 = 0.85.
- facts: liczby, na ktorych oparles wniosek (krotkie stringi).

Odpowiedz TYLKO jako JSON array:
[{"title":"...","content":"...","confidence":0.6,"facts":["..."]}]`;

/**
 * Recomputes behavioural patterns over the last 28 days.
 *
 * Old patterns are deactivated first, so the active set is always the current
 * picture. Nothing is deleted - the history stays queryable.
 */
export async function detectPatterns(userId: string): Promise<GeneratedInsight[]> {
  const stats = await collectPatternStats(userId);

  const hasSignal =
    stats.skippedByType.length > 0 ||
    stats.skippedByName.length > 0 ||
    stats.weakestHabits.length > 0 ||
    stats.sleepVsCompletion.goodSleepPct != null ||
    stats.energyVsCompletion.highEnergyPct != null ||
    stats.weightVsBalance.length >= 2;
  if (!hasSignal) return [];

  const text = await askClaude({
    model: MODEL_DERIVED,
    system: PATTERN_SYSTEM,
    user: patternStatsToText(stats),
    maxTokens: 900,
  });
  if (!text) return [];

  const parsed = parseJsonArray<{
    title?: string;
    content?: string;
    confidence?: number;
    facts?: string[];
  }>(text);
  if (!parsed || parsed.length === 0) return [];

  await deactivateKind(userId, "pattern");

  const created: GeneratedInsight[] = [];
  for (const p of parsed.slice(0, 3)) {
    if (!p.content) continue;
    // period stays null: patterns are open-ended. Postgres treats NULL as distinct
    // inside the (userId, kind, period) unique index, so several rows coexist.
    const row = await prisma.userInsight.create({
      data: {
        userId,
        kind: "pattern",
        period: null,
        title: trimTo(p.title || "Wzorzec", 80),
        content: trimTo(p.content, 500),
        evidence: {
          windowDays: stats.windowDays,
          facts: Array.isArray(p.facts) ? p.facts.slice(0, 8) : [],
          stats,
        } as unknown as Prisma.InputJsonValue,
        confidence: clampConfidence(p.confidence, 0.5),
        active: true,
      },
    });
    created.push({
      id: row.id,
      kind: "pattern",
      period: null,
      title: row.title,
      content: row.content,
      confidence: row.confidence,
    });
  }
  return created;
}

/* ------------------------------------------------------------------ */
/*  3. Preferences                                                     */
/* ------------------------------------------------------------------ */

interface PreferenceStats {
  windowDays: number;
  /** Completion rate of training-ish activities by part of the day. */
  trainingByDaypart: { daypart: string; done: number; planned: number; pct: number }[];
  /** Completion rate by planned duration - catches "nie robi sesji ponad 60 min". */
  byDuration: { bucket: string; done: number; planned: number; pct: number }[];
  /** Completion rate by day of week. */
  byWeekday: { weekday: string; done: number; planned: number; pct: number }[];
  /** How often a morning meal was logged at all. */
  breakfast: { daysWithMeals: number; daysWithMorningMeal: number; skipPct: number | null };
  /** Habit success grouped by the slot the user assigned them to. */
  habitsByTimeOfDay: { timeOfDay: string; done: number; expected: number; pct: number }[];
}

const TRAINING_TYPES = new Set(["training", "exercise"]);
const WEEKDAYS_PL = ["niedziela", "poniedzialek", "wtorek", "sroda", "czwartek", "piatek", "sobota"];

function daypartOf(hour: number | null): string | null {
  if (hour == null) return null;
  if (hour < 10) return "rano (przed 10:00)";
  if (hour < 16) return "w srodku dnia (10:00-16:00)";
  return "wieczorem (po 16:00)";
}

function durationBucketOf(min: number | null): string | null {
  if (min == null || min <= 0) return null;
  if (min <= 30) return "do 30 min";
  if (min <= 60) return "31-60 min";
  return "powyzej 60 min";
}

async function collectPreferenceStats(userId: string): Promise<PreferenceStats> {
  const today = startOfDay(new Date());
  const since = subDays(today, PREFERENCE_WINDOW_DAYS - 1);

  const [logs, habits, habitCompletions] = await Promise.all([
    prisma.dailyLog.findMany({
      where: { userId, date: { gte: since, lte: today } },
      include: { activities: true, meals: true },
      orderBy: { date: "asc" },
    }),
    prisma.habit.findMany({ where: { userId, active: true } }),
    prisma.habitCompletion.findMany({
      where: { userId, date: { gte: since, lte: today } },
    }),
  ]);

  const bump = (
    map: Map<string, { done: number; planned: number }>,
    key: string,
    completed: boolean,
  ) => {
    const v = map.get(key) ?? { done: 0, planned: 0 };
    v.planned += 1;
    if (completed) v.done += 1;
    map.set(key, v);
  };

  const daypart = new Map<string, { done: number; planned: number }>();
  const duration = new Map<string, { done: number; planned: number }>();
  const weekday = new Map<string, { done: number; planned: number }>();
  let daysWithMeals = 0;
  let daysWithMorningMeal = 0;

  for (const log of logs) {
    for (const a of log.activities) {
      if (TRAINING_TYPES.has(a.type)) {
        const dp = daypartOf(hourOf(a.scheduledAt));
        if (dp) bump(daypart, dp, a.completed);
      }
      const db = durationBucketOf(a.durationMin);
      if (db) bump(duration, db, a.completed);
      bump(weekday, WEEKDAYS_PL[log.date.getDay()], a.completed);
    }
    if (log.meals.length > 0) {
      daysWithMeals += 1;
      const hasMorning = log.meals.some((m) => {
        const h = hourOf(m.time);
        return h != null && h < 11;
      });
      if (hasMorning) daysWithMorningMeal += 1;
    }
  }

  const flatten = (map: Map<string, { done: number; planned: number }>, minPlanned: number) =>
    [...map.entries()]
      .filter(([, v]) => v.planned >= minPlanned)
      .map(([key, v]) => ({
        key,
        done: v.done,
        planned: v.planned,
        pct: Math.round((v.done / v.planned) * 100),
      }))
      .sort((a, b) => b.pct - a.pct);

  const doneByHabit = new Map<string, number>();
  for (const c of habitCompletions) {
    if (c.completed) doneByHabit.set(c.habitId, (doneByHabit.get(c.habitId) ?? 0) + 1);
  }
  const slotAgg = new Map<string, { done: number; expected: number }>();
  for (const h of habits) {
    const expected = Math.max(
      1,
      Math.min(
        PREFERENCE_WINDOW_DAYS,
        Math.round((today.getTime() - startOfDay(h.createdAt).getTime()) / 86_400_000) + 1,
      ),
    );
    const v = slotAgg.get(h.timeOfDay) ?? { done: 0, expected: 0 };
    v.done += doneByHabit.get(h.id) ?? 0;
    v.expected += expected;
    slotAgg.set(h.timeOfDay, v);
  }

  return {
    windowDays: PREFERENCE_WINDOW_DAYS,
    trainingByDaypart: flatten(daypart, 3).map((x) => ({
      daypart: x.key,
      done: x.done,
      planned: x.planned,
      pct: x.pct,
    })),
    byDuration: flatten(duration, 3).map((x) => ({
      bucket: x.key,
      done: x.done,
      planned: x.planned,
      pct: x.pct,
    })),
    byWeekday: flatten(weekday, 3).map((x) => ({
      weekday: x.key,
      done: x.done,
      planned: x.planned,
      pct: x.pct,
    })),
    breakfast: {
      daysWithMeals,
      daysWithMorningMeal,
      skipPct:
        daysWithMeals >= 7
          ? Math.round(((daysWithMeals - daysWithMorningMeal) / daysWithMeals) * 100)
          : null,
    },
    habitsByTimeOfDay: [...slotAgg.entries()]
      .filter(([, v]) => v.expected >= 7)
      .map(([timeOfDay, v]) => ({
        timeOfDay,
        done: v.done,
        expected: v.expected,
        pct: Math.round((v.done / v.expected) * 100),
      }))
      .sort((a, b) => b.pct - a.pct),
  };
}

function preferenceStatsToText(stats: PreferenceStats): string {
  const lines: string[] = [`Okno obserwacji: ostatnie ${stats.windowDays} dni`];

  if (stats.trainingByDaypart.length > 0) {
    lines.push("\nTreningi wg pory dnia (wykonane / zaplanowane):");
    for (const d of stats.trainingByDaypart) {
      lines.push(`- ${d.daypart}: ${d.done}/${d.planned} (${d.pct}%)`);
    }
  }
  if (stats.byDuration.length > 0) {
    lines.push("\nWszystkie zadania wg dlugosci:");
    for (const d of stats.byDuration) {
      lines.push(`- ${d.bucket}: ${d.done}/${d.planned} (${d.pct}%)`);
    }
  }
  if (stats.byWeekday.length > 0) {
    lines.push("\nZadania wg dnia tygodnia:");
    for (const d of stats.byWeekday) {
      lines.push(`- ${d.weekday}: ${d.done}/${d.planned} (${d.pct}%)`);
    }
  }
  if (stats.breakfast.skipPct != null) {
    lines.push(
      `\nPosilki: dni z zapisanym jedzeniem ${stats.breakfast.daysWithMeals}, z tego z posilkiem przed 11:00 ${stats.breakfast.daysWithMorningMeal}. Brak porannego posilku w ${stats.breakfast.skipPct}% dni.`,
    );
  }
  if (stats.habitsByTimeOfDay.length > 0) {
    lines.push("\nNawyki wg pory dnia:");
    for (const h of stats.habitsByTimeOfDay) {
      lines.push(`- ${h.timeOfDay}: ${h.done}/${h.expected} (${h.pct}%)`);
    }
  }
  return lines.join("\n");
}

const PREFERENCE_SYSTEM = `Jestes analitykiem, ktory z ZACHOWAN uzytkownika wyprowadza jego preferencje. Dostajesz policzone statystyki.

ZASADY:
- Po polsku, prostym jezykiem, maksymalnie 3 preferencje.
- Preferencja = zdanie o tym, JAK uzytkownik lubi pracowac, np. "Trenuje najchetniej rano", "Odrzuca sesje dluzsze niz 60 minut", "Regularnie pomija sniadanie".
- Kazda preferencja MUSI byc poparta liczbami z danych i cytowac je w tresci.
- Nie wymyslasz liczb. Przy slabych danych zwroc mniej pozycji albo pusta tablice.
- title do 60 znakow, content do 280 znakow.
- confidence: 0.4 przy 3-5 obserwacjach, 0.6 przy 6-10, 0.85 powyzej 10.
- facts: liczby, na ktorych oparles wniosek.

Odpowiedz TYLKO jako JSON array:
[{"title":"...","content":"...","confidence":0.6,"facts":["..."]}]`;

/**
 * Infers stable preferences from behaviour over the last 60 days.
 * Same replace-not-delete rule as `detectPatterns`.
 */
export async function inferPreferences(userId: string): Promise<GeneratedInsight[]> {
  const stats = await collectPreferenceStats(userId);

  const hasSignal =
    stats.trainingByDaypart.length > 0 ||
    stats.byDuration.length > 1 ||
    stats.byWeekday.length > 2 ||
    stats.breakfast.skipPct != null ||
    stats.habitsByTimeOfDay.length > 0;
  if (!hasSignal) return [];

  const text = await askClaude({
    model: MODEL_DERIVED,
    system: PREFERENCE_SYSTEM,
    user: preferenceStatsToText(stats),
    maxTokens: 800,
  });
  if (!text) return [];

  const parsed = parseJsonArray<{
    title?: string;
    content?: string;
    confidence?: number;
    facts?: string[];
  }>(text);
  if (!parsed || parsed.length === 0) return [];

  await deactivateKind(userId, "preference");

  const created: GeneratedInsight[] = [];
  for (const p of parsed.slice(0, 3)) {
    if (!p.content) continue;
    const row = await prisma.userInsight.create({
      data: {
        userId,
        kind: "preference",
        period: null,
        title: trimTo(p.title || "Preferencja", 80),
        content: trimTo(p.content, 500),
        evidence: {
          windowDays: stats.windowDays,
          facts: Array.isArray(p.facts) ? p.facts.slice(0, 8) : [],
          stats,
        } as unknown as Prisma.InputJsonValue,
        confidence: clampConfidence(p.confidence, 0.5),
        active: true,
      },
    });
    created.push({
      id: row.id,
      kind: "preference",
      period: null,
      title: row.title,
      content: row.content,
      confidence: row.confidence,
    });
  }
  return created;
}

/* ------------------------------------------------------------------ */
/*  Maintenance                                                        */
/* ------------------------------------------------------------------ */

/**
 * Retires every insight older than `maxAgeDays` (default 90), whatever its kind:
 * a conclusion drawn from data three months old no longer describes the user.
 *
 * Deactivation, not deletion - the row stays queryable, it just stops reaching the
 * mentors and the "Wnioski" screen. Pass a different `maxAgeDays` if a kind should
 * ever get its own retention.
 */
export async function deactivateStaleInsights(
  userId: string,
  maxAgeDays = 90,
): Promise<number> {
  const cutoff = subDays(new Date(), maxAgeDays);
  const res = await prisma.userInsight.updateMany({
    where: { userId, active: true, createdAt: { lt: cutoff } },
    data: { active: false },
  });
  return res.count;
}
