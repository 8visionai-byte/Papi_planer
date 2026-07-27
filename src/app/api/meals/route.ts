import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { estimateMacros } from "@/lib/ai/meal-estimator";
import { getBmrSoFarToday } from "@/lib/ai/bmr-calculator";
import { getCurrentBodyMetrics } from "@/lib/ai/body-metrics";
import { startOfDay, subDays, format, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";

interface MealLite {
  id: string;
  time: string;
  name: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  description: string | null;
  /** "sniadanie" | "obiad" | "kolacja" | "przekaska". Null for rows written before slots. */
  slot: string | null;
  /** True = the user decided not to eat this meal. Carries 0 kcal on purpose. */
  skipped: boolean;
}

interface DayTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface ActivityMetrics {
  caloriesBurned?: number | null;
}

/* ------------------------------------------------------------------ */
/*  Slots                                                              */
/*                                                                     */
/*  The owner often skips breakfast and eats a bigger dinner instead.   */
/*  A skipped meal used to look exactly like a meal nobody logged, so   */
/*  the app could never tell "nie jadlem" from "zapomnialem zapisac".   */
/*  A skipped row makes the decision visible AND keeps the daily        */
/*  balance honest, because it adds zero kcal.                          */
/* ------------------------------------------------------------------ */

const MEAL_SLOTS = ["sniadanie", "obiad", "kolacja", "przekaska"] as const;
type MealSlot = (typeof MEAL_SLOTS)[number];

function parseSlot(raw: unknown): MealSlot | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  return (MEAL_SLOTS as readonly string[]).includes(s) ? (s as MealSlot) : null;
}

const SLOT_LABEL: Record<MealSlot, string> = {
  sniadanie: "Śniadanie",
  obiad: "Obiad",
  kolacja: "Kolacja",
  przekaska: "Przekąska",
};

/**
 * A skipped meal has no real hour, but `time` drives the ordering of every list in
 * the app, so it gets the hour the slot usually falls on instead of "now".
 */
const SLOT_DEFAULT_TIME: Record<MealSlot, string> = {
  sniadanie: "08:00",
  obiad: "13:00",
  kolacja: "19:00",
  przekaska: "16:00",
};

/** Rows the user actually ate. Skipped rows are decisions, not food. */
function eatenOnly(meals: MealLite[]): MealLite[] {
  return meals.filter((m) => !m.skipped);
}

function sumTotals(meals: MealLite[]): DayTotals {
  // Skipped rows are stored with zeros, but they are filtered out anyway: the sum
  // must stay correct even if an older row was saved before that rule existed.
  return eatenOnly(meals).reduce<DayTotals>(
    (acc, m) => ({
      calories: acc.calories + (m.calories ?? 0),
      protein: acc.protein + (m.protein ?? 0),
      carbs: acc.carbs + (m.carbs ?? 0),
      fat: acc.fat + (m.fat ?? 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

function sumCaloriesBurned(activities: { metrics: unknown }[]): number {
  let total = 0;
  for (const a of activities) {
    const m = a.metrics as ActivityMetrics | null | undefined;
    if (m && typeof m === "object" && typeof m.caloriesBurned === "number") {
      total += m.caloriesBurned;
    }
  }
  return total;
}

function currentTimeHHMM(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
}

// GET /api/meals               -> today's meals + totals + caloriesBurned + target
// GET /api/meals?days=7        -> last N days aggregated
// Every meal row carries `slot` and `skipped`; all calorie sums ignore skipped rows.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  const monthParam = url.searchParams.get("month"); // YYYY-MM

  // BMR / TDEE / target from the LIVE weight (7-day average of WeightEntry),
  // not the frozen UserProfile.data.weightKg.
  const body = await getCurrentBodyMetrics(userId);
  const { bmr, tdee, targetCalories } = body;

  // Month view: all days of a given month
  if (monthParam) {
    const match = /^(\d{4})-(\d{1,2})$/.exec(monthParam);
    if (!match) {
      return NextResponse.json({ error: "Invalid month format (YYYY-MM)" }, { status: 400 });
    }
    const year = parseInt(match[1], 10);
    const monthIdx = parseInt(match[2], 10) - 1;
    if (monthIdx < 0 || monthIdx > 11) {
      return NextResponse.json({ error: "Invalid month" }, { status: 400 });
    }
    const monthStart = startOfMonth(new Date(year, monthIdx, 1));
    const monthEnd = endOfMonth(monthStart);
    const todayStart = startOfDay(new Date());

    const logs = await prisma.dailyLog.findMany({
      where: { userId, date: { gte: monthStart, lte: monthEnd } },
      orderBy: { date: "asc" },
      include: {
        meals: { orderBy: { time: "asc" } },
        activities: { select: { metrics: true } },
      },
    });

    const byDate = new Map<string, (typeof logs)[number]>();
    for (const log of logs) {
      byDate.set(format(startOfDay(log.date), "yyyy-MM-dd"), log);
    }

    const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const days = allDays.map((d) => {
      const key = format(d, "yyyy-MM-dd");
      const log = byDate.get(key);
      const meals = (log?.meals ?? []) as MealLite[];
      const totals = sumTotals(meals);
      const activitiesBurned = log ? sumCaloriesBurned(log.activities) : 0;
      const isToday = startOfDay(d).getTime() === todayStart.getTime();
      const isFuture = startOfDay(d).getTime() > todayStart.getTime();
      const bmrForDay = isFuture ? 0 : isToday ? getBmrSoFarToday(bmr) : bmr;
      const caloriesBurned = bmrForDay + activitiesBurned;
      const balance = totals.calories - caloriesBurned;
      return {
        date: key,
        meals,
        totals,
        activityCalories: activitiesBurned,
        bmrForDay,
        caloriesBurned,
        balance,
        // Meals eaten. A skipped row is not a meal, but it IS data about the day,
        // so it still lights the calendar dot through `hasData`.
        mealCount: eatenOnly(meals).length,
        skippedCount: meals.length - eatenOnly(meals).length,
        hasData: meals.length > 0 || activitiesBurned > 0,
        isFuture,
      };
    });

    return NextResponse.json({ month: monthParam, days, targetCalories, bmr, tdee });
  }

  if (daysParam) {
    const days = Math.max(1, Math.min(30, parseInt(daysParam, 10) || 7));
    const from = startOfDay(subDays(new Date(), days - 1));

    const logs = await prisma.dailyLog.findMany({
      where: { userId, date: { gte: from } },
      orderBy: { date: "desc" },
      include: {
        meals: true,
        activities: { select: { metrics: true } },
      },
    });

    const history = logs.map((log) => {
      const dayMeals = log.meals as MealLite[];
      const totals = sumTotals(dayMeals);
      const burned = sumCaloriesBurned(log.activities);
      // For past days use full daily BMR; for today use proportional fraction.
      const isToday = startOfDay(log.date).getTime() === startOfDay(new Date()).getTime();
      const bmrForDay = isToday ? getBmrSoFarToday(bmr) : bmr;
      return {
        date: format(log.date, "yyyy-MM-dd"),
        totals,
        caloriesBurned: burned,
        balance: totals.calories - (bmrForDay + burned),
        mealCount: eatenOnly(dayMeals).length,
        skippedCount: dayMeals.length - eatenOnly(dayMeals).length,
      };
    });

    return NextResponse.json({ history, targetCalories, bmr, tdee });
  }

  // Today
  const today = startOfDay(new Date());
  const log = await prisma.dailyLog.findUnique({
    where: { userId_date: { userId, date: today } },
    include: {
      meals: { orderBy: { time: "asc" } },
      activities: { select: { metrics: true } },
    },
  });

  const meals = (log?.meals ?? []) as MealLite[];
  const totals = sumTotals(meals);
  const activityCalories = log ? sumCaloriesBurned(log.activities) : 0;
  const activityCount = log
    ? log.activities.filter((a) => {
        const m = a.metrics as ActivityMetrics | null | undefined;
        return m && typeof m === "object" && typeof m.caloriesBurned === "number" && m.caloriesBurned > 0;
      }).length
    : 0;
  const bmrSoFarToday = getBmrSoFarToday(bmr);
  const totalBurned = bmrSoFarToday + activityCalories;

  return NextResponse.json({
    date: format(today, "yyyy-MM-dd"),
    meals,
    totals,
    // Legacy: activity calories only — kept for back-compat.
    caloriesBurned: activityCalories,
    // New explicit fields for the diet UI:
    activityCalories,
    activityCount,
    bmrSoFarToday,
    totalBurned,
    balance: totals.calories - totalBurned,
    targetCalories,
    bmr,
    tdee,
    // Additive — shows the user which weight the numbers are based on.
    weight: {
      current: body.latestWeightKg,
      currentDate: body.latestWeightDate,
      avg7d: body.avg7dWeightKg,
      usedForBmr: body.weightKg,
      source: body.weightSource,
    },
  });
}

// POST /api/meals
// Body: { name, time?, calories?, protein?, carbs?, fat?, description?, slot?, skipped?, autoEstimate? }
// If autoEstimate=true, returns estimate WITHOUT saving.
// If skipped=true, `slot` is required and the row is saved with zeros instead of food.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const autoEstimate = body.autoEstimate === true;
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (autoEstimate) {
    const source = description || name;
    if (!source) {
      return NextResponse.json({ error: "Opis lub nazwa wymagane" }, { status: 400 });
    }
    try {
      const estimate = await estimateMacros(source);
      return NextResponse.json({ estimate });
    } catch (err) {
      console.error("[meals] estimate failed", err);
      const msg = err instanceof Error ? err.message : "Oszacowanie nie powiodło się";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const slot = parseSlot(body.slot);
  const skipped = body.skipped === true;

  const today = startOfDay(new Date());

  /* ---------------- "nie jadłem" ---------------- */

  if (skipped) {
    // Only the three fixed meals can be skipped. A skipped snack has nowhere to
    // render (the diet screen lists snacks, it has no empty snack slot), so the row
    // would be invisible while its `deleteMany` below silently removed a real snack.
    if (!slot || slot === "przekaska") {
      return NextResponse.json(
        { error: "Pominąć można śniadanie, obiad albo kolację" },
        { status: 400 }
      );
    }

    const dailyLog = await prisma.dailyLog.upsert({
      where: { userId_date: { userId, date: today } },
      create: { userId, date: today },
      update: {},
    });

    // The user changed his mind: whatever stood in this slot (a logged meal or an
    // older skip) is replaced, so one slot never holds two contradictory answers.
    await prisma.meal.deleteMany({ where: { dailyLogId: dailyLog.id, slot } });

    const meal = await prisma.meal.create({
      data: {
        dailyLogId: dailyLog.id,
        time: typeof body.time === "string" && body.time ? body.time : SLOT_DEFAULT_TIME[slot],
        name: SLOT_LABEL[slot],
        // Zeros, not nulls: the day's balance has to add up, and the correlation in
        // /api/energy/trend counts this row as a real, deliberate zero.
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        description: null,
        slot,
        skipped: true,
      },
    });

    return NextResponse.json({ meal });
  }

  /* ---------------- a meal that was eaten ---------------- */

  if (!name) {
    return NextResponse.json({ error: "Nazwa jest wymagana" }, { status: 400 });
  }

  const time = typeof body.time === "string" && body.time ? body.time : currentTimeHHMM();
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };
  const calories = num(body.calories);
  const protein = num(body.protein);
  const carbs = num(body.carbs);
  const fat = num(body.fat);

  const dailyLog = await prisma.dailyLog.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, date: today },
    update: {},
  });

  // The other direction of the same rule: he marked the slot as skipped earlier and
  // ate after all. Only the skip goes away; a second real meal in one slot is fine.
  if (slot) {
    await prisma.meal.deleteMany({ where: { dailyLogId: dailyLog.id, slot, skipped: true } });
  }

  const meal = await prisma.meal.create({
    data: {
      dailyLogId: dailyLog.id,
      time,
      name,
      calories: calories !== null ? Math.round(calories) : null,
      protein,
      carbs,
      fat,
      description: description || null,
      slot,
      skipped: false,
    },
  });

  return NextResponse.json({ meal });
}

// PATCH /api/meals
// Body: { id, name?, time?, calories?, protein?, carbs?, fat?, description?, slot? }
// Only the fields present in the body are touched, so the edit sheet can send a subset.
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const existing = await prisma.meal.findUnique({
    where: { id },
    include: { dailyLog: { select: { id: true, userId: true } } },
  });
  if (!existing || existing.dailyLog.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };

  const data: Record<string, unknown> = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Nazwa jest wymagana" }, { status: 400 });
    data.name = name;
  }
  if (typeof body.time === "string" && body.time) data.time = body.time;
  if (body.description !== undefined) {
    const d = typeof body.description === "string" ? body.description.trim() : "";
    data.description = d || null;
  }
  if (body.calories !== undefined) {
    const c = num(body.calories);
    data.calories = c !== null ? Math.round(c) : null;
  }
  if (body.protein !== undefined) data.protein = num(body.protein);
  if (body.carbs !== undefined) data.carbs = num(body.carbs);
  if (body.fat !== undefined) data.fat = num(body.fat);

  let movedToSlot: MealSlot | null = null;
  if (body.slot !== undefined) {
    movedToSlot = parseSlot(body.slot);
    data.slot = movedToSlot;
  }

  // Moving a real meal into a slot that is marked as skipped resolves the same
  // contradiction as POST does: the skip loses, because he ate.
  if (movedToSlot && !existing.skipped) {
    await prisma.meal.deleteMany({
      where: { dailyLogId: existing.dailyLog.id, slot: movedToSlot, skipped: true },
    });
  }

  const meal = await prisma.meal.update({ where: { id }, data });
  return NextResponse.json({ meal });
}

// DELETE /api/meals  body: { id }
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = body.id;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const existing = await prisma.meal.findUnique({
    where: { id },
    include: { dailyLog: { select: { userId: true } } },
  });
  if (!existing || existing.dailyLog.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.meal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
