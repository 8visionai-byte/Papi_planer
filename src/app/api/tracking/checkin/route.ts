import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import {
  startOfISOWeek,
  endOfISOWeek,
  getISOWeek,
  getISOWeekYear,
  startOfDay,
} from "date-fns";

function currentWeekNumber(): number {
  const now = new Date();
  // Combine year + ISO week to get a unique number
  return getISOWeekYear(now) * 100 + getISOWeek(now);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const weekNumber = currentWeekNumber();
  const checkin = await prisma.weeklyCheckin.findUnique({
    where: {
      userId_weekNumber: {
        userId: session.user.id,
        weekNumber,
      },
    },
  });

  return NextResponse.json({ checkin: checkin ?? null });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const body = await req.json();
  const { weight, wins, fails } = body;
  const weekNumber = currentWeekNumber();
  const now = new Date();
  const weekStart = startOfISOWeek(now);
  const weekEnd = endOfISOWeek(now);

  // Auto-calculate energyAvg from DailyLogs this week
  const weekLogs = await prisma.dailyLog.findMany({
    where: {
      userId,
      date: { gte: weekStart, lte: weekEnd },
    },
    include: {
      activities: {
        select: { completed: true, lifeAreaId: true },
      },
    },
  });

  const withEnergy = weekLogs.filter((l) => l.energy != null);
  const energyAvg =
    withEnergy.length > 0
      ? Math.round(
          (withEnergy.reduce((s, l) => s + l.energy!, 0) / withEnergy.length) *
            10
        ) / 10
      : null;

  // Area stats: completion per LifeArea
  const areaMap: Record<string, { total: number; completed: number }> = {};
  for (const log of weekLogs) {
    for (const act of log.activities) {
      const areaId = act.lifeAreaId ?? "unknown";
      if (!areaMap[areaId]) areaMap[areaId] = { total: 0, completed: 0 };
      areaMap[areaId].total++;
      if (act.completed) areaMap[areaId].completed++;
    }
  }

  const areaStats = Object.entries(areaMap).map(([areaId, stats]) => ({
    areaId,
    total: stats.total,
    completed: stats.completed,
    rate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
  }));

  const checkin = await prisma.weeklyCheckin.upsert({
    where: {
      userId_weekNumber: { userId, weekNumber },
    },
    create: {
      userId,
      weekNumber,
      date: startOfDay(now),
      weight: weight ?? null,
      wins: wins ?? null,
      fails: fails ?? null,
      energyAvg,
      areaStats: areaStats.length > 0 ? areaStats : undefined,
    },
    update: {
      weight: weight ?? undefined,
      wins: wins ?? undefined,
      fails: fails ?? undefined,
      energyAvg,
      areaStats: areaStats.length > 0 ? areaStats : undefined,
    },
  });

  return NextResponse.json({ checkin });
}
