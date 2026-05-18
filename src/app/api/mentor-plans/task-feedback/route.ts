import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

interface PlanTask {
  title: string;
  description?: string;
  frequency?: string;
  done?: boolean;
  feedback?: string;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { planId?: string; taskIndex?: number; feedback?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const planId = typeof body.planId === "string" ? body.planId.trim() : "";
  const taskIndex = typeof body.taskIndex === "number" ? body.taskIndex : NaN;
  const feedbackRaw = typeof body.feedback === "string" ? body.feedback : "";

  if (!planId) {
    return NextResponse.json({ error: "planId required" }, { status: 400 });
  }
  if (!Number.isFinite(taskIndex) || taskIndex < 0) {
    return NextResponse.json({ error: "taskIndex required" }, { status: 400 });
  }

  const plan = await prisma.mentorPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== session.user.id) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const tasks = Array.isArray(plan.tasks) ? (plan.tasks as unknown as PlanTask[]) : [];
  if (taskIndex >= tasks.length) {
    return NextResponse.json({ error: "Invalid taskIndex" }, { status: 400 });
  }

  const trimmed = feedbackRaw.trim();
  const newTasks = tasks.map((t, i) => {
    if (i !== taskIndex) return t;
    if (trimmed.length === 0) {
      // Clear feedback when user submits empty string
      const { feedback: _omit, ...rest } = t;
      void _omit;
      return rest;
    }
    return { ...t, feedback: trimmed };
  });

  const updated = await prisma.mentorPlan.update({
    where: { id: planId },
    data: { tasks: newTasks as unknown as object },
    include: {
      mentor: { select: { id: true, name: true, avatarEmoji: true, role: true } },
    },
  });

  return NextResponse.json(updated);
}
