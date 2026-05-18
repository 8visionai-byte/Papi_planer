import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { startOfDay } from "date-fns";
import { generateDayPlan } from "@/lib/ai/plan-generator";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  let userContext: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.userContext === "string") {
      const trimmed = body.userContext.trim();
      userContext = trimmed || undefined;
    }
  } catch {
    // body optional
  }

  const today = startOfDay(new Date());

  try {
    // Upsert today's DailyLog
    const dailyLog = await prisma.dailyLog.upsert({
      where: { userId_date: { userId, date: today } },
      update: {},
      create: { userId, date: today },
    });

    // Load current activities, split completed vs uncompleted
    const allToday = await prisma.activity.findMany({
      where: { dailyLogId: dailyLog.id },
      select: { id: true, completed: true },
    });
    const completedCount = allToday.filter((a) => a.completed).length;
    const uncompletedIds = allToday
      .filter((a) => !a.completed)
      .map((a) => a.id);

    // Generate via AI with preserveCompleted context
    const generated = await generateDayPlan(userId, {
      mode: "replan",
      preserveCompleted: true,
      userContext,
    });

    if (generated.length === 0) {
      return NextResponse.json(
        { error: "AI nie wygenerowal aktywnosci. Sprobuj ponownie." },
        { status: 500 }
      );
    }

    // Delete ONLY uncompleted activities
    if (uncompletedIds.length > 0) {
      await prisma.activity.deleteMany({
        where: { id: { in: uncompletedIds } },
      });
    }

    // Create new activities from generator result
    await prisma.activity.createMany({
      data: generated.map((a) => ({
        dailyLogId: dailyLog.id,
        name: a.name,
        type: a.type,
        scheduledAt: a.scheduledAt,
        durationMin: a.durationMin,
        notes: a.notes,
        lifeAreaId: a.lifeAreaId,
        completed: false,
      })),
    });

    return NextResponse.json({
      success: true,
      kept: completedCount,
      generated: generated.length,
      mode: "replan",
    });
  } catch (err) {
    console.error("[plan/replan] error:", err);
    const message =
      err instanceof Error ? err.message : "Blad przeplanowania";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
