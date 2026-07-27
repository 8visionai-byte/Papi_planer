/**
 * A calendar meeting belongs in the day plan ONCE.
 *
 * The plan generator already receives the day's meetings as context, together with the
 * rule "never schedule anything inside those hours". The model still writes the meeting
 * out as a plain task, because a plan that skips 11:00-12:00 without saying why looks
 * broken to it. Result on screen: "Briefing Pawel-Marcin" as an ordinary task AND, right
 * below, the same briefing as a highlighted calendar row. A prompt is a request, not a
 * guarantee, so the guard lives here, in code.
 *
 * What we keep is the CALENDAR row: it is the one the owner recognises as a meeting
 * (own colour, own end time, own completion). The echo is not deleted, only flagged
 * through `Activity.duplicateOfMeetingId`, so the history of what the plan proposed
 * stays intact and the view simply skips it.
 *
 * `normalizeTitle`, `isSameAsMeeting` and `findMeetingDuplicates` are pure - no Prisma,
 * no clock - so the rules can be checked without a database.
 */

import { prisma } from "@/lib/db/prisma";
import {
  getCalendarEvents,
  polishDayBounds,
  type CalendarEvent,
} from "@/lib/google/calendar";

/** Same formatter the plan generator and the dashboard use: Warsaw wall-clock, 24h. */
const PL_TIME_FMT = new Intl.DateTimeFormat("pl-PL", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/Warsaw",
});

/**
 * How far from the meeting start an identically named task still counts as the same
 * thing. The planner likes round numbers and lead-ins, so an 11:00 meeting shows up as
 * a 10:45 or 11:15 task. Wider than this and a morning slot would start swallowing an
 * evening one.
 */
export const MEETING_START_TOLERANCE_MIN = 15;

const MINUTES_PER_DAY = 24 * 60;

/** The part of a calendar event this module compares against. Times are Warsaw "HH:MM". */
export interface MeetingLike {
  id: string;
  title: string;
  start: string;
  end: string;
}

/** The part of an Activity this module compares. `habitId` is read only as a guard. */
export interface ActivityLike {
  name: string;
  scheduledAt?: string | null;
  habitId?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Pure comparison                                                    */
/* ------------------------------------------------------------------ */

/**
 * Lowercase, drop Polish accents, turn punctuation into spaces, squash whitespace.
 *
 * Digits survive on purpose: "Trening 1" and "Trening 2" are two different sessions,
 * and a duplicate flagged by mistake hides a task the owner never gets to see.
 */
export function normalizeTitle(s: string): string {
  if (typeof s !== "string") return "";

  return (
    s
      .toLowerCase()
      // U+0142 is a letter of its own, NFD never splits it, so it needs its own rule -
      // otherwise "Paweł" and "Pawel" stay two different strings.
      .replace(/ł/g, "l")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      // Hyphens, dots, emoji, non-breaking spaces all become plain separators:
      // "Briefing Paweł-Marcin" and "briefing pawel marcin" reach the same shape.
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ")
  );
}

/** "HH:MM" (or "HH:MM:SS") as minutes since midnight, or null when unreadable. */
function toMinutes(hhmm: string | null | undefined): number | null {
  if (typeof hhmm !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h > 24 || min > 59) return null;
  // Some ICU builds render midnight as "24:00"; both ends mean the same instant.
  return (h % 24) * 60 + min;
}

/**
 * How far the activity starts from the meeting start, in minutes, or null when the two
 * cannot be compared at all. Also used to pick the closest meeting when several match.
 */
function startDistance(activity: ActivityLike, meeting: MeetingLike): number | null {
  const actMin = toMinutes(activity?.scheduledAt);
  const startMin = toMinutes(meeting?.start);
  if (actMin === null || startMin === null) return null;
  return Math.abs(actMin - startMin);
}

/**
 * Is this plan task the same thing as this calendar meeting?
 *
 * Both halves must hold:
 *  1. identical titles after normalisation, and
 *  2. the times overlap - the task starts inside the meeting window, or within
 *     MEETING_START_TOLERANCE_MIN of its start.
 *
 * The time half is what stops "Trening" at 7:00 from being erased by a "Trening"
 * meeting at 18:00. A task with no hour set is never a duplicate: without a time there
 * is nothing to overlap, and hiding it would be a guess.
 */
export function isSameAsMeeting(activity: ActivityLike, meeting: MeetingLike): boolean {
  if (!activity || !meeting) return false;

  const a = normalizeTitle(activity.name);
  const b = normalizeTitle(meeting.title);
  // Two untitled rows are not evidence of anything.
  if (!a || !b || a !== b) return false;

  const actMin = toMinutes(activity.scheduledAt);
  const startMin = toMinutes(meeting.start);
  if (actMin === null || startMin === null) return false;

  let endMin = toMinutes(meeting.end);
  if (endMin === null) endMin = startMin;
  // A meeting running past midnight ends "earlier" on the clock than it starts.
  // Equal ends stay equal - a zero-length event has no window, only a start.
  if (endMin < startMin) endMin += MINUTES_PER_DAY;

  const insideWindow = actMin >= startMin && actMin < endMin;
  const nearStart = Math.abs(actMin - startMin) <= MEETING_START_TOLERANCE_MIN;

  return insideWindow || nearStart;
}

/**
 * Which activities are echoes of which meeting: activity id -> meeting id.
 *
 * Activities already tied to a habit are left alone. A habit is the owner's own
 * recurring commitment; hiding it would take away the tick that keeps the streak,
 * and a duplicated row costs far less than a broken habit.
 */
export function findMeetingDuplicates<T extends ActivityLike & { id: string }>(
  activities: T[],
  meetings: MeetingLike[]
): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(activities) || !Array.isArray(meetings)) return out;
  if (activities.length === 0 || meetings.length === 0) return out;

  for (const activity of activities) {
    if (!activity?.id) continue;
    if (activity.habitId) continue;

    let bestMeetingId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const meeting of meetings) {
      if (!meeting?.id) continue;
      if (!isSameAsMeeting(activity, meeting)) continue;
      // Two meetings with the same name in one day: the plan echoed the nearer one.
      const distance = startDistance(activity, meeting) ?? Number.POSITIVE_INFINITY;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMeetingId = meeting.id;
      }
    }

    if (bestMeetingId) out.set(activity.id, bestMeetingId);
  }

  return out;
}

/* ------------------------------------------------------------------ */
/*  Reading the calendar                                               */
/* ------------------------------------------------------------------ */

/**
 * Calendar event as this module compares it, or null for an all-day entry.
 *
 * All-day events are skipped exactly as the plan generator skips them: they span the
 * whole day, so any same-named task at any hour would look like an echo of them.
 */
export function toMeetingLike(ev: CalendarEvent): MeetingLike | null {
  if (!ev?.id || ev.allDay) return null;
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  return {
    id: ev.id,
    title: ev.title,
    start: PL_TIME_FMT.format(start),
    end: PL_TIME_FMT.format(end),
  };
}

/**
 * Today's meetings, read from the same place the plan generator reads them: the
 * opt-in flag on the profile, Polish day bounds, Google Calendar. One source, so the
 * plan and the de-duplicator can never be looking at two different days.
 *
 * Never throws. A calendar that will not answer means no de-duplication, not a broken
 * plan.
 */
export async function loadTodayMeetings(
  userId: string,
  now: Date = new Date()
): Promise<MeetingLike[]> {
  if (!userId) return [];

  try {
    const profile = await prisma.userProfile.findUnique({
      where: { userId },
      select: { data: true },
    });
    const showCalendar =
      !!profile?.data &&
      typeof profile.data === "object" &&
      (profile.data as Record<string, unknown>).showCalendarInPlan === true;
    if (!showCalendar) return [];

    const { from, to } = polishDayBounds(now);
    const events = await getCalendarEvents(userId, { from, to });
    return events
      .map(toMeetingLike)
      .filter((m): m is MeetingLike => m !== null);
  } catch {
    // Token expired, no connection, API down - proceed without meetings.
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Writing the flags                                                  */
/* ------------------------------------------------------------------ */

/**
 * Flag this day's plan tasks that merely repeat a calendar meeting, by writing the
 * event id into `Activity.duplicateOfMeetingId`. Returns how many rows were flagged.
 *
 * Nothing is deleted: the plan the mentors wrote stays readable in the database, the
 * view is the layer that skips the flagged rows.
 */
export async function dedupeMeetingsFromPlan(
  userId: string,
  dailyLogId: string,
  meetings: MeetingLike[]
): Promise<number> {
  if (!userId || !dailyLogId) return 0;
  if (!Array.isArray(meetings) || meetings.length === 0) return 0;

  // Ownership check: a dailyLogId from elsewhere must not be writable through here.
  const log = await prisma.dailyLog.findUnique({
    where: { id: dailyLogId },
    select: { id: true, userId: true },
  });
  if (!log || log.userId !== userId) return 0;

  const activities = await prisma.activity.findMany({
    // `duplicateOfMeetingId: null` keeps a second run a no-op instead of a rewrite.
    where: { dailyLogId: log.id, duplicateOfMeetingId: null },
    select: { id: true, name: true, scheduledAt: true, habitId: true },
  });
  if (activities.length === 0) return 0;

  const duplicates = findMeetingDuplicates(activities, meetings);
  if (duplicates.size === 0) return 0;

  // Group by meeting so one UPDATE covers every echo of the same event.
  const byMeeting = new Map<string, string[]>();
  for (const [activityId, meetingId] of duplicates) {
    const bucket = byMeeting.get(meetingId);
    if (bucket) bucket.push(activityId);
    else byMeeting.set(meetingId, [activityId]);
  }

  let flagged = 0;
  for (const [meetingId, ids] of byMeeting) {
    const res = await prisma.activity.updateMany({
      where: { id: { in: ids }, duplicateOfMeetingId: null },
      data: { duplicateOfMeetingId: meetingId },
    });
    flagged += res.count;
  }

  return flagged;
}
