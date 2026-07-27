import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import {
  buildEnergyTrend,
  dateKeyToDate,
  dateToDateKey,
  polishDateKey,
  type EnergyInsight,
  type EnergyTrendView,
} from "@/lib/energy";

const DEFAULT_DAYS = 30;

/* ------------------------------------------------------------------ */
/*  Skipped meals against felt energy                                  */
/*                                                                     */
/*  The owner's own question: "jak opuszczam sniadania, to jakos mam    */
/*  wiecej energii pozniej? Albo jak zjem sniadanie, to mam wiecej      */
/*  energii w ciagu dnia". This block answers it with arithmetic only,  */
/*  no AI, and it only ever shows two averages. No cause, no advice.    */
/* ------------------------------------------------------------------ */

/** Only the three fixed meals. A snack is not a decision worth a headline. */
const CORRELATED_SLOTS = ["sniadanie", "obiad", "kolacja"] as const;
type CorrelatedSlot = (typeof CORRELATED_SLOTS)[number];

/**
 * Wording per slot, so the sentence stays grammatical in Polish.
 * `skip` is the accusative after "pomijasz", `pronoun` the one after "gdy ... jesz".
 */
const SLOT_WORDS: Record<CorrelatedSlot, { skip: string; pronoun: string }> = {
  sniadanie: { skip: "śniadanie", pronoun: "je" },
  obiad: { skip: "obiad", pronoun: "go" },
  kolacja: { skip: "kolację", pronoun: "ją" },
};

/** Below this many days in EITHER group, two coincidences are not a pattern. */
const MIN_DAYS_PER_GROUP = 3;
/** A gap narrower than this is noise on a 1-10 scale. */
const MIN_FELT_DIFFERENCE = 1;

interface DayMealFacts {
  /** Slots the user marked as deliberately not eaten that day. */
  skipped: Set<string>;
  /** Slots with a real, logged meal that day. */
  eaten: Set<string>;
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** 6.75 -> "6,8". Polish decimal comma, one place, because this is a 1-10 rating. */
function fmtFelt(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

/**
 * At most ONE sentence: the slot with the widest gap.
 *
 * Pure on purpose (no Prisma here), so the rule can be checked against a handful of
 * made-up days. `felt` holds only days the user actually rated; a day where the slot
 * is neither logged nor skipped is unknown and enters neither group.
 *
 * NOT exported: a `route.ts` module may only export HTTP verbs and route config.
 */
function computeSkippedMealInsight(
  felt: Map<string, number>,
  facts: Map<string, DayMealFacts>
): EnergyInsight | null {
  let best: { diff: number; insight: EnergyInsight } | null = null;

  for (const slot of CORRELATED_SLOTS) {
    const skippedDays: number[] = [];
    const eatenDays: number[] = [];

    for (const [dateKey, rating] of felt) {
      const day = facts.get(dateKey);
      if (!day) continue;
      // A day holding both answers for one slot should not exist (the API replaces
      // one with the other), but if it ever does, the meal he ate wins.
      if (day.eaten.has(slot)) eatenDays.push(rating);
      else if (day.skipped.has(slot)) skippedDays.push(rating);
    }

    if (skippedDays.length < MIN_DAYS_PER_GROUP || eatenDays.length < MIN_DAYS_PER_GROUP) continue;

    const skippedAvg = average(skippedDays);
    const eatenAvg = average(eatenDays);
    const diff = Math.abs(skippedAvg - eatenAvg);
    if (diff <= MIN_FELT_DIFFERENCE) continue;
    if (best && diff <= best.diff) continue;

    const words = SLOT_WORDS[slot];
    best = {
      diff,
      insight: {
        // Two numbers and nothing else. No "dlatego", no "spróbuj".
        text: `W dni, gdy pomijasz ${words.skip}, oceniasz swoją energię średnio na ${fmtFelt(skippedAvg)}. Gdy ${words.pronoun} jesz, na ${fmtFelt(eatenAvg)}.`,
        kind: "dependency",
      },
    };
  }

  return best?.insight ?? null;
}

/**
 * Felt ratings and meal facts for the same window the trend covers.
 * Both tables key days as UTC midnight (`@db.Date`), so the string keys line up.
 */
async function loadSkippedMealInsight(userId: string, span: number): Promise<EnergyInsight | null> {
  const to = dateKeyToDate(polishDateKey());
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (span - 1));

  const [entries, logs] = await Promise.all([
    prisma.energyEntry.findMany({
      where: { userId, date: { gte: from, lte: to }, feltEnergy: { not: null } },
      select: { date: true, feltEnergy: true },
    }),
    prisma.dailyLog.findMany({
      where: { userId, date: { gte: from, lte: to } },
      select: { date: true, meals: { select: { slot: true, skipped: true } } },
    }),
  ]);

  const felt = new Map<string, number>();
  for (const e of entries) {
    if (typeof e.feltEnergy === "number") felt.set(dateToDateKey(e.date), e.feltEnergy);
  }
  if (felt.size === 0) return null;

  const facts = new Map<string, DayMealFacts>();
  for (const log of logs) {
    const day: DayMealFacts = { skipped: new Set(), eaten: new Set() };
    for (const m of log.meals) {
      if (!m.slot) continue; // rows written before slots existed say nothing
      if (m.skipped) day.skipped.add(m.slot);
      else day.eaten.add(m.slot);
    }
    facts.set(dateToDateKey(log.date), day);
  }

  return computeSkippedMealInsight(felt, facts);
}

/**
 * GET /api/energy/trend?days=30
 *
 * Reads the cached `score` of each EnergyEntry, so 30 days cost one query instead of
 * 30 rebuilds. `insights` are computed, never generated by AI: a pillar shows up only
 * when it differs by more than 20 percentage points between bad days (felt <= 5) and
 * good ones (felt >= 8), and only after 5 rated days. On top of that, at most one
 * sentence compares felt energy on days a meal was skipped against days it was eaten.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const raw = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAYS;
  // Same clamp buildEnergyTrend applies, so both halves look at the same window.
  const span = Math.max(1, Math.min(365, Math.round(days)));

  try {
    const trend: EnergyTrendView = await buildEnergyTrend(userId, span);

    let mealInsight: EnergyInsight | null = null;
    try {
      mealInsight = await loadSkippedMealInsight(userId, span);
    } catch (err) {
      // An extra sentence is never worth failing the whole chart over.
      console.warn("[api/energy/trend] wniosek o pominietych posilkach pominiety:", err);
    }

    if (!mealInsight) return NextResponse.json(trend);

    const insights = [...trend.insights, mealInsight];
    return NextResponse.json({
      ...trend,
      insights,
      // `note` explains why the list is empty; it no longer is.
      note: null,
    });
  } catch (err) {
    console.error("[api/energy/trend] GET nie powiodlo sie:", err);
    // An empty but valid shape beats an error screen on a chart the user just opened.
    return NextResponse.json({
      days: [],
      averages: { total: 0, pillars: {} },
      weakest: null,
      insights: [],
      note: "Nie udało się wczytać trendu. Spróbuj ponownie za chwilę.",
    });
  }
}
