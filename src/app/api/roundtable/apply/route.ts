/**
 * POST /api/roundtable/apply
 * Body: { sessionId: string, date?: "YYYY-MM-DD" }
 *
 * Turns the proposals stored in `RoundTableSession.planChanges` into real
 * Activity rows and flips `applied` to true.
 *
 * Until this route existed, the most expensive call in the app (2N+2 model
 * calls) ended as text to read: `applied` and `planChanges` were never written
 * and the history always said "Nie wdrożone" (roundtable/page.tsx:1085).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { detectActivityType } from "@/lib/ai/calorie-calculator";
import type { RoundTablePlanChange } from "@/lib/roundtable/engine";
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

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { sessionId?: unknown; date?: unknown };
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
  if (rtSession.applied) {
    return NextResponse.json({ alreadyApplied: true, created: 0, activities: [] });
  }

  const changes = parseChanges(rtSession.planChanges);
  if (changes.length === 0) {
    return NextResponse.json(
      { error: "Ta debata nie ma konkretnych propozycji do wdrożenia" },
      { status: 400 }
    );
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

  for (const change of changes) {
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
  }

  if (created.length === 0) {
    return NextResponse.json({ error: "Nie udało się utworzyć żadnej pozycji" }, { status: 400 });
  }

  await prisma.roundTableSession.update({
    where: { id: sessionId },
    data: { applied: true },
  });

  return NextResponse.json({ created: created.length, activities: created, applied: true });
}
