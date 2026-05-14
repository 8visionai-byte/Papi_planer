import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { subDays, startOfDay, format } from "date-fns";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const range = parseInt(req.nextUrl.searchParams.get("range") ?? "7", 10);
  const validRange = [7, 14, 30].includes(range) ? range : 7;

  const today = startOfDay(new Date());
  const startDate = subDays(today, validRange - 1);

  const dailyLogs = await prisma.dailyLog.findMany({
    where: {
      userId,
      date: { gte: startDate, lte: today },
    },
    include: {
      activities: {
        select: { id: true, completed: true, lifeAreaId: true },
      },
    },
    orderBy: { date: "asc" },
  });

  // Build daily stats
  const dailyStats = dailyLogs.map((log) => {
    const total = log.activities.length;
    const completed = log.activities.filter((a) => a.completed).length;
    return {
      date: format(log.date, "yyyy-MM-dd"),
      energy: log.energy,
      sleepHours: log.sleepHours,
      sleepQuality: log.sleepQuality,
      mood: log.mood,
      completionRate: total > 0 ? Math.round((completed / total) * 100) / 100 : null,
    };
  });

  // Summary calculations
  const withEnergy = dailyStats.filter((d) => d.energy != null);
  const withSleep = dailyStats.filter((d) => d.sleepHours != null);
  const withCompletion = dailyStats.filter((d) => d.completionRate != null);

  const totalActivities = dailyLogs.reduce(
    (sum, log) => sum + log.activities.length,
    0
  );
  const completedActivities = dailyLogs.reduce(
    (sum, log) => sum + log.activities.filter((a) => a.completed).length,
    0
  );

  // Mood distribution
  const moodDistribution: Record<string, number> = {};
  for (const d of dailyStats) {
    if (d.mood) {
      moodDistribution[d.mood] = (moodDistribution[d.mood] ?? 0) + 1;
    }
  }

  const summary = {
    avgEnergy:
      withEnergy.length > 0
        ? Math.round(
            (withEnergy.reduce((s, d) => s + d.energy!, 0) / withEnergy.length) *
              10
          ) / 10
        : null,
    avgSleep:
      withSleep.length > 0
        ? Math.round(
            (withSleep.reduce((s, d) => s + d.sleepHours!, 0) /
              withSleep.length) *
              10
          ) / 10
        : null,
    avgCompletion:
      withCompletion.length > 0
        ? Math.round(
            (withCompletion.reduce((s, d) => s + d.completionRate!, 0) /
              withCompletion.length) *
              100
          ) / 100
        : null,
    totalActivities,
    completedActivities,
    moodDistribution,
  };

  return NextResponse.json({ dailyStats, summary });
}
