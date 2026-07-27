import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { polishDayDate } from "@/lib/habits/link";

const TIME_ORDER: Record<string, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
  any: 3,
};

const TIME_OF_DAY = ["morning", "afternoon", "evening", "any"];

/** "build" = a brand new habit, "replace" = installed in place of an old one. */
const HABIT_KINDS = ["build", "replace"] as const;
type HabitKind = (typeof HABIT_KINDS)[number];

/**
 * Ceiling for every free-text loop field (cue / routine / reward / why / identity /
 * replaces). Long enough for two full sentences, short enough that the habit list and
 * the AI context never blow up. Mirrors MAX_FIELD in lib/ai/habit-coach.ts.
 */
const MAX_TEXT = 500;

/**
 * Reads one optional free-text field out of the body.
 *
 * Three-state on purpose, because PATCH has to tell "the client did not send this key"
 * apart from "the client cleared this field":
 *  - `undefined` -> key absent, do not touch the column,
 *  - `null`      -> sent empty, clear the column,
 *  - string      -> trimmed and capped.
 */
function optionalText(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const s = raw.toString().trim();
  if (!s) return null;
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s;
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

  // The Polish calendar day, the same one /api/habits/toggle writes. Reading the
  // container's UTC day instead made every tick between Polish midnight and 02:00 look
  // undone the moment the screen refreshed, because the write landed on day D and the
  // read asked for D-1.
  const today = polishDayDate();
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
  const timeOfDay = TIME_OF_DAY.includes(timeOfDayRaw) ? timeOfDayRaw : "any";

  const kindRaw = (body?.kind ?? "build").toString();
  const kind: HabitKind = HABIT_KINDS.includes(kindRaw as HabitKind)
    ? (kindRaw as HabitKind)
    : "build";

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
      // habit loop: cue -> routine -> reward, plus the two motivation columns
      cue: optionalText(body?.cue) ?? null,
      routine: optionalText(body?.routine) ?? null,
      reward: optionalText(body?.reward) ?? null,
      why: optionalText(body?.why) ?? null,
      identity: optionalText(body?.identity) ?? null,
      kind,
      // A "build" habit swaps nothing, so a stray `replaces` would render a swap that
      // does not exist. Only a "replace" habit keeps the old behaviour.
      replaces: kind === "replace" ? (optionalText(body?.replaces) ?? null) : null,
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
    cue?: string | null;
    routine?: string | null;
    reward?: string | null;
    why?: string | null;
    identity?: string | null;
    kind?: HabitKind;
    replaces?: string | null;
  } = {};
  if (typeof body.name === "string") data.name = body.name.trim();
  if (body.description !== undefined)
    data.description = body.description ? body.description.toString().trim() : null;
  if (typeof body.timeOfDay === "string" && TIME_OF_DAY.includes(body.timeOfDay))
    data.timeOfDay = body.timeOfDay;
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;

  // habit loop fields: absent key = leave the column alone, empty string = clear it
  const cue = optionalText(body.cue);
  if (cue !== undefined) data.cue = cue;
  const routine = optionalText(body.routine);
  if (routine !== undefined) data.routine = routine;
  const reward = optionalText(body.reward);
  if (reward !== undefined) data.reward = reward;
  const why = optionalText(body.why);
  if (why !== undefined) data.why = why;
  const identity = optionalText(body.identity);
  if (identity !== undefined) data.identity = identity;

  if (typeof body.kind === "string" && HABIT_KINDS.includes(body.kind as HabitKind)) {
    data.kind = body.kind as HabitKind;
  }
  const replaces = optionalText(body.replaces);
  if (replaces !== undefined) data.replaces = replaces;
  // Switching back to "build" hides the swap field in the UI, so the old value must go
  // with it, otherwise the list keeps showing a swap the habit no longer describes.
  if (data.kind === "build") data.replaces = null;

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
