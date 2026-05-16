import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { startOfDay } from "date-fns";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const today = startOfDay(new Date());
  const dayOfWeek = new Date().getDay(); // 0=Sunday..6=Saturday

  const [briefing, schedule, dailyLog] = await Promise.all([
    prisma.briefing.findUnique({
      where: { userId_date: { userId, date: today } },
      select: {
        id: true,
        content: true,
        audioUrl: true,
        phase: true,
        week: true,
        dayType: true,
      },
    }),
    prisma.schedule.findMany({
      where: { userId, dayOfWeek },
      orderBy: { time: "asc" },
      select: {
        id: true,
        time: true,
        activityName: true,
        lifeAreaId: true,
        notes: true,
      },
    }),
    prisma.dailyLog.findUnique({
      where: { userId_date: { userId, date: today } },
      include: {
        activities: {
          orderBy: { scheduledAt: "asc" },
          select: {
            id: true,
            name: true,
            type: true,
            scheduledAt: true,
            durationMin: true,
            completed: true,
            lifeAreaId: true,
            notes: true,
            metrics: true,
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    briefing: briefing ?? null,
    schedule,
    activities: dailyLog?.activities ?? [],
    dailyLog: dailyLog
      ? {
          id: dailyLog.id,
          energy: dailyLog.energy,
          mood: dailyLog.mood,
          sleepHours: dailyLog.sleepHours,
          sleepQuality: dailyLog.sleepQuality,
          dayType: dailyLog.dayType,
        }
      : null,
    userName: session.user.name ?? "",
  });
}
