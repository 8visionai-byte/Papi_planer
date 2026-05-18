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

    // Load current activities. Preserve ALL past activities (before current time),
    // regardless of completion status. Only delete future uncompleted ones.
    const now = new Date();
    const nowHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const allToday = await prisma.activity.findMany({
      where: { dailyLogId: dailyLog.id },
      select: { id: true, completed: true, scheduledAt: true },
    });
    const keptCount = allToday.filter((a) => {
      // Keep: completed OR past time (already happened)
      if (a.completed) return true;
      if (a.scheduledAt && a.scheduledAt < nowHHMM) return true;
      return false;
    }).length;
    const toDeleteIds = allToday
      .filter((a) => {
        // Delete only: NOT completed AND (no scheduledAt OR future time)
        if (a.completed) return false;
        if (!a.scheduledAt) return true; // unscheduled — replan
        return a.scheduledAt >= nowHHMM;
      })
      .map((a) => a.id);

    // Generate via AI with preserveCompleted context (also informs about past activities)
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

    // Filter generated to only include activities from current time forward
    // (defensive — mentor was instructed but enforce in code too)
    const futureGenerated = generated.filter(
      (a) => a.scheduledAt >= nowHHMM
    );

    // Delete future-or-unscheduled uncompleted activities
    if (toDeleteIds.length > 0) {
      await prisma.activity.deleteMany({
        where: { id: { in: toDeleteIds } },
      });
    }

    // Create new activities from generator result (only future ones)
    await prisma.activity.createMany({
      data: futureGenerated.map((a) => ({
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
      kept: keptCount,
      generated: futureGenerated.length,
      sinceTime: nowHHMM,
      mode: "replan",
    });
  } catch (err) {
    console.error("[plan/replan] error:", err);
    const message =
      err instanceof Error ? err.message : "Blad przeplanowania";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
