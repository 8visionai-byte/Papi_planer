import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { generateMentorPlanForGoal } from "@/lib/ai/mentor-plan-generator";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { goalId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const goalId = body.goalId?.trim();
  if (!goalId) {
    return NextResponse.json({ error: "goalId jest wymagany" }, { status: 400 });
  }

  const goal = await prisma.goal.findFirst({
    where: { id: goalId, userId: session.user.id },
    select: { id: true },
  });

  if (!goal) {
    return NextResponse.json({ error: "Nie znaleziono celu" }, { status: 404 });
  }

  try {
    const result = await generateMentorPlanForGoal(goalId, session.user.id);
    if (!result) {
      return NextResponse.json(
        { error: "Brak aktywnych mentorów w systemie" },
        { status: 400 }
      );
    }
    return NextResponse.json({
      success: true,
      planCount: result.plans.length,
      mentorId: result.mentorId,
    });
  } catch (err) {
    console.error("[goals/generate-plan] generation failed", err);
    const message = err instanceof Error ? err.message : "Nie udalo sie wygenerowac planu";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
