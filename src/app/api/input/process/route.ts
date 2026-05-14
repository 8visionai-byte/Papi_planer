import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { analyzeInput } from "@/lib/ai/analyzer";
import { startOfDay } from "date-fns";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const body = await request.json();
    const { text } = body;

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { error: "Text input is required" },
        { status: 400 }
      );
    }

    // Analyze the input with Claude
    const analyzed = await analyzeInput(text.trim(), userId);

    const today = startOfDay(new Date());

    // Upsert today's DailyLog with extracted data
    const dailyLog = await prisma.dailyLog.upsert({
      where: { userId_date: { userId, date: today } },
      create: {
        userId,
        date: today,
        mood: analyzed.mood ?? undefined,
        energy: analyzed.energy ?? undefined,
        sleepHours: analyzed.sleepHours ?? undefined,
        sleepQuality: analyzed.sleepQuality ?? undefined,
        dayType: analyzed.dayType ?? undefined,
        voiceTranscript: text.trim(),
      },
      update: {
        // Only update fields that were extracted (non-null)
        ...(analyzed.mood != null && { mood: analyzed.mood }),
        ...(analyzed.energy != null && { energy: analyzed.energy }),
        ...(analyzed.sleepHours != null && { sleepHours: analyzed.sleepHours }),
        ...(analyzed.sleepQuality != null && { sleepQuality: analyzed.sleepQuality }),
        ...(analyzed.dayType != null && { dayType: analyzed.dayType }),
        // Append to voice transcript
        voiceTranscript: text.trim(),
      },
    });

    // Create Activity records for completed activities
    if (analyzed.activitiesCompleted && analyzed.activitiesCompleted.length > 0) {
      await prisma.activity.createMany({
        data: analyzed.activitiesCompleted.map((name) => ({
          dailyLogId: dailyLog.id,
          type: "manual",
          name,
          completed: true,
        })),
      });
    }

    // Create Meal records
    if (analyzed.meals && analyzed.meals.length > 0) {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

      await prisma.meal.createMany({
        data: analyzed.meals.map((meal) => ({
          dailyLogId: dailyLog.id,
          time: timeStr,
          name: meal.name,
          calories: meal.calories ?? null,
          description: meal.description ?? null,
        })),
      });
    }

    return NextResponse.json({
      analyzed,
      dailyLogId: dailyLog.id,
    });
  } catch (err) {
    console.error("Input processing error:", err);
    const message = err instanceof Error ? err.message : "Processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
