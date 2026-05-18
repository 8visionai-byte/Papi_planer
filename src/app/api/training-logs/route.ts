import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { METRICS_WHITELIST } from "@/lib/training-templates";

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

  if (!lifeAreaId) {
    return NextResponse.json({ error: "lifeAreaId wymagane" }, { status: 400 });
  }

  // Verify ownership
  const area = await prisma.lifeArea.findUnique({ where: { id: lifeAreaId } });
  if (!area || area.userId !== session.user.id) {
    return NextResponse.json({ error: "Nie znaleziono" }, { status: 404 });
  }

  // Build whitelisted metrics from any extra body fields.
  // Numeric metrics: coerce; non-numeric stay as string.
  const numericMetrics = new Set([
    "rounds",
    "roundDurationMin",
    "avgHR",
    "holdDurationSec",
    "extraWeightKg",
  ]);
  const metrics: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(body)) {
    if (!METRICS_WHITELIST.has(key)) continue;
    const raw = body[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (numericMetrics.has(key)) {
      const num = Number(raw);
      if (Number.isFinite(num)) metrics[key] = num;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed) metrics[key] = trimmed;
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      metrics[key] = raw;
    }
  }
  const hasMetrics = Object.keys(metrics).length > 0;

  // exerciseName fallback — for templates that don't ask for it (e.g. swimming, running),
  // use stroke/type/route or a sensible default so the column stays non-null.
  let finalExerciseName = (exerciseName ?? "").trim();
  if (!finalExerciseName) {
    if (typeof metrics.stroke === "string") {
      finalExerciseName = `Pływanie: ${metrics.stroke}`;
    } else if (typeof metrics.type === "string") {
      finalExerciseName = `Karate: ${metrics.type}`;
    } else if (typeof metrics.route === "string") {
      finalExerciseName = `Bieg: ${metrics.route}`;
    } else if (distance) {
      finalExerciseName = `Bieg ${distance} km`;
    } else {
      finalExerciseName = "Trening";
    }
  }

  const log = await prisma.trainingLog.create({
    data: {
      userId: session.user.id,
      lifeAreaId,
      exerciseName: finalExerciseName,
      sets: sets ? Number(sets) : null,
      reps: reps ? Number(reps) : null,
      weightKg: weightKg ? Number(weightKg) : null,
      durationMin: durationMin ? Number(durationMin) : null,
      distance: distance ? Number(distance) : null,
      notes: notes?.trim() || null,
      rating: rating ? Number(rating) : null,
      metrics: hasMetrics ? (metrics as Prisma.InputJsonValue) : undefined,
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
