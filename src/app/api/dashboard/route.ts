import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { startOfDay, endOfDay } from "date-fns";
import { calculateBMR, calculateTDEE, getBmrSoFarToday } from "@/lib/ai/bmr-calculator";
import {
  CalendarError,
  getCalendarEvents,
  type CalendarEvent,
} from "@/lib/google/calendar";

interface BmrProfileFields {
  weightKg?: unknown;
  heightCm?: unknown;
  age?: unknown;
  gender?: unknown;
  activityLevel?: unknown;
}

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
}

function extractBmrFields(profileData: unknown): BmrProfileFields {
  if (!profileData || typeof profileData !== "object") return {};
  const d = profileData as Record<string, unknown>;
  return {
    weightKg: d.weightKg,
    heightCm: d.heightCm,
    age: d.age,
    gender: d.gender,
    activityLevel: d.activityLevel,
  };
}

function readShowCalendarFlag(profileData: unknown): boolean {
  if (!profileData || typeof profileData !== "object") return false;
  const d = profileData as Record<string, unknown>;
  return d.showCalendarInPlan === true;
}

function toMeeting(ev: CalendarEvent): MeetingItem {
  const start = new Date(ev.start);
  const end = new Date(ev.end);
  const hh = start.getHours().toString().padStart(2, "0");
  const mm = start.getMinutes().toString().padStart(2, "0");
  const durationMin = ev.allDay
    ? 24 * 60
    : Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
  return {
    id: ev.id,
    time: ev.allDay ? "00:00" : `${hh}:${mm}`,
    durationMin: durationMin > 0 ? durationMin : 60,
    name: ev.title,
    location: ev.location ?? null,
    description: ev.description ?? null,
    attendees: ev.attendees ?? [],
    hangoutLink: ev.hangoutLink ?? null,
    allDay: ev.allDay,
    start: ev.start,
    end: ev.end,
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

  const fields = extractBmrFields(profile?.data);
  const bmr = calculateBMR({
    weightKg: typeof fields.weightKg === "number" ? fields.weightKg : null,
    heightCm: typeof fields.heightCm === "number" ? fields.heightCm : null,
    age: typeof fields.age === "number" ? fields.age : null,
    gender: typeof fields.gender === "string" ? fields.gender : null,
  });
  const activityLevel =
    typeof fields.activityLevel === "string" ? fields.activityLevel : undefined;
  const tdee = calculateTDEE(bmr, activityLevel);
  const bmrSoFarToday = getBmrSoFarToday(bmr);

  // Google Calendar meetings — only when user opted-in.
  let meetings: MeetingItem[] = [];
  let calendarError: string | null = null;
  if (readShowCalendarFlag(profile?.data)) {
    try {
      const events = await getCalendarEvents(userId, {
        from: startOfDay(new Date()),
        to: endOfDay(new Date()),
      });
      meetings = events.map(toMeeting);
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
  });
}
