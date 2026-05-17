import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

function todayUTCDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function addDaysUTC(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = todayUTCDate();
  const last7Start = addDaysUTC(today, -6); // 7 days inclusive
  const last30Start = addDaysUTC(today, -29); // 30 days inclusive

  const habits = await prisma.habit.findMany({
    where: { userId: session.user.id, active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  if (habits.length === 0) {
    return NextResponse.json({ habits: [] });
  }

  const habitIds = habits.map((h) => h.id);

  // Pull only last-30-day completions (covers last7 + streak base + 30d%)
  const completions = await prisma.habitCompletion.findMany({
    where: {
      userId: session.user.id,
      habitId: { in: habitIds },
      date: { gte: last30Start, lte: today },
      completed: true,
    },
    select: { habitId: true, date: true },
  });

  // Build per-habit set of completion date keys for last 30 days
  const byHabit = new Map<string, Set<string>>();
  for (const id of habitIds) byHabit.set(id, new Set());
  for (const c of completions) {
    byHabit.get(c.habitId)?.add(dateKey(c.date));
  }

  // For streak calculation we may need to look back further than 30 days
  // Pull older completions only if needed (cap at 365 days back)
  // To keep simple: fetch up to 365 days for habits whose 30-day streak hits start
  const habitsNeedingDeepStreak: string[] = [];
  const last7Days: Record<string, boolean[]> = {};
  const completionRate30d: Record<string, number> = {};
  const streakBase: Record<string, number> = {};

  for (const habit of habits) {
    const set = byHabit.get(habit.id) ?? new Set<string>();

    // last 7 days: from oldest to newest
    const days: boolean[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = addDaysUTC(today, -i);
      days.push(set.has(dateKey(d)));
    }
    last7Days[habit.id] = days;

    // 30d completion rate
    let count30 = 0;
    for (let i = 29; i >= 0; i--) {
      const d = addDaysUTC(today, -i);
      if (set.has(dateKey(d))) count30++;
    }
    completionRate30d[habit.id] = Math.round((count30 / 30) * 100);

    // Streak: consecutive days ending today (or yesterday if today not done)
    // We allow streak to count from today if done today, else from yesterday backwards
    let streak = 0;
    let cursor = today;
    // If today not done, streak still counts from yesterday backwards
    if (!set.has(dateKey(cursor))) {
      cursor = addDaysUTC(cursor, -1);
    }
    let hitStartOfWindow = false;
    while (true) {
      if (cursor < last30Start) {
        hitStartOfWindow = true;
        break;
      }
      if (set.has(dateKey(cursor))) {
        streak++;
        cursor = addDaysUTC(cursor, -1);
      } else {
        break;
      }
    }
    streakBase[habit.id] = streak;
    if (hitStartOfWindow) habitsNeedingDeepStreak.push(habit.id);
  }

  // Deep streak lookup (up to 365 days) for habits whose chain extends beyond 30d window
  if (habitsNeedingDeepStreak.length > 0) {
    const deepStart = addDaysUTC(today, -364);
    const deeper = await prisma.habitCompletion.findMany({
      where: {
        userId: session.user.id,
        habitId: { in: habitsNeedingDeepStreak },
        date: { gte: deepStart, lt: last30Start },
        completed: true,
      },
      select: { habitId: true, date: true },
    });
    const deepByHabit = new Map<string, Set<string>>();
    for (const id of habitsNeedingDeepStreak) deepByHabit.set(id, new Set());
    for (const c of deeper) deepByHabit.get(c.habitId)?.add(dateKey(c.date));

    for (const habitId of habitsNeedingDeepStreak) {
      const set30 = byHabit.get(habitId) ?? new Set<string>();
      const deepSet = deepByHabit.get(habitId) ?? new Set<string>();
      const has = (k: string) => set30.has(k) || deepSet.has(k);

      let cursor = today;
      if (!has(dateKey(cursor))) cursor = addDaysUTC(cursor, -1);
      let streak = 0;
      while (cursor >= deepStart) {
        if (has(dateKey(cursor))) {
          streak++;
          cursor = addDaysUTC(cursor, -1);
        } else {
          break;
        }
      }
      streakBase[habitId] = streak;
    }
  }

  return NextResponse.json({
    habits: habits.map((h) => ({
      id: h.id,
      name: h.name,
      last7Days: last7Days[h.id],
      streak: streakBase[h.id],
      completionRate30d: completionRate30d[h.id],
    })),
  });
}
