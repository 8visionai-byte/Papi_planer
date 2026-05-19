import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

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
  const { id, title, description, status, progress, targetDate, lifeAreaId } = body;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const existing = await prisma.goal.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
      ...(status !== undefined && { status }),
      ...(progress !== undefined && { progress }),
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
