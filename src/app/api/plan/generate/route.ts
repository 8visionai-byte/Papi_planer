import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { startOfDay } from "date-fns";
import { generateDayPlan } from "@/lib/ai/plan-generator";
import { linkActivitiesToHabits } from "@/lib/habits/link";
import { dedupeMeetingsFromPlan, loadTodayMeetings } from "@/lib/plan/dedupe";

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

    // Generate activities via AI
    const generated = await generateDayPlan(userId, {
      mode: "full",
      userContext,
    });

    if (generated.length === 0) {
      return NextResponse.json(
        { error: "AI nie wygenerowal aktywnosci. Sprobuj ponownie." },
        { status: 500 }
      );
    }

    // Full regenerate: delete all existing activities for today
    await prisma.activity.deleteMany({
      where: { dailyLogId: dailyLog.id },
    });

    // Create new activities
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

    // Decide once, here, which of today's tasks ARE habits and store it in
    // Activity.habitId. Doing it at save time (instead of guessing on every read)
    // is what makes one tick in the plan tick the habit too, and the other way round.
    let linkedHabits = 0;
    try {
      linkedHabits = await linkActivitiesToHabits(userId, dailyLog.id);
    } catch (linkErr) {
      // A failed link costs one extra tap, a failed plan costs the whole morning.
      console.error("[plan/generate] habit link failed:", linkErr);
    }

    // The prompt tells the mentors not to schedule anything inside meeting hours, and
    // they still write the meeting out as a task so the day "looks complete". Flag those
    // echoes here, right after the plan is saved, so the calendar row is the only one the
    // owner sees. Same read of the calendar the generator did a moment ago.
    let hiddenMeetingCopies = 0;
    try {
      const meetings = await loadTodayMeetings(userId);
      if (meetings.length > 0) {
        hiddenMeetingCopies = await dedupeMeetingsFromPlan(
          userId,
          dailyLog.id,
          meetings
        );
      }
    } catch (dedupeErr) {
      // A duplicated row is untidy, a lost plan is a lost morning.
      console.error("[plan/generate] meeting dedupe failed:", dedupeErr);
    }

    return NextResponse.json({
      success: true,
      activities: generated.length,
      linkedHabits,
      hiddenMeetingCopies,
      mode: "full",
    });
  } catch (err) {
    console.error("[plan/generate] error:", err);
    const message =
      err instanceof Error ? err.message : "Blad generowania planu";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
