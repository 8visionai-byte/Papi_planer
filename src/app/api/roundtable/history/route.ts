/**
 * GET /api/roundtable/history
 *
 * Last 50 debates. Besides the raw columns it returns three derived fields so the
 * screen does not have to dig through `debateTranscript` on the client:
 *  - `essence`       the structured summary, when the session has one
 *  - `appliedIndexes` which proposals already landed in the plan
 *  - `changeCount`    how many proposals the session carries
 *
 * Sessions recorded before the essence existed simply return `essence: null` and
 * the screen falls back to the consensus text, exactly as before.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import type { RoundTableEssence } from "@/lib/roundtable/engine";

/** Pull the `essence` event out of a stored transcript. */
function extractEssence(transcript: unknown): RoundTableEssence | null {
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

function changeCount(planChanges: unknown): number {
  if (!planChanges || typeof planChanges !== "object") return 0;
  const changes = (planChanges as { changes?: unknown }).changes;
  return Array.isArray(changes) ? changes.length : 0;
}

/**
 * Same rule as the apply route: an explicit list wins, otherwise the legacy
 * boolean means "all of them".
 */
function appliedIndexes(planChanges: unknown, total: number, legacyApplied: boolean): number[] {
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

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessions = await prisma.roundTableSession.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      inputText: true,
      inputType: true,
      consensus: true,
      debateTranscript: true,
      planChanges: true,
      applied: true,
      createdAt: true,
    },
  });

  const enriched = sessions.map((s) => {
    const total = changeCount(s.planChanges);
    return {
      ...s,
      essence: extractEssence(s.debateTranscript),
      changeCount: total,
      appliedIndexes: appliedIndexes(s.planChanges, total, s.applied),
    };
  });

  return NextResponse.json(enriched);
}
