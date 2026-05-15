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

  const where: Record<string, unknown> = { userId: session.user.id };
  if (mentorId) where.mentorId = mentorId;
  if (week) where.weekNumber = parseInt(week, 10);

  const plans = await prisma.mentorPlan.findMany({
    where,
    include: {
      mentor: { select: { id: true, name: true, avatarEmoji: true, role: true } },
    },
    orderBy: [{ mentorId: "asc" }, { weekNumber: "asc" }],
  });

  return NextResponse.json(plans);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Brak uprawnien" }, { status: 403 });
  }

  const { mentorId, weekNumber, phase, tasks, notes } = await req.json();

  if (!mentorId || weekNumber == null || !tasks) {
    return NextResponse.json({ error: "mentorId, weekNumber, tasks required" }, { status: 400 });
  }

  const plan = await prisma.mentorPlan.upsert({
    where: {
      mentorId_userId_weekNumber: {
        mentorId,
        userId: session.user.id,
        weekNumber,
      },
    },
    update: { tasks, notes: notes || null, phase: phase || 1 },
    create: {
      mentorId,
      userId: session.user.id,
      weekNumber,
      phase: phase || 1,
      tasks,
      notes: notes || null,
    },
    include: {
      mentor: { select: { id: true, name: true, avatarEmoji: true, role: true } },
    },
  });

  return NextResponse.json(plan);
}
