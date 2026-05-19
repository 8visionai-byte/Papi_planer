import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mentorId = req.nextUrl.searchParams.get("mentorId");
  const week = req.nextUrl.searchParams.get("week");
  const goalId = req.nextUrl.searchParams.get("goalId");

  const where: Record<string, unknown> = { userId: session.user.id };
  if (mentorId) where.mentorId = mentorId;
  if (week) where.weekNumber = parseInt(week, 10);
  if (goalId) where.goalId = goalId;

  const plans = await prisma.mentorPlan.findMany({
    where,
    include: {
      mentor: { select: { id: true, name: true, avatarEmoji: true, role: true } },
      goal: { select: { id: true, title: true, progress: true, status: true } },
    },
    orderBy: [{ goalId: "asc" }, { mentorId: "asc" }, { weekNumber: "asc" }],
  });

  return NextResponse.json(plans);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 403 });
  }

  const { mentorId, weekNumber, phase, tasks, notes, goalId } = await req.json();

  if (!mentorId || weekNumber == null || !tasks) {
    return NextResponse.json(
      { error: "mentorId, weekNumber, tasks required" },
      { status: 400 }
    );
  }

  // Admin path supports goal-scoped upsert when goalId is provided
  if (goalId) {
    const plan = await prisma.mentorPlan.upsert({
      where: {
        goalId_mentorId_weekNumber: {
          goalId,
          mentorId,
          weekNumber,
        },
      },
      update: { tasks, notes: notes || null, phase: phase || 1 },
      create: {
        mentorId,
        userId: session.user.id,
        goalId,
        weekNumber,
        phase: phase || 1,
        tasks,
        notes: notes || null,
      },
      include: {
        mentor: { select: { id: true, name: true, avatarEmoji: true, role: true } },
        goal: { select: { id: true, title: true, progress: true, status: true } },
      },
    });
    return NextResponse.json(plan);
  }

  // Legacy path (no goalId): direct create — duplicates allowed only via the unique key
  const plan = await prisma.mentorPlan.create({
    data: {
      mentorId,
      userId: session.user.id,
      weekNumber,
      phase: phase || 1,
      tasks,
      notes: notes || null,
    },
    include: {
      mentor: { select: { id: true, name: true, avatarEmoji: true, role: true } },
      goal: { select: { id: true, title: true, progress: true, status: true } },
    },
  });

  return NextResponse.json(plan);
}
