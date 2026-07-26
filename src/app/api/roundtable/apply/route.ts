/**
 * POST /api/roundtable/apply
 * Body: { sessionId: string, indexes?: number[], date?: "YYYY-MM-DD" }
 *
 * Turns proposals stored in `RoundTableSession.planChanges` into real Activity rows.
 *
 * `indexes` picks WHICH proposals land in the plan (the checkbox list on the
 * roundtable screen). Omitting it means "all of them", which is what every caller
 * written before the checkboxes existed sends.
 *
 * Which items already landed is remembered inside the planChanges JSON
 * (`applied: number[]`) so a second call can add the rest without duplicating the
 * first batch. The `applied` BOOLEAN column keeps its old meaning: everything done.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { detectActivityType } from "@/lib/ai/calorie-calculator";
import type { RoundTablePlanChange, RoundTablePlanChanges } from "@/lib/roundtable/engine";
import { startOfDay } from "date-fns";

/** Types that have a MET factor in calorie-calculator.ts. */
const KNOWN_TYPES = new Set([
  "training",
  "workout",
  "hiit",
  "crossfit",
  "karate",
  "boxing",
  "martial_arts",
  "practice",
  "sport",
  "running",
  "cycling",
  "swimming",
  "rowing",
  "exercise",
  "walking",
  "yoga",
  "pilates",
  "stretching",
  "meditation",
  "mindset",
  "study",
  "work",
  "reading",
  "health",
  "nutrition",
  "rest",
  "scheduled",
]);

function parseChanges(raw: unknown): RoundTablePlanChange[] {
  if (!raw || typeof raw !== "object") return [];
  const changes = (raw as { changes?: unknown }).changes;
  if (!Array.isArray(changes)) return [];
  return changes.filter(
    (c): c is RoundTablePlanChange =>
      Boolean(c) && typeof c === "object" && typeof (c as { title?: unknown }).title === "string"
  );
}

/** YYYY-MM-DD -> UTC midnight (DailyLog.date is a `@db.Date` column). */
function parseDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Which proposals were already written into the plan.
 * Sessions saved before per-item apply existed carry no `applied` array, so the
 * legacy boolean column is the whole truth for them: true = every item is in.
 */
function readAppliedIndexes(raw: unknown, total: number, legacyApplied: boolean): Set<number> {
  const stored =
    raw && typeof raw === "object" ? (raw as { applied?: unknown }).applied : undefined;

  if (Array.isArray(stored)) {
    const set = new Set<number>();
    for (const v of stored) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n < total) set.add(n);
    }
    // A legacy session can have applied=true AND an empty array written later;
    // trust the boolean in that case so nothing gets created twice.
    if (set.size === 0 && legacyApplied) return new Set(Array.from({ length: total }, (_, i) => i));
    return set;
  }

  return legacyApplied ? new Set(Array.from({ length: total }, (_, i) => i)) : new Set();
}

/**
 * `indexes` from the request body. Returns null when the caller did not send the
 * field at all, which means "apply everything" (backwards compatible).
 */
function readRequestedIndexes(raw: unknown, total: number): number[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) return [];
  const set = new Set<number>();
  for (const v of raw) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n < total) set.add(n);
  }
  return Array.from(set).sort((a, b) => a - b);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { sessionId?: unknown; indexes?: unknown; date?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId wymagane" }, { status: 400 });
  }

  const rtSession = await prisma.roundTableSession.findUnique({ where: { id: sessionId } });
  if (!rtSession || rtSession.userId !== userId) {
    return NextResponse.json({ error: "Nie znaleziono debaty" }, { status: 404 });
  }

  const changes = parseChanges(rtSession.planChanges);
  if (changes.length === 0) {
    return NextResponse.json(
      { error: "Ta debata nie ma konkretnych propozycji do wdrożenia" },
      { status: 400 }
    );
  }

  const alreadyApplied = readAppliedIndexes(
    rtSession.planChanges,
    changes.length,
    rtSession.applied
  );
  const requested = readRequestedIndexes(body.indexes, changes.length);

  if (requested !== null && requested.length === 0) {
    return NextResponse.json({ error: "Zaznacz co najmniej jedną pozycję" }, { status: 400 });
  }

  // No `indexes` in the body = the pre-checkbox contract: apply everything.
  const target = requested ?? changes.map((_, i) => i);
  const todo = target.filter((i) => !alreadyApplied.has(i));

  if (todo.length === 0) {
    return NextResponse.json({
      alreadyApplied: true,
      created: 0,
      activities: [],
      appliedIndexes: Array.from(alreadyApplied).sort((a, b) => a - b),
      totalChanges: changes.length,
    });
  }

  const defaultDate = parseDate(body.date) ?? startOfDay(new Date());

  // Only life areas the user owns may be attached.
  const ownedAreas = await prisma.lifeArea.findMany({
    where: { userId },
    select: { id: true },
  });
  const ownedAreaIds = new Set(ownedAreas.map((a) => a.id));

  const created: Array<{ id: string; name: string; date: string; time: string | null }> = [];
  const dailyLogCache = new Map<number, string>();
  // Only the indexes that really produced a row get marked applied, so an empty
  // title cannot silently "consume" a proposal the user still expects to add.
  const createdIndexes: number[] = [];

  for (const index of todo) {
    const change: RoundTablePlanChange = changes[index];
    const title = change.title.trim().slice(0, 200);
    if (!title) continue;

    const date = parseDate(change.date) ?? defaultDate;
    const key = date.getTime();
    let dailyLogId = dailyLogCache.get(key);
    if (!dailyLogId) {
      const log = await prisma.dailyLog.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date },
        update: {},
        select: { id: true },
      });
      dailyLogId = log.id;
      dailyLogCache.set(key, dailyLogId);
    }

    const type =
      change.type && KNOWN_TYPES.has(change.type)
        ? change.type
        : detectActivityType(`${title} ${change.description ?? ""}`);

    const notes = [
      "Z Okrągłego Stołu",
      change.description ? change.description.trim() : null,
    ]
      .filter(Boolean)
      .join(": ")
      .slice(0, 1000);

    const activity = await prisma.activity.create({
      data: {
        dailyLogId,
        lifeAreaId:
          change.lifeAreaId && ownedAreaIds.has(change.lifeAreaId) ? change.lifeAreaId : null,
        type,
        name: title,
        // "task" = to-do without a time of day.
        scheduledAt: change.kind === "activity" && change.time ? change.time : null,
        durationMin:
          typeof change.durationMin === "number" && change.durationMin > 0
            ? Math.round(change.durationMin)
            : null,
        completed: false,
        notes,
      },
      select: { id: true, name: true, scheduledAt: true },
    });

    created.push({
      id: activity.id,
      name: activity.name,
      date: date.toISOString().slice(0, 10),
      time: activity.scheduledAt,
    });
    createdIndexes.push(index);
  }

  if (created.length === 0) {
    return NextResponse.json({ error: "Nie udało się utworzyć żadnej pozycji" }, { status: 400 });
  }

  const appliedNow = Array.from(new Set([...alreadyApplied, ...createdIndexes])).sort(
    (a, b) => a - b
  );
  // The boolean column keeps meaning "the whole debate is in the plan"; a partial
  // apply leaves it false so the history still offers the remaining items.
  const allDone = appliedNow.length >= changes.length;

  const payload: RoundTablePlanChanges = {
    version: "rt-v1",
    changes,
    applied: appliedNow,
  };

  await prisma.roundTableSession.update({
    where: { id: sessionId },
    data: {
      applied: allDone,
      planChanges: JSON.parse(JSON.stringify(payload)),
    },
  });

  return NextResponse.json({
    created: created.length,
    activities: created,
    applied: allDone,
    appliedIndexes: appliedNow,
    totalChanges: changes.length,
  });
}
