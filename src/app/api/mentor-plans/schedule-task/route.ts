import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

interface PlanTask {
  title: string;
  description?: string;
  frequency?: string;
  done?: boolean;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId, taskIndex, date, time, durationMin } = await req.json();

  if (!planId || typeof planId !== "string") {
    return NextResponse.json({ error: "planId required" }, { status: 400 });
  }
  if (typeof taskIndex !== "number" || taskIndex < 0) {
    return NextResponse.json({ error: "taskIndex required" }, { status: 400 });
  }
  if (!date || typeof date !== "string") {
    return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (!time || typeof time !== "string") {
    return NextResponse.json({ error: "time required (HH:MM)" }, { status: 400 });
  }

  const duration = typeof durationMin === "number" && durationMin > 0 ? Math.round(durationMin) : 30;

  // Parse YYYY-MM-DD as midnight UTC for @db.Date column
  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsedDate.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  // Load plan + ownership check + mentor info for notes
  const plan = await prisma.mentorPlan.findUnique({
    where: { id: planId },
    include: { mentor: { select: { name: true } } },
  });
  if (!plan || plan.userId !== session.user.id) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const tasks = Array.isArray(plan.tasks) ? (plan.tasks as unknown as PlanTask[]) : [];
  if (taskIndex >= tasks.length) {
    return NextResponse.json({ error: "Invalid taskIndex" }, { status: 400 });
  }
  const task = tasks[taskIndex];

  // Find lifeAreaId from an active goal tied to this mentor (if exists)
  const goal = await prisma.goal.findFirst({
    where: {
      userId: session.user.id,
      mentorId: plan.mentorId,
      status: "active",
    },
    select: { lifeAreaId: true },
  });

  // Upsert DailyLog for that date
  const dailyLog = await prisma.dailyLog.upsert({
    where: { userId_date: { userId: session.user.id, date: parsedDate } },
    create: { userId: session.user.id, date: parsedDate },
    update: {},
  });

  const notes = `Z planu mentora: ${plan.mentor.name}, tydzień ${plan.weekNumber}`;

  const activity = await prisma.activity.create({
    data: {
      dailyLogId: dailyLog.id,
      lifeAreaId: goal?.lifeAreaId ?? null,
      type: "training",
      name: task.title,
      scheduledAt: time,
      durationMin: duration,
      completed: false,
      notes,
    },
  });

  return NextResponse.json({
    activityId: activity.id,
    dailyLogId: dailyLog.id,
  });
}
