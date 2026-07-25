import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { startOfDay } from "date-fns";
import { getCurrentBodyMetrics } from "@/lib/ai/body-metrics";
import {
  CalendarError,
  getCalendarEvents,
  polishDayBounds,
  type CalendarEvent,
} from "@/lib/google/calendar";

const POLISH_TIME_FMT = new Intl.DateTimeFormat("pl-PL", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Warsaw",
});

interface MeetingItem {
  id: string;
  time: string; // HH:MM local
  durationMin: number;
  name: string;
  location: string | null;
  description: string | null;
  attendees: string[];
  hangoutLink: string | null;
  allDay: boolean;
  start: string;
  end: string;
  completed: boolean;
}

function readShowCalendarFlag(profileData: unknown): boolean {
  if (!profileData || typeof profileData !== "object") return false;
  const d = profileData as Record<string, unknown>;
  return d.showCalendarInPlan === true;
}

function toMeeting(ev: CalendarEvent, completed: boolean): MeetingItem {
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  // Format time in Europe/Warsaw timezone (handles DST automatically).
  // Server may run in UTC; previously .getHours() returned UTC hours = -2h offset.
  const polishTime = ev.allDay ? "00:00" : POLISH_TIME_FMT.format(start);
  const durationMin = ev.allDay
    ? 24 * 60
    : Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
  return {
    id: ev.id,
    time: polishTime,
    durationMin: durationMin > 0 ? durationMin : 60,
    name: ev.title,
    location: ev.location ?? null,
    description: ev.description ?? null,
    attendees: ev.attendees ?? [],
    hangoutLink: ev.hangoutLink ?? null,
    allDay: ev.allDay,
    start: ev.start,
    end: ev.end,
    completed,
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const today = startOfDay(new Date());
  const dayOfWeek = new Date().getDay(); // 0=Sunday..6=Saturday

  const [briefing, schedule, dailyLog, profile] = await Promise.all([
    prisma.briefing.findUnique({
      where: { userId_date: { userId, date: today } },
      select: {
        id: true,
        content: true,
        audioUrl: true,
        phase: true,
        week: true,
        dayType: true,
      },
    }),
    prisma.schedule.findMany({
      where: { userId, dayOfWeek },
      orderBy: { time: "asc" },
      select: {
        id: true,
        time: true,
        activityName: true,
        lifeAreaId: true,
        notes: true,
      },
    }),
    prisma.dailyLog.findUnique({
      where: { userId_date: { userId, date: today } },
      include: {
        activities: {
          orderBy: { scheduledAt: "asc" },
          select: {
            id: true,
            name: true,
            type: true,
            scheduledAt: true,
            durationMin: true,
            completed: true,
            lifeAreaId: true,
            notes: true,
            metrics: true,
          },
        },
      },
    }),
    prisma.userProfile.findUnique({ where: { userId } }),
  ]);

  // BMR/TDEE from the LIVE weight (7-day average of WeightEntry), not the
  // frozen profile value. Runs after the batch above so it can reuse the
  // already-loaded profile instead of querying it twice.
  const body = await getCurrentBodyMetrics(userId, { profileData: profile?.data ?? null });
  const { bmr, tdee, bmrSoFarToday } = body;

  // Google Calendar meetings — only when user opted-in.
  let meetings: MeetingItem[] = [];
  let calendarError: string | null = null;
  if (readShowCalendarFlag(profile?.data)) {
    try {
      // Use Polish-timezone day bounds — handles DST, avoids UTC midnight drift
      const { from, to } = polishDayBounds(new Date());
      const events = await getCalendarEvents(userId, { from, to });
      // Fetch today's MeetingCompletion rows to mark which Google events
      // the user already checked off.
      const completions = await prisma.meetingCompletion.findMany({
        where: { userId, date: today },
        select: { externalId: true },
      });
      const completedSet = new Set(completions.map((c) => c.externalId));
      meetings = events.map((ev) => toMeeting(ev, completedSet.has(ev.id)));
    } catch (err) {
      if (err instanceof CalendarError) {
        calendarError = err.code;
        console.warn(
          `[dashboard] calendar fetch failed for user=${userId}: ${err.code} ${err.message}`,
        );
      } else {
        calendarError = "unknown";
        console.warn(`[dashboard] calendar fetch unexpected:`, err);
      }
    }
  }

  return NextResponse.json({
    briefing: briefing ?? null,
    schedule,
    activities: dailyLog?.activities ?? [],
    meetings,
    calendarError,
    dailyLog: dailyLog
      ? {
          id: dailyLog.id,
          energy: dailyLog.energy,
          mood: dailyLog.mood,
          sleepHours: dailyLog.sleepHours,
          sleepQuality: dailyLog.sleepQuality,
          dayType: dailyLog.dayType,
        }
      : null,
    userName: session.user.name ?? "",
    bmr,
    tdee,
    bmrSoFarToday,
    // Additive fields — existing consumers keep working.
    targetCalories: body.targetCalories,
    weight: {
      current: body.latestWeightKg,
      currentDate: body.latestWeightDate,
      avg7d: body.avg7dWeightKg,
      usedForBmr: body.weightKg,
      source: body.weightSource,
    },
  });
}
