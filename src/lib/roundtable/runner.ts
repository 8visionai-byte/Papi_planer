/**
 * Background runner for the Round Table.
 *
 * The debate used to be generated INSIDE the HTTP response stream
 * (`ReadableStream` in app/api/roundtable/route.ts). Locking the phone or
 * switching apps killed the socket, the stream closed, and every model call made
 * so far was lost with it: nothing was written to the database until the very
 * last step. The user saw "internet error" while still sitting on Wi-Fi.
 *
 * Now the row is created FIRST, with `status: "running"`, and the generator is
 * consumed by a task detached from the request. Every event is appended to
 * `debateTranscript` right away, so a debate is never worth less than the events
 * it already produced. The screen only polls `GET /api/roundtable/status/[id]`.
 *
 * The app runs in a long lived container (`next start`), so the detached promise
 * keeps going after the response has been sent. A container restart is the one
 * case it cannot survive, and that is what `isStaleRunning` is for.
 */

import { prisma } from "@/lib/db/prisma";
import {
  runRoundTable,
  type RoundTableEssence,
  type RoundTableEvent,
  type RoundTablePlanChange,
  type RoundTablePlanChanges,
} from "@/lib/roundtable/engine";
import type { Prisma } from "@/generated/prisma/client";

/**
 * A row still marked "running" but untouched for this long can only mean the
 * container went down mid debate: the runner refreshes `updatedAt` on every
 * single event, and the longest gap between two events is one model call.
 */
export const RUNNING_STALE_MS = 10 * 60 * 1000;

export const STALE_MESSAGE =
  "Debata została przerwana, zanim się skończyła. Możesz ją uruchomić jeszcze raz.";

/* ------------------------------------------------------------------ */
/*  Small shared helpers (also used by the status endpoint)            */
/* ------------------------------------------------------------------ */

/** Prisma wants a plain JSON value, and the events carry only plain data. */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** True when a "running" row has gone quiet long enough to be considered dead. */
export function isStaleRunning(status: string, updatedAt: Date): boolean {
  if (status !== "running") return false;
  return Date.now() - updatedAt.getTime() > RUNNING_STALE_MS;
}

/**
 * Pull the `essence` event out of a stored transcript.
 * Same shape as the one in api/roundtable/history, kept here so the status
 * endpoint does not have to import from another route file.
 */
export function extractEssence(transcript: unknown): RoundTableEssence | null {
  if (!Array.isArray(transcript)) return null;
  for (const entry of transcript) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { type?: unknown; essence?: unknown };
    if (e.type !== "essence" || !e.essence || typeof e.essence !== "object") continue;
    const raw = e.essence as Record<string, unknown>;
    if (typeof raw.answer !== "string" || !raw.answer.trim()) continue;
    return {
      answer: raw.answer,
      agreements: Array.isArray(raw.agreements)
        ? raw.agreements.filter((x): x is string => typeof x === "string")
        : [],
      tensions: Array.isArray(raw.tensions)
        ? raw.tensions
            .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === "object")
            .map((t) => ({
              point: typeof t.point === "string" ? t.point : "",
              sides: typeof t.sides === "string" ? t.sides : "",
            }))
        : [],
      steps: Array.isArray(raw.steps)
        ? raw.steps.filter((x): x is string => typeof x === "string")
        : [],
      closing: typeof raw.closing === "string" ? raw.closing : "",
    };
  }
  return null;
}

/** Proposals stored inside `RoundTableSession.planChanges`. */
export function readPlanChanges(raw: unknown): RoundTablePlanChange[] {
  if (!raw || typeof raw !== "object") return [];
  const changes = (raw as { changes?: unknown }).changes;
  if (!Array.isArray(changes)) return [];
  return changes.filter(
    (c): c is RoundTablePlanChange =>
      Boolean(c) && typeof c === "object" && typeof (c as { title?: unknown }).title === "string"
  );
}

/**
 * Which proposals already landed in the plan.
 * Same rule as the apply and history routes: an explicit list wins, otherwise
 * the legacy `applied` boolean means "all of them".
 */
export function readAppliedIndexes(
  planChanges: unknown,
  total: number,
  legacyApplied: boolean
): number[] {
  const stored =
    planChanges && typeof planChanges === "object"
      ? (planChanges as { applied?: unknown }).applied
      : undefined;

  if (Array.isArray(stored)) {
    const set = new Set<number>();
    for (const v of stored) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n < total) set.add(n);
    }
    if (set.size > 0 || !legacyApplied) return Array.from(set).sort((a, b) => a - b);
  }

  return legacyApplied ? Array.from({ length: total }, (_, i) => i) : [];
}

/* ------------------------------------------------------------------ */
/*  The background task                                                */
/* ------------------------------------------------------------------ */

async function consumeDebate(
  sessionId: string,
  userId: string,
  input: string,
  mentorIds: string[] | undefined
): Promise<void> {
  // The transcript lives in memory and is rewritten whole on every event. Only
  // this task writes this row, so there is no read-modify-write race to lose.
  const events: RoundTableEvent[] = [];
  let consensusText: string | null = null;
  let planChanges: RoundTablePlanChange[] = [];
  let hasEssence = false;
  let errorText: string | null = null;
  /** The duplicate row `engine.ts` still creates for itself at the end. */
  let engineSessionId: string | null = null;

  try {
    for await (const event of runRoundTable(input, userId, mentorIds)) {
      if (event.type === "done") {
        engineSessionId = event.sessionId;
        continue;
      }

      if (event.type === "error") {
        // An error AFTER the essence can only come from the engine writing its
        // own (now redundant) row. The answer is already saved here, so it must
        // not turn a finished debate into a failed one.
        if (!hasEssence) errorText = event.error;
        continue;
      }

      events.push(event);

      const data: Prisma.RoundTableSessionUpdateInput = {
        debateTranscript: toJson(events),
      };

      if (event.type === "consensus") {
        consensusText = event.content;
        data.consensus = event.content;
      }
      if (event.type === "essence") {
        hasEssence = true;
      }
      if (event.type === "plan_changes") {
        planChanges = event.changes;
        const payload: RoundTablePlanChanges = {
          version: "rt-v1",
          changes: planChanges,
          applied: [],
        };
        data.planChanges = toJson(payload);
      }

      // `updatedAt` is @updatedAt, so this doubles as the heartbeat that
      // `isStaleRunning` reads.
      await prisma.roundTableSession.update({ where: { id: sessionId }, data });
    }
  } catch (err) {
    errorText = err instanceof Error ? err.message : "Nieznany błąd podczas debaty";
  }

  /* ---------------- final state ---------------- */

  try {
    await prisma.roundTableSession.update({
      where: { id: sessionId },
      data: {
        status: errorText ? "error" : "done",
        error: errorText,
        debateTranscript: toJson(events),
        consensus: consensusText,
        ...(planChanges.length > 0
          ? {
              planChanges: toJson({
                version: "rt-v1",
                changes: planChanges,
                applied: [],
              } satisfies RoundTablePlanChanges),
            }
          : {}),
      },
    });
  } catch (err) {
    console.error("[roundtable/runner] final update failed", err);
  }

  // `engine.ts` still creates its own RoundTableSession row on the last step and
  // reports it through the `done` event. That row is a duplicate of this one:
  // the client polls the id returned by `startRoundTable`, and this task has
  // already written the whole transcript here. Dropping it keeps the history
  // clean. Scoped by userId, and never this row.
  if (engineSessionId && engineSessionId !== sessionId) {
    try {
      await prisma.roundTableSession.deleteMany({
        where: { id: engineSessionId, userId },
      });
    } catch (err) {
      console.error("[roundtable/runner] duplicate session cleanup failed", err);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Public entry point                                                 */
/* ------------------------------------------------------------------ */

/**
 * Create the session row, start the debate in the background and return
 * immediately. Nothing about the result is awaited here: the caller answers the
 * HTTP request with the id, and the screen polls the status endpoint.
 *
 * Parallel debates for the same user are allowed. Each gets its own row, and
 * the screen simply watches the id it started (or the one it stored last).
 */
export async function startRoundTable(
  userId: string,
  input: string,
  mentorIds?: string[],
  inputType: "text" | "voice" = "text"
): Promise<{ sessionId: string }> {
  const session = await prisma.roundTableSession.create({
    data: {
      userId,
      inputText: input,
      inputType,
      status: "running",
      // An empty array, not null: the status endpoint and the history screen
      // both expect a list they can iterate from the first poll onwards.
      debateTranscript: [],
    },
    select: { id: true },
  });

  // Deliberately NOT awaited. The container is long lived (`next start`), so the
  // task keeps running after this function returns and after the HTTP response
  // has been sent. `consumeDebate` swallows its own failures, the catch here is
  // the last resort against an unhandled rejection taking the process down.
  void consumeDebate(session.id, userId, input, mentorIds).catch((err) => {
    console.error("[roundtable/runner] background task crashed", err);
  });

  return { sessionId: session.id };
}
