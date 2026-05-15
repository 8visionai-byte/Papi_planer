import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const goals = await prisma.goal.findMany({
    where: { userId: session.user.id },
    include: {
      milestones: { orderBy: { sortOrder: "asc" } },
      mentor: { select: { id: true, name: true, avatarEmoji: true, role: true } },
      lifeArea: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(goals);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { title, description, mentorId, lifeAreaId, targetDate, milestones } = await req.json();

  if (!title?.trim()) {
    return NextResponse.json({ error: "Tytul jest wymagany" }, { status: 400 });
  }

  const goal = await prisma.goal.create({
    data: {
      userId: session.user.id,
      title: title.trim(),
      description: description?.trim() || null,
      mentorId: mentorId || null,
      lifeAreaId: lifeAreaId || null,
      targetDate: targetDate ? new Date(targetDate) : null,
      milestones: milestones?.length
        ? {
            create: milestones.map((m: { title: string }, i: number) => ({
              title: m.title,
              sortOrder: i,
            })),
          }
        : undefined,
    },
    include: {
      milestones: { orderBy: { sortOrder: "asc" } },
      mentor: { select: { id: true, name: true, avatarEmoji: true, role: true } },
      lifeArea: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(goal);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, title, description, status, progress, targetDate } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const existing = await prisma.goal.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const goal = await prisma.goal.update({
    where: { id },
    data: {
      ...(title !== undefined && { title: title.trim() }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...(status !== undefined && { status }),
      ...(progress !== undefined && { progress }),
      ...(targetDate !== undefined && { targetDate: targetDate ? new Date(targetDate) : null }),
    },
    include: {
      milestones: { orderBy: { sortOrder: "asc" } },
      mentor: { select: { id: true, name: true, avatarEmoji: true, role: true } },
      lifeArea: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(goal);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await req.json();
  const existing = await prisma.goal.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.goal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
