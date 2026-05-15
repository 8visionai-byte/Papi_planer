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
    include: { goal: { select: { userId: true, id: true } } },
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

  await prisma.goal.update({
    where: { id: milestone.goal.id },
    data: {
      progress,
      ...(progress === 100 ? { status: "completed" } : { status: "active" }),
    },
  });

  return NextResponse.json({ milestone: updated, goalProgress: progress });
}
