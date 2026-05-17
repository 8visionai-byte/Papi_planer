import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { startOfDay } from "date-fns";
import { calculateBMR, calculateTDEE, getBmrSoFarToday } from "@/lib/ai/bmr-calculator";

interface BmrProfileFields {
  weightKg?: unknown;
  heightCm?: unknown;
  age?: unknown;
  gender?: unknown;
}

function extractBmrFields(profileData: unknown): BmrProfileFields {
  if (!profileData || typeof profileData !== "object") return {};
  const d = profileData as Record<string, unknown>;
  return {
    weightKg: d.weightKg,
    heightCm: d.heightCm,
    age: d.age,
    gender: d.gender,
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
  const tdee = calculateTDEE(bmr);
  const bmrSoFarToday = getBmrSoFarToday(bmr);

  return NextResponse.json({
    briefing: briefing ?? null,
    schedule,
    activities: dailyLog?.activities ?? [],
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
