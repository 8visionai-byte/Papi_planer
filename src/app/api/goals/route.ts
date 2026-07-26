import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

/* ------------------------------------------------------------------ */
/*  Goal lifecycle                                                     */
/* ------------------------------------------------------------------ */

/**
 * The four statuses a goal can hold. Only "active" is visible to the day planner
 * and to the mentors' context — closing a goal is how the user stops being
 * reminded about an exam he already passed.
 */
const GOAL_STATUSES = ["active", "achieved", "abandoned", "paused"] as const;
type GoalStatus = (typeof GOAL_STATUSES)[number];

/**
 * Statuses that keep the goal "on the board".
 * "paused" belongs here on purpose: a paused goal must stay reachable so the user
 * can resume it. It is the AI layer that filters on status === "active" strictly,
 * so pausing already stops the daily nagging without hiding the goal from its owner.
 */
const OPEN_STATUSES = ["active", "paused"];

/**
 * Statuses that mean "done with it".
 * "completed" is the legacy value written by the older auto-complete code paths
 * (mentor-plans/toggle-task, activities/toggle). It is accepted here so those rows
 * do not fall through both filters and disappear from the UI entirely.
 */
const CLOSED_STATUSES = ["achieved", "abandoned", "completed"];

/** Closing a goal stamps achievedAt; these are the two statuses that do it. */
const CLOSING_STATUSES = new Set<GoalStatus>(["achieved", "abandoned"]);

/** One sentence, not an essay. Keeps the AI context and the card readable. */
const OUTCOME_MAX = 500;

/** Accepts a status from the client, mapping the legacy "completed" onto "achieved". */
function parseStatus(raw: unknown): GoalStatus | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value === "completed") return "achieved";
  return (GOAL_STATUSES as readonly string[]).includes(value) ? (value as GoalStatus) : null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function normalizeMentorIds(raw: unknown): string[] | null {
  if (raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const cleaned = raw
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((s) => s.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of cleaned) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

async function verifyMentorOwnership(
  userId: string,
  mentorIds: string[]
): Promise<{ ok: boolean; missing?: string }> {
  if (mentorIds.length === 0) return { ok: true };
  const owned = await prisma.mentor.findMany({
    where: { id: { in: mentorIds }, userId, active: true },
    select: { id: true },
  });
  const ownedSet = new Set(owned.map((m) => m.id));
  const missing = mentorIds.find((id) => !ownedSet.has(id));
  if (missing) return { ok: false, missing };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  Routes                                                             */
/* ------------------------------------------------------------------ */

/**
 * GET /api/goals?status=active|closed|all
 *
 * Defaults to `active` so that anything reading this endpoint without thinking
 * gets only goals that are still in play. The Goals screen asks for `all` and
 * splits the two tabs client side, which keeps tab switching instant.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawStatus = (req.nextUrl.searchParams.get("status") ?? "active").trim().toLowerCase();
  const view: "active" | "closed" | "all" =
    rawStatus === "closed" ? "closed" : rawStatus === "all" ? "all" : "active";

  const where =
    view === "all"
      ? { userId: session.user.id }
      : view === "closed"
        ? { userId: session.user.id, status: { in: CLOSED_STATUSES } }
        : { userId: session.user.id, status: { in: OPEN_STATUSES } };

  const goals = await prisma.goal.findMany({
    where,
    include: {
      milestones: { orderBy: { sortOrder: "asc" } },
      mentor: { select: { id: true, name: true, avatarEmoji: true, role: true } },
      lifeArea: { select: { id: true, name: true } },
    },
    // Closed goals read best newest-first by closing date; everything else keeps
    // the original ordering so the active list does not shuffle under the user.
    orderBy:
      view === "closed"
        ? [{ achievedAt: "desc" as const }, { createdAt: "desc" as const }]
        : [{ status: "asc" as const }, { createdAt: "desc" as const }],
  });

  // Hydrate full mentors list for multi-mentor display
  const allMentorIds = Array.from(
    new Set(goals.flatMap((g) => g.mentorIds ?? []))
  );
  const mentorRows = allMentorIds.length
    ? await prisma.mentor.findMany({
        where: { id: { in: allMentorIds }, userId: session.user.id },
        select: { id: true, name: true, avatarEmoji: true, role: true },
      })
    : [];
  const mentorById = new Map(mentorRows.map((m) => [m.id, m]));

  const result = goals.map((g) => ({
    ...g,
    mentors: (g.mentorIds ?? [])
      .map((id) => mentorById.get(id))
      .filter((m): m is NonNullable<typeof m> => !!m),
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { title, description, lifeAreaId, targetDate, milestones } = body;

  if (!title?.trim()) {
    return NextResponse.json({ error: "Tytuł jest wymagany" }, { status: 400 });
  }

  const mentorIds = normalizeMentorIds(body.mentorIds) ?? [];
  // Legacy: also accept single mentorId
  if (mentorIds.length === 0 && typeof body.mentorId === "string" && body.mentorId.trim()) {
    mentorIds.push(body.mentorId.trim());
  }

  // Verify mentor ownership
  const ownership = await verifyMentorOwnership(session.user.id, mentorIds);
  if (!ownership.ok) {
    return NextResponse.json(
      { error: `Mentor ${ownership.missing} nie istnieje lub jest nieaktywny` },
      { status: 400 }
    );
  }

  const primaryMentorId = mentorIds[0] ?? null;

  const goal = await prisma.goal.create({
    data: {
      userId: session.user.id,
      title: title.trim(),
      description: description?.trim() || null,
      mentorId: primaryMentorId,
      mentorIds,
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

  // Hydrate mentors list
  const mentorRows = mentorIds.length
    ? await prisma.mentor.findMany({
        where: { id: { in: mentorIds }, userId: session.user.id },
        select: { id: true, name: true, avatarEmoji: true, role: true },
      })
    : [];
  const byId = new Map(mentorRows.map((m) => [m.id, m]));
  const mentors = mentorIds.map((id) => byId.get(id)).filter((m): m is NonNullable<typeof m> => !!m);

  return NextResponse.json({ ...goal, mentors });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, title, description, status, progress, targetDate, lifeAreaId, outcome } = body;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const existing = await prisma.goal.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  /* ---------------- status transition ----------------
     Closing a goal ("achieved" / "abandoned") stamps achievedAt so the closed
     tab and the AI memory both have a date. Re-opening clears it. Progress is
     forced to 100 only on "achieved": the user declaring it done outranks the
     milestone arithmetic (the karate exam was passed without ticking boxes). */
  const lifecycle: {
    status?: GoalStatus;
    achievedAt?: Date | null;
    progress?: number;
  } = {};

  if (status !== undefined) {
    const parsed = parseStatus(status);
    if (!parsed) {
      return NextResponse.json(
        { error: `Nieznany status celu: ${String(status)}` },
        { status: 400 }
      );
    }
    lifecycle.status = parsed;
    if (CLOSING_STATUSES.has(parsed)) {
      lifecycle.achievedAt = new Date();
      if (parsed === "achieved") lifecycle.progress = 100;
    } else if (parsed === "active") {
      lifecycle.achievedAt = null;
    }
    // "paused" leaves achievedAt untouched: the goal was never finished, only shelved.
  }

  // An explicit progress in the same request still wins over the derived 100.
  if (progress !== undefined) lifecycle.progress = progress;

  const nextOutcome =
    outcome === undefined
      ? undefined
      : typeof outcome === "string" && outcome.trim().length > 0
        ? outcome.trim().slice(0, OUTCOME_MAX)
        : null;

  // Resolve mentorIds — accept array OR fallback to single mentorId for back-compat
  let nextMentorIds: string[] | undefined;
  if (body.mentorIds !== undefined) {
    const parsed = normalizeMentorIds(body.mentorIds);
    if (parsed === null) {
      return NextResponse.json({ error: "mentorIds must be array" }, { status: 400 });
    }
    nextMentorIds = parsed;
  } else if (body.mentorId !== undefined) {
    // Legacy: convert single mentorId to mentorIds
    if (body.mentorId === null || body.mentorId === "") {
      nextMentorIds = [];
    } else if (typeof body.mentorId === "string") {
      nextMentorIds = [body.mentorId.trim()].filter((s) => s.length > 0);
    }
  }

  if (nextMentorIds !== undefined) {
    const ownership = await verifyMentorOwnership(session.user.id, nextMentorIds);
    if (!ownership.ok) {
      return NextResponse.json(
        { error: `Mentor ${ownership.missing} nie istnieje lub jest nieaktywny` },
        { status: 400 }
      );
    }
  }

  if (lifeAreaId !== undefined && lifeAreaId !== null && lifeAreaId !== "") {
    const owns = await prisma.lifeArea.findFirst({
      where: { id: lifeAreaId, userId: session.user.id },
      select: { id: true },
    });
    if (!owns) {
      return NextResponse.json({ error: "Obszar życia nie istnieje" }, { status: 400 });
    }
  }

  const goal = await prisma.goal.update({
    where: { id },
    data: {
      ...(title !== undefined && { title: title.trim() }),
      ...(description !== undefined && { description: description?.trim() || null }),
      ...lifecycle,
      ...(nextOutcome !== undefined && { outcome: nextOutcome }),
      ...(targetDate !== undefined && { targetDate: targetDate ? new Date(targetDate) : null }),
      ...(nextMentorIds !== undefined && {
        mentorIds: nextMentorIds,
        mentorId: nextMentorIds[0] ?? null,
      }),
      ...(lifeAreaId !== undefined && { lifeAreaId: lifeAreaId || null }),
    },
    include: {
      milestones: { orderBy: { sortOrder: "asc" } },
      mentor: { select: { id: true, name: true, avatarEmoji: true, role: true } },
      lifeArea: { select: { id: true, name: true } },
    },
  });

  // Hydrate mentors list
  const ids = goal.mentorIds ?? [];
  const mentorRows = ids.length
    ? await prisma.mentor.findMany({
        where: { id: { in: ids }, userId: session.user.id },
        select: { id: true, name: true, avatarEmoji: true, role: true },
      })
    : [];
  const byId = new Map(mentorRows.map((m) => [m.id, m]));
  const mentors = ids.map((id) => byId.get(id)).filter((m): m is NonNullable<typeof m> => !!m);

  return NextResponse.json({ ...goal, mentors });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let id: string | undefined;
  try {
    const body = await req.json().catch(() => null);
    if (body && typeof body === "object" && typeof body.id === "string") id = body.id;
  } catch {
    // ignore
  }
  if (!id) {
    id = req.nextUrl.searchParams.get("id") ?? undefined;
  }
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const existing = await prisma.goal.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Plans tied to this goal cascade-delete via the goalId relation.
  // Legacy plans (goalId NULL) tied to the goal's mentor only get removed
  // when this was the LAST goal pointing at that mentor.
  if (existing.mentorId) {
    const others = await prisma.goal.count({
      where: {
        userId: session.user.id,
        mentorId: existing.mentorId,
        id: { not: id },
      },
    });
    if (others === 0) {
      await prisma.mentorPlan.deleteMany({
        where: {
          mentorId: existing.mentorId,
          userId: session.user.id,
          goalId: null,
        },
      });
    }
  }

  await prisma.goal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
