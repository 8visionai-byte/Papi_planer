import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

function todayUTCDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { habitId } = await req.json();
  if (!habitId) {
    return NextResponse.json({ error: "habitId required" }, { status: 400 });
  }

  const habit = await prisma.habit.findUnique({ where: { id: habitId } });
  if (!habit || habit.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const today = todayUTCDate();
  const existing = await prisma.habitCompletion.findUnique({
    where: { habitId_date: { habitId, date: today } },
  });

  let completed: boolean;
  if (existing) {
    completed = !existing.completed;
    await prisma.habitCompletion.update({
      where: { id: existing.id },
      data: { completed },
    });
  } else {
    completed = true;
    await prisma.habitCompletion.create({
      data: {
        habitId,
        userId: session.user.id,
        date: today,
        completed,
      },
    });
  }

  return NextResponse.json({ completed });
}
