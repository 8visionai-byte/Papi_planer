import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { generateActivityPlan } from "@/lib/ai/activity-planner";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { activityId } = await req.json();
  if (!activityId || typeof activityId !== "string") {
    return NextResponse.json({ error: "activityId required" }, { status: 400 });
  }

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: { dailyLog: { select: { userId: true } } },
  });

  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  if (activity.dailyLog.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!activity.lifeAreaId) {
    return NextResponse.json({ error: "No mentor assigned" }, { status: 400 });
  }

  const mentor = await prisma.mentor.findFirst({
    where: {
      userId: session.user.id,
      active: true,
      lifeAreas: { some: { id: activity.lifeAreaId } },
    },
    select: { name: true },
  });

  if (!mentor) {
    return NextResponse.json({ error: "No mentor assigned" }, { status: 400 });
  }

  try {
    const notes = await generateActivityPlan(activityId, session.user.id);
    if (!notes) {
      return NextResponse.json({ error: "Plan generation failed" }, { status: 500 });
    }

    await prisma.activity.update({
      where: { id: activityId },
      data: { notes },
    });

    return NextResponse.json({ notes, mentorName: mentor.name });
  } catch (err) {
    console.error("generate-plan error:", err);
    return NextResponse.json({ error: "Generation error" }, { status: 500 });
  }
}
