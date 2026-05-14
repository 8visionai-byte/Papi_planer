import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 403 });
  }

  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalDailyLogs,
      totalActivities,
      totalBriefings,
      totalRoundTables,
      totalFiles,
      recentLogs,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.dailyLog.count(),
      prisma.activity.count(),
      prisma.briefing.count(),
      prisma.roundTableSession.count(),
      prisma.userFile.count(),
      prisma.dailyLog.findMany({
        where: { date: { gte: sevenDaysAgo } },
        select: { date: true },
        orderBy: { date: "asc" },
      }),
    ]);

    // Group recent logs by day
    const logsPerDay: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      logsPerDay[key] = 0;
    }
    for (const log of recentLogs) {
      const key = log.date.toISOString().slice(0, 10);
      if (key in logsPerDay) {
        logsPerDay[key]++;
      }
    }

    return NextResponse.json({
      totalUsers,
      totalDailyLogs,
      totalActivities,
      totalBriefings,
      totalRoundTables,
      totalFiles,
      last7Days: Object.entries(logsPerDay).map(([date, count]) => ({ date, count })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
