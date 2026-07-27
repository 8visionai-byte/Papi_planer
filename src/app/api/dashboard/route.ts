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
import {
  dedupeMeetingsFromPlan,
  findMeetingDuplicates,
  toMeetingLike,
  type MeetingLike,
} from "@/lib/plan/dedupe";

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
            // Read only so the view can skip meeting echoes and so the healing pass
            // below knows whether this day has already been checked.
            habitId: true,
            duplicateOfMeetingId: true,
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
  // The same meetings, in the shape the de-duplicator compares. All-day entries drop
  // out here: they cover the whole day and would swallow any same-named task.
  let meetingsForDedupe: MeetingLike[] = [];
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
      meetingsForDedupe = events
        .map(toMeetingLike)
        .filter((m): m is MeetingLike => m !== null);
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

  // A meeting from the calendar belongs in the plan once, and the row that stays is the
  // calendar one - it is the one the owner recognises as a meeting. The plan routes flag
  // the echoes at save time; this pass is what makes a plan written BEFORE that guard
  // existed clean itself up on the next open.
  //
  // Cheap on purpose: the matching is a pure in-memory loop, and a database write only
  // happens when there is genuinely something new to flag (or a dead flag to clear), so
  // on an ordinary refresh this block costs nothing.
  const allActivities = dailyLog?.activities ?? [];

  // Did the calendar actually answer? A flag written this morning is only worth
  // trusting against a calendar we could read: if the read failed we keep hiding
  // (otherwise the duplicate blinks back), if it succeeded we check the event is
  // still there. A meeting deleted in Google must not take a plan row down with it.
  const calendarOn = readShowCalendarFlag(profile?.data);
  const calendarAnswered = calendarOn && calendarError === null;
  const liveMeetingIds = new Set(meetingsForDedupe.map((m) => m.id));

  const duplicateIds =
    allActivities.length > 0 && meetingsForDedupe.length > 0
      ? findMeetingDuplicates(allActivities, meetingsForDedupe)
      : new Map<string, string>();

  /** A row the plan wrote that merely repeats a meeting the user can see anyway. */
  const isMeetingEcho = (a: (typeof allActivities)[number]): boolean => {
    if (duplicateIds.has(a.id)) return true;
    if (!a.duplicateOfMeetingId) return false;
    // Meetings are switched off in the profile: the plan row is now the only place
    // this thing appears at all, so it comes back.
    if (!calendarOn) return false;
    if (!calendarAnswered) return true;
    return liveMeetingIds.has(a.duplicateOfMeetingId);
  };

  const visibleActivities = allActivities.filter((a) => !isMeetingEcho(a));

  if (dailyLog) {
    // Persist newly found echoes. Not gated on "this day has nothing flagged yet":
    // a replan can add an echo to a day that already has one, and the helper only
    // touches rows whose flag is still null, so a second run costs one SELECT.
    const unflagged = allActivities.some((a) => duplicateIds.has(a.id) && !a.duplicateOfMeetingId);
    if (unflagged) {
      try {
        await dedupeMeetingsFromPlan(userId, dailyLog.id, meetingsForDedupe);
      } catch (dedupeErr) {
        // The view is already correct; only the persisted flag is missing.
        console.warn("[dashboard] meeting dedupe failed:", dedupeErr);
      }
    }

    // Clear a flag whose meeting no longer exists, so the row comes back everywhere
    // (briefing, statistics, AI context), not only in this response.
    const orphaned = allActivities
      .filter((a) => a.duplicateOfMeetingId && calendarAnswered && !liveMeetingIds.has(a.duplicateOfMeetingId))
      .map((a) => a.id);
    if (orphaned.length > 0) {
      try {
        await prisma.activity.updateMany({
          where: { id: { in: orphaned }, dailyLogId: dailyLog.id },
          data: { duplicateOfMeetingId: null },
        });
      } catch (clearErr) {
        console.warn("[dashboard] clearing stale meeting flags failed:", clearErr);
      }
    }
  }

  return NextResponse.json({
    briefing: briefing ?? null,
    schedule,
    activities: visibleActivities,
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
