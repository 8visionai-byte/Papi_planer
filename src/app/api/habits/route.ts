import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

const TIME_ORDER: Record<string, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
  any: 3,
};

function todayUTCDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const habits = await prisma.habit.findMany({
    where: { userId: session.user.id, active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const sorted = [...habits].sort((a, b) => {
    const oa = TIME_ORDER[a.timeOfDay] ?? 99;
    const ob = TIME_ORDER[b.timeOfDay] ?? 99;
    if (oa !== ob) return oa - ob;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const today = todayUTCDate();
  const completionsToday = await prisma.habitCompletion.findMany({
    where: {
      userId: session.user.id,
      date: today,
      habitId: { in: sorted.map((h) => h.id) },
    },
  });

  const todayCompletions: Record<string, boolean> = {};
  for (const h of sorted) todayCompletions[h.id] = false;
  for (const c of completionsToday) {
    todayCompletions[c.habitId] = c.completed;
  }

  return NextResponse.json({ habits: sorted, todayCompletions });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const name = (body?.name ?? "").toString().trim();
  if (!name) {
    return NextResponse.json({ error: "Nazwa jest wymagana" }, { status: 400 });
  }
  const description =
    body?.description != null ? body.description.toString().trim() || null : null;
  const timeOfDayRaw = (body?.timeOfDay ?? "any").toString();
  const timeOfDay = ["morning", "afternoon", "evening", "any"].includes(timeOfDayRaw)
    ? timeOfDayRaw
    : "any";

  const last = await prisma.habit.findFirst({
    where: { userId: session.user.id, timeOfDay },
    orderBy: { sortOrder: "desc" },
  });
  const sortOrder = (last?.sortOrder ?? -1) + 1;

  const habit = await prisma.habit.create({
    data: {
      userId: session.user.id,
      name,
      description,
      timeOfDay,
      sortOrder,
    },
  });

  return NextResponse.json(habit);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const id = body?.id;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const existing = await prisma.habit.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data: {
    name?: string;
    description?: string | null;
    timeOfDay?: string;
    active?: boolean;
    sortOrder?: number;
  } = {};
  if (typeof body.name === "string") data.name = body.name.trim();
  if (body.description !== undefined)
    data.description = body.description ? body.description.toString().trim() : null;
  if (
    typeof body.timeOfDay === "string" &&
    ["morning", "afternoon", "evening", "any"].includes(body.timeOfDay)
  )
    data.timeOfDay = body.timeOfDay;
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;

  const habit = await prisma.habit.update({ where: { id }, data });
  return NextResponse.json(habit);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const existing = await prisma.habit.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Soft delete — preserve completion history
  await prisma.habit.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ ok: true });
}
