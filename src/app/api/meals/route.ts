import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { estimateMacros } from "@/lib/ai/meal-estimator";
import { startOfDay, subDays, format } from "date-fns";

interface MealLite {
  id: string;
  time: string;
  name: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  description: string | null;
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

function sumTotals(meals: MealLite[]): DayTotals {
  return meals.reduce<DayTotals>(
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

function getTargetCalories(profileData: unknown): number {
  if (profileData && typeof profileData === "object") {
    const d = profileData as Record<string, unknown>;
    const t = d.targetCalories;
    if (typeof t === "number" && t > 0) return t;
  }
  return 2500;
}

function currentTimeHHMM(): string {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
}

// GET /api/meals               -> today's meals + totals + caloriesBurned + target
// GET /api/meals?days=7        -> last N days aggregated
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");

  // Profile for target
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  const targetCalories = getTargetCalories(profile?.data);

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
      const totals = sumTotals(log.meals as MealLite[]);
      const burned = sumCaloriesBurned(log.activities);
      return {
        date: format(log.date, "yyyy-MM-dd"),
        totals,
        caloriesBurned: burned,
        balance: burned - totals.calories,
        mealCount: log.meals.length,
      };
    });

    return NextResponse.json({ history, targetCalories });
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
  const caloriesBurned = log ? sumCaloriesBurned(log.activities) : 0;

  return NextResponse.json({
    date: format(today, "yyyy-MM-dd"),
    meals,
    totals,
    caloriesBurned,
    balance: caloriesBurned - totals.calories,
    targetCalories,
  });
}

// POST /api/meals
// Body: { name, time?, calories?, protein?, carbs?, fat?, description?, autoEstimate? }
// If autoEstimate=true, returns estimate WITHOUT saving.
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

  const today = startOfDay(new Date());
  const dailyLog = await prisma.dailyLog.upsert({
    where: { userId_date: { userId, date: today } },
    create: { userId, date: today },
    update: {},
  });

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
    },
  });

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
