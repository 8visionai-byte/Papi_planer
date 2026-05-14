import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { startOfDay } from "date-fns";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const today = startOfDay(new Date());
  const dayOfWeek = new Date().getDay();

  // Check if DailyLog already exists
  const existing = await prisma.dailyLog.findUnique({
    where: { userId_date: { userId, date: today } },
  });

  if (existing) {
    return NextResponse.json({ message: "Already initialized", dailyLogId: existing.id });
  }

  // Get today's schedule items
  const scheduleItems = await prisma.schedule.findMany({
    where: { userId, dayOfWeek },
    orderBy: { time: "asc" },
  });

  // Create DailyLog with activities from schedule
  const dailyLog = await prisma.dailyLog.create({
    data: {
      userId,
      date: today,
      activities: {
        create: scheduleItems.map((item) => ({
          name: item.activityName,
          type: "scheduled",
          scheduledAt: item.time,
          lifeAreaId: item.lifeAreaId,
          completed: false,
          notes: item.notes,
        })),
      },
    },
    include: {
      activities: {
        orderBy: { scheduledAt: "asc" },
      },
    },
  });

  return NextResponse.json({
    message: "Initialized",
    dailyLogId: dailyLog.id,
    activities: dailyLog.activities,
  });
}
