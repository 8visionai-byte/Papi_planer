import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { milestoneId } = await req.json();
  if (!milestoneId) {
    return NextResponse.json({ error: "milestoneId required" }, { status: 400 });
  }

  const milestone = await prisma.goalMilestone.findUnique({
    where: { id: milestoneId },
    include: { goal: { select: { userId: true, id: true, status: true } } },
  });

  if (!milestone || milestone.goal.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.goalMilestone.update({
    where: { id: milestoneId },
    data: { completed: !milestone.completed },
  });

  const allMilestones = await prisma.goalMilestone.findMany({
    where: { goalId: milestone.goal.id },
  });
  const total = allMilestones.length;
  const done = allMilestones.filter((m) => (m.id === milestoneId ? updated.completed : m.completed)).length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  // Milestones derive PROGRESS, never STATUS.
  //
  // The old code flipped the goal to "completed" at 100% and back to "active"
  // below it. That second half was the bug behind the whole close-a-goal
  // request: un-ticking one box on a goal the user had already finished
  // resurrected it, and it started showing up in the day plan again. Closing a
  // goal is now an explicit decision (PATCH /api/goals with status), so this
  // route only ever writes the number.
  await prisma.goal.update({
    where: { id: milestone.goal.id },
    data: { progress },
  });

  return NextResponse.json({
    milestone: updated,
    goalProgress: progress,
    // Returned so the client stops guessing the status from the percentage.
    goalStatus: milestone.goal.status,
  });
}
