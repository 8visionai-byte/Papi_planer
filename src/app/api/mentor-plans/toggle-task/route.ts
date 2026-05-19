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

  const { planId, taskIndex } = await req.json();

  if (!planId || typeof planId !== "string") {
    return NextResponse.json({ error: "planId required" }, { status: 400 });
  }
  if (typeof taskIndex !== "number" || taskIndex < 0) {
    return NextResponse.json({ error: "taskIndex required" }, { status: 400 });
  }

  // Ownership check
  const plan = await prisma.mentorPlan.findUnique({
    where: { id: planId },
  });
  if (!plan || plan.userId !== session.user.id) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const tasks = Array.isArray(plan.tasks) ? (plan.tasks as unknown as PlanTask[]) : [];
  if (taskIndex >= tasks.length) {
    return NextResponse.json({ error: "Invalid taskIndex" }, { status: 400 });
  }

  // Toggle done flag
  const newTasks = tasks.map((t, i) =>
    i === taskIndex ? { ...t, done: !t.done } : t
  );
  const taskDone = !!newTasks[taskIndex].done;

  await prisma.mentorPlan.update({
    where: { id: planId },
    data: { tasks: newTasks as unknown as object },
  });

  // Recompute goal progress.
  // Prefer per-goal scoping (modern plans have goalId). Fall back to mentor-wide.
  const allPlans = plan.goalId
    ? await prisma.mentorPlan.findMany({
        where: { goalId: plan.goalId, userId: session.user.id },
      })
    : await prisma.mentorPlan.findMany({
        where: {
          mentorId: plan.mentorId,
          userId: session.user.id,
          goalId: null,
        },
      });

  let totalTasks = 0;
  let doneTasks = 0;
  for (const p of allPlans) {
    const ts = Array.isArray(p.tasks) ? (p.tasks as unknown as PlanTask[]) : [];
    totalTasks += ts.length;
    doneTasks += ts.filter((t) => t.done).length;
  }
  const goalProgress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // Resolve the goal we should update:
  //  - if plan has goalId, use it directly
  //  - else fall back to first active goal for this mentor (legacy)
  const goal = plan.goalId
    ? await prisma.goal.findFirst({
        where: { id: plan.goalId, userId: session.user.id },
      })
    : await prisma.goal.findFirst({
        where: {
          userId: session.user.id,
          mentorId: plan.mentorId,
          status: "active",
        },
      });

  if (goal) {
    await prisma.goal.update({
      where: { id: goal.id },
      data: {
        progress: goalProgress,
        ...(goalProgress === 100 ? { status: "completed" } : {}),
      },
    });
  }

  return NextResponse.json({
    taskDone,
    goalProgress,
    goalId: goal?.id ?? null,
  });
}
