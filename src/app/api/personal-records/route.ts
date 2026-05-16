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

  const area = await prisma.lifeArea.findUnique({ where: { id: lifeAreaId } });
  if (!area || area.userId !== session.user.id) {
    return NextResponse.json({ error: "Nie znaleziono" }, { status: 404 });
  }

  const records = await prisma.personalRecord.findMany({
    where: { userId: session.user.id, lifeAreaId },
    orderBy: { achievedAt: "desc" },
  });

  return NextResponse.json(records);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const body = await req.json();
  const { lifeAreaId, exerciseName, value, unit, notes } = body;

  if (!lifeAreaId || !exerciseName?.trim() || value === undefined || !unit?.trim()) {
    return NextResponse.json(
      { error: "lifeAreaId, exerciseName, value, unit wymagane" },
      { status: 400 }
    );
  }

  const area = await prisma.lifeArea.findUnique({ where: { id: lifeAreaId } });
  if (!area || area.userId !== session.user.id) {
    return NextResponse.json({ error: "Nie znaleziono" }, { status: 404 });
  }

  const record = await prisma.personalRecord.create({
    data: {
      userId: session.user.id,
      lifeAreaId,
      exerciseName: exerciseName.trim(),
      value: Number(value),
      unit: unit.trim(),
      notes: notes?.trim() || null,
    },
  });

  return NextResponse.json(record);
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

  const existing = await prisma.personalRecord.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Nie znaleziono" }, { status: 404 });
  }

  await prisma.personalRecord.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
