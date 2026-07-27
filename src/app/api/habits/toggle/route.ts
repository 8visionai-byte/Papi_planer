import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { habitDayCandidates, polishDayDate } from "@/lib/habits/link";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { habitId } = await req.json();
  if (!habitId) {
    return NextResponse.json({ error: "habitId required" }, { status: 400 });
  }

  const habit = await prisma.habit.findUnique({
    where: { id: habitId },
    select: { id: true, userId: true },
  });
  if (!habit || habit.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // The Polish calendar day, not the container's UTC day: `HabitCompletion.date` is a
  // `@db.Date` column and the server clock is UTC, so a tick at 23:30 in Warsaw has to
  // land on today and not roll over into the next date.
  const date = polishDayDate();
  const existing = await prisma.habitCompletion.findUnique({
    where: { habitId_date: { habitId, date } },
  });

  const completed = existing ? !existing.completed : true;

  // Upsert, not create: two fast taps used to race into two inserts on the same
  // [habitId, date]. With the unique key the second one now updates instead of failing.
  await prisma.habitCompletion.upsert({
    where: { habitId_date: { habitId, date } },
    update: { completed },
    create: {
      habitId,
      userId: session.user.id,
      date,
      completed,
    },
  });

  // ---- Day-plan mirror ----
  // "Poranna Vipassana" ticked here is the same act as the identical line in the day
  // plan, so every activity linked to this habit follows, in both directions. The link
  // itself was decided once, when the plan was written (Activity.habitId).
  // `null` = the mirror did not run, so the caller cannot trust its copy of the plan
  // and has to re-read it. `[]` = it ran and this habit simply has no plan row today.
  let activities: Array<{
    id: string;
    name: string;
    scheduledAt: string | null;
    completed: boolean;
  }> | null = [];
  try {
    const rows = await prisma.activity.findMany({
      where: {
        habitId,
        // Ownership is enforced through the log, so no foreign day plan can be touched.
        dailyLog: { userId: session.user.id, date: { in: habitDayCandidates() } },
      },
      select: { id: true, name: true, scheduledAt: true, completed: true },
    });

    const stale = rows.filter((r) => r.completed !== completed).map((r) => r.id);
    if (stale.length > 0) {
      await prisma.activity.updateMany({
        where: { id: { in: stale } },
        data: { completed },
      });
    }

    activities = rows.map((r) => ({
      id: r.id,
      name: r.name,
      scheduledAt: r.scheduledAt,
      completed,
    }));
  } catch {
    // A failed mirror must never lose the habit tick itself. Reporting `null` instead of
    // an empty list is what makes the screen re-read the plan rather than believe a
    // sync that did not happen.
    activities = null;
  }

  // `activities` lets the plan screen patch just those rows instead of refetching.
  return NextResponse.json({ completed, activities });
}
