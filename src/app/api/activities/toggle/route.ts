import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

const FOLLOW_UP_TYPES = new Set(["training", "exercise", "workout", "sport", "practice"]);

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

  const updated = await prisma.activity.update({
    where: { id: activityId },
    data: { completed: !activity.completed },
  });

  let followUp = null;

  if (updated.completed && activity.lifeAreaId && FOLLOW_UP_TYPES.has(activity.type)) {
    const mentor = await prisma.mentor.findFirst({
      where: {
        userId: session.user.id,
        active: true,
        lifeAreas: { some: { id: activity.lifeAreaId } },
      },
      select: { id: true, name: true, avatarEmoji: true, role: true },
    });

    if (mentor) {
      followUp = {
        mentorId: mentor.id,
        mentorName: mentor.name,
        mentorEmoji: mentor.avatarEmoji,
        activityName: activity.name,
        prompt: `Swietnie, ze ukonczyles "${activity.name}"! Opowiedz mi jak poszlo — czas, intensywnosc, samopoczucie?`,
      };
    }
  }

  return NextResponse.json({ activity: updated, followUp });
}
