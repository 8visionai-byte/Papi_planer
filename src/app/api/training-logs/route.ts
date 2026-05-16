import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const url = new URL(req.url);
  const lifeAreaId = url.searchParams.get("lifeAreaId");
  if (!lifeAreaId) {
    return NextResponse.json({ error: "lifeAreaId wymagane" }, { status: 400 });
  }

  // Verify ownership
  const area = await prisma.lifeArea.findUnique({ where: { id: lifeAreaId } });
  if (!area || area.userId !== session.user.id) {
    return NextResponse.json({ error: "Nie znaleziono" }, { status: 404 });
  }

  const logs = await prisma.trainingLog.findMany({
    where: { userId: session.user.id, lifeAreaId },
    orderBy: { date: "desc" },
    take: 50,
  });

  return NextResponse.json(logs);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const body = await req.json();
  const {
    lifeAreaId,
    exerciseName,
    sets,
    reps,
    weightKg,
    durationMin,
    distance,
    notes,
    rating,
  } = body;

  if (!lifeAreaId || !exerciseName?.trim()) {
    return NextResponse.json(
      { error: "lifeAreaId i exerciseName wymagane" },
      { status: 400 }
    );
  }

  // Verify ownership
  const area = await prisma.lifeArea.findUnique({ where: { id: lifeAreaId } });
  if (!area || area.userId !== session.user.id) {
    return NextResponse.json({ error: "Nie znaleziono" }, { status: 404 });
  }

  const log = await prisma.trainingLog.create({
    data: {
      userId: session.user.id,
      lifeAreaId,
      exerciseName: exerciseName.trim(),
      sets: sets ? Number(sets) : null,
      reps: reps ? Number(reps) : null,
      weightKg: weightKg ? Number(weightKg) : null,
      durationMin: durationMin ? Number(durationMin) : null,
      distance: distance ? Number(distance) : null,
      notes: notes?.trim() || null,
      rating: rating ? Number(rating) : null,
    },
  });

  return NextResponse.json(log);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "id wymagane" }, { status: 400 });
  }

  const existing = await prisma.trainingLog.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Nie znaleziono" }, { status: 404 });
  }

  await prisma.trainingLog.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
