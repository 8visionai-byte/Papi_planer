/**
 * The decision endpoint: PATCH /api/proposals/[id] { decision: "accept" | "reject" }
 *
 * This is the ONLY place in the app where an agent's idea turns into a real write.
 * Everything before it (the memory agent, POST /api/proposals) is inert on purpose.
 *
 * Two rules hold here and nowhere else:
 *  - "reject" changes nothing but the proposal row. The data stays exactly as it was.
 *  - "accept" flips the status AND applies the change inside one transaction, so the
 *    app can never end up with a card marked accepted while the data never moved
 *    (or the reverse: data changed, card still pending, tapped again, applied twice).
 *
 * The payload is sanitised a second time here, with the same `sanitizePayload` the
 * agent used. A pending row can sit in the table for weeks; by the time it is
 * accepted, the rules in memory-agent.ts may be stricter than when it was written,
 * and the stricter version is the one that must win.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import {
  isAllowedCombo,
  isProposalAction,
  isProposalEntity,
  sanitizePayload,
  splitEffect,
} from "@/lib/ai/memory-agent";
import { MENTOR_PLAN_RETIRED_MARKER } from "@/lib/ai/user-context";
import type { Prisma } from "@/generated/prisma/client";

const SELECT = {
  id: true,
  sourceText: true,
  entity: true,
  entityId: true,
  action: true,
  summary: true,
  payload: true,
  status: true,
  createdAt: true,
  decidedAt: true,
} as const;

/** Transaction client: same surface as `prisma`, minus $transaction and friends. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * The one-line "what you will notice" sentence, read straight off a stored payload.
 * Returns null for rows written before proposals carried one.
 */
function readEffect(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  return splitEffect(payload as Record<string, unknown>).effect;
}

/** Thrown inside the transaction so a failed apply rolls the status back too. */
class ApplyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/*  Appliers - one per entity, each checks ownership itself            */
/* ------------------------------------------------------------------ */

async function applyGoal(
  tx: Tx,
  userId: string,
  entityId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!entityId) throw new ApplyError("Propozycja nie wskazuje celu", 400);

  const goal = await tx.goal.findUnique({
    where: { id: entityId },
    select: { id: true, userId: true, status: true, achievedAt: true },
  });
  if (!goal || goal.userId !== userId) {
    throw new ApplyError("Cel nie istnieje", 404);
  }

  const data: Prisma.GoalUpdateInput = {};
  if (typeof payload.status === "string") data.status = payload.status;
  if (typeof payload.outcome === "string") data.outcome = payload.outcome;
  if (typeof payload.progress === "number") data.progress = payload.progress;
  if (typeof payload.title === "string") data.title = payload.title;
  if (typeof payload.description === "string") data.description = payload.description;
  if (typeof payload.targetDate === "string") {
    // sanitizePayload already guaranteed the "RRRR-MM-DD" shape.
    data.targetDate = new Date(`${payload.targetDate}T00:00:00.000Z`);
  }

  // Closing a goal has to stamp the date, otherwise "achieved" loses its when and
  // the long-term memory cannot tell a win from last week apart from one from May.
  if (payload.status === "achieved" && !goal.achievedAt) {
    data.achievedAt = new Date();
  }
  // A goal reopened by hand stops being closed, so the stamp goes with it.
  if (payload.status === "active" || payload.status === "paused") {
    data.achievedAt = null;
  }
  // Finishing a goal means 100%, unless the proposal said otherwise explicitly.
  if (payload.status === "achieved" && typeof payload.progress !== "number") {
    data.progress = 100;
  }

  if (Object.keys(data).length === 0) {
    throw new ApplyError("Propozycja nie zawiera żadnej zmiany", 400);
  }

  await tx.goal.update({ where: { id: entityId }, data });
}

async function applyInsight(
  tx: Tx,
  userId: string,
  action: string,
  entityId: string | null,
  payload: Record<string, unknown>,
  sourceText: string,
): Promise<void> {
  if (action === "deactivate") {
    if (!entityId) throw new ApplyError("Propozycja nie wskazuje wniosku", 400);
    const insight = await tx.userInsight.findUnique({
      where: { id: entityId },
      select: { id: true, userId: true },
    });
    if (!insight || insight.userId !== userId) {
      throw new ApplyError("Wniosek nie istnieje", 404);
    }
    // Never a delete. The row stops reaching the mentors and stays for the record.
    await tx.userInsight.update({ where: { id: entityId }, data: { active: false } });
    return;
  }

  // action === "create"
  const content = typeof payload.content === "string" ? payload.content : null;
  if (!content) throw new ApplyError("Propozycja nie zawiera treści wniosku", 400);
  const kind = typeof payload.kind === "string" ? payload.kind : "milestone";
  const title = typeof payload.title === "string" ? payload.title : content.slice(0, 60);
  const confidence = typeof payload.confidence === "number" ? payload.confidence : 0.8;

  await tx.userInsight.create({
    data: {
      userId,
      kind,
      // The agent wrote the sentence, so origin stays "app" even though a human
      // approved it. What the user writes themselves goes through POST /api/insights.
      origin: "app",
      period: null,
      title: title.slice(0, 80),
      content: content.slice(0, 1200),
      evidence: {
        source: "memory-agent",
        note: sourceText.slice(0, 500),
      } as unknown as Prisma.InputJsonValue,
      confidence,
      active: true,
    },
  });
}

async function applyHabit(
  tx: Tx,
  userId: string,
  action: string,
  entityId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!entityId) throw new ApplyError("Propozycja nie wskazuje nawyku", 400);

  const habit = await tx.habit.findUnique({
    where: { id: entityId },
    select: { id: true, userId: true },
  });
  if (!habit || habit.userId !== userId) {
    throw new ApplyError("Nawyk nie istnieje", 404);
  }

  // Retiring a habit is `active: false`, never a delete: the completion history
  // behind it is what every streak and every weekly summary is counted from.
  const data: Prisma.HabitUpdateInput =
    action === "deactivate" ? { active: false } : {};

  if (action === "update") {
    if (typeof payload.name === "string") data.name = payload.name;
    if (typeof payload.active === "boolean") data.active = payload.active;
    if (typeof payload.cue === "string") data.cue = payload.cue;
    if (typeof payload.routine === "string") data.routine = payload.routine;
    if (typeof payload.reward === "string") data.reward = payload.reward;
    if (typeof payload.why === "string") data.why = payload.why;
    if (typeof payload.identity === "string") data.identity = payload.identity;
    if (typeof payload.timeOfDay === "string") data.timeOfDay = payload.timeOfDay;
  }

  if (Object.keys(data).length === 0) {
    throw new ApplyError("Propozycja nie zawiera żadnej zmiany", 400);
  }

  await tx.habit.update({ where: { id: entityId }, data });
}

/**
 * Retires a weekly mentor plan.
 *
 * `MentorPlan` has no `active` column and the schema is frozen, so "switched off" is
 * a marker written into `notes`. Two things this deliberately is NOT:
 *  - a delete. The ticked tasks inside the plan are the only record that the work
 *    actually happened, and the user asked for exactly this ("zeby nie bylo tak, ze
 *    ja mu cos powiem, on usunie dane i pozniej jakies dane znikna");
 *  - a change to the tasks. Marking them "done" would be a lie about his week.
 *
 * `src/lib/ai/user-context.ts` is the only reader that acts on the marker, and the
 * plans screen keeps showing the plan with the note attached, which is the honest
 * state: it existed, it is no longer in play.
 */
async function applyMentorPlan(
  tx: Tx,
  userId: string,
  entityId: string | null,
): Promise<void> {
  if (!entityId) throw new ApplyError("Propozycja nie wskazuje planu", 400);

  const plan = await tx.mentorPlan.findUnique({
    where: { id: entityId },
    select: { id: true, userId: true, notes: true },
  });
  if (!plan || plan.userId !== userId) {
    throw new ApplyError("Plan nie istnieje", 404);
  }

  // Idempotent: accepting twice (or accepting a card for a plan the user already
  // switched off by hand) must not stack markers.
  if (plan.notes?.includes(MENTOR_PLAN_RETIRED_MARKER)) return;

  const existing = plan.notes?.trim();
  const stamp = new Date().toISOString().slice(0, 10);
  const marker = `${MENTOR_PLAN_RETIRED_MARKER} ${stamp}`;

  await tx.mentorPlan.update({
    where: { id: entityId },
    data: { notes: existing ? `${marker}\n${existing}` : marker },
  });
}

/**
 * Corrects one out-of-date sentence in a mentor's description.
 *
 * The safe path is `removeFragment` (+ optional `replaceWith`): the new text is
 * computed here, from the CURRENT prompt, so nothing outside the quoted fragment can
 * move. A full `systemPrompt` is accepted too, but only when it is not dramatically
 * shorter than what is already stored: the agent is shown a 900-character excerpt of
 * a prompt that can run to 19 000 characters, and "here is the rewritten version"
 * would otherwise delete everything it never saw.
 */
async function applyMentor(
  tx: Tx,
  userId: string,
  entityId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!entityId) throw new ApplyError("Propozycja nie wskazuje mentora", 400);

  const mentor = await tx.mentor.findUnique({
    where: { id: entityId },
    select: { id: true, userId: true, systemPrompt: true },
  });
  if (!mentor || mentor.userId !== userId) {
    throw new ApplyError("Mentor nie istnieje", 404);
  }

  const current = mentor.systemPrompt;
  let next: string | null = null;

  const fragment = typeof payload.removeFragment === "string" ? payload.removeFragment : null;
  if (fragment) {
    const raw = typeof payload.replaceWith === "string" ? payload.replaceWith : "";
    // A function replacement, so "$&", "$1" and friends inside the new sentence stay
    // literal text instead of being expanded by String.replace.
    const replacement = () => raw;
    if (current.includes(fragment)) {
      next = current.replace(fragment, replacement);
    } else {
      // The excerpt shown to the agent was whitespace-normalised, so an otherwise
      // correct quote can differ by a line break. Retry ignoring whitespace before
      // giving up; a fragment that still cannot be located is refused rather than
      // guessed at.
      const flexible = new RegExp(
        fragment
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\s+/g, "\\s+"),
      );
      if (flexible.test(current)) next = current.replace(flexible, replacement);
    }
    if (next === null) {
      throw new ApplyError(
        "Nie znaleziono tego fragmentu w opisie mentora. Opis został bez zmian.",
        409,
      );
    }
  } else if (typeof payload.systemPrompt === "string") {
    const proposed = payload.systemPrompt;
    if (proposed.length < current.length * 0.6) {
      throw new ApplyError(
        "Nowy opis mentora jest znacznie krótszy od obecnego. Opis został bez zmian.",
        400,
      );
    }
    next = proposed;
  }

  if (next === null || next.trim() === "") {
    throw new ApplyError("Propozycja nie zawiera żadnej zmiany", 400);
  }
  if (next === current) {
    throw new ApplyError("Propozycja nie zawiera żadnej zmiany", 400);
  }

  await tx.mentor.update({ where: { id: entityId }, data: { systemPrompt: next } });
}

async function applyProfile(
  tx: Tx,
  userId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(payload).length === 0) {
    throw new ApplyError("Propozycja nie zawiera żadnej zmiany", 400);
  }

  const existing = await tx.userProfile.findUnique({ where: { userId } });
  const existingData =
    existing?.data && typeof existing.data === "object" && !Array.isArray(existing.data)
      ? (existing.data as Record<string, unknown>)
      : {};

  // MERGE, never replace. The profile blob holds fields no agent knows about, and
  // writing the payload straight into `data` would silently drop every one of them.
  const merged = { ...existingData, ...payload } as Prisma.InputJsonValue;

  await tx.userProfile.upsert({
    where: { userId },
    create: { userId, data: merged },
    update: { data: merged },
  });
}

/* ------------------------------------------------------------------ */
/*  Handler                                                            */
/* ------------------------------------------------------------------ */

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }
  const userId = session.user.id;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const decision = (body?.decision ?? "").toString();
  if (decision !== "accept" && decision !== "reject") {
    return NextResponse.json(
      { error: 'decision musi być "accept" albo "reject"' },
      { status: 400 },
    );
  }

  // Scoped by userId in the query itself: somebody else's id answers 404 exactly
  // like a missing one, which is the only answer that does not confirm it exists.
  const existing = await prisma.changeProposal.findFirst({
    where: { id, userId },
    select: SELECT,
  });
  if (!existing) {
    return NextResponse.json({ error: "Propozycja nie istnieje" }, { status: 404 });
  }
  if (existing.status !== "pending") {
    return NextResponse.json(
      { error: "Ta propozycja została już rozstrzygnięta" },
      { status: 409 },
    );
  }

  /* ---------------- reject: touch nothing but the row ---------------- */
  if (decision === "reject") {
    const proposal = await prisma.changeProposal.update({
      where: { id },
      data: { status: "rejected", decidedAt: new Date() },
      select: SELECT,
    });
    // `skutek` is echoed on both paths so the screen renders one card shape.
    return NextResponse.json({
      proposal,
      skutek: readEffect(proposal.payload),
    });
  }

  /* ---------------- accept: status and data move together ------------ */
  const { entity, action } = existing;
  if (!isProposalEntity(entity) || !isProposalAction(action) || !isAllowedCombo(entity, action)) {
    return NextResponse.json(
      { error: "Nieznany typ zmiany, nic nie zostało zmienione" },
      { status: 400 },
    );
  }

  const sanitized = sanitizePayload(entity, action, existing.payload);
  if (sanitized === null) {
    return NextResponse.json(
      { error: "Propozycja nie zawiera dozwolonych zmian" },
      { status: 400 },
    );
  }
  // The display sentence is peeled off BEFORE any applier sees the payload. It
  // matters most for the profile, whose applier merges the payload into the blob
  // wholesale and would otherwise store a "skutek" field in the user's profile.
  const { effect, data: payload } = splitEffect(sanitized);

  try {
    const proposal = await prisma.$transaction(async (tx) => {
      // Conditional update = the lock that stops a double tap from applying twice:
      // the second call finds 0 rows still pending and the whole thing rolls back.
      const claimed = await tx.changeProposal.updateMany({
        where: { id, userId, status: "pending" },
        data: { status: "accepted", decidedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ApplyError("Ta propozycja została już rozstrzygnięta", 409);
      }

      switch (entity) {
        case "goal":
          await applyGoal(tx, userId, existing.entityId, payload);
          break;
        case "insight":
          await applyInsight(
            tx,
            userId,
            action,
            existing.entityId,
            payload,
            existing.sourceText,
          );
          break;
        case "habit":
          await applyHabit(tx, userId, action, existing.entityId, payload);
          break;
        case "profile":
          await applyProfile(tx, userId, payload);
          break;
        case "mentorPlan":
          await applyMentorPlan(tx, userId, existing.entityId);
          break;
        case "mentor":
          await applyMentor(tx, userId, existing.entityId, payload);
          break;
      }

      return tx.changeProposal.findUniqueOrThrow({ where: { id }, select: SELECT });
    });

    return NextResponse.json({ proposal, skutek: effect });
  } catch (err) {
    if (err instanceof ApplyError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Nie udało się zastosować zmiany. Dane pozostały bez zmian." },
      { status: 500 },
    );
  }
}
