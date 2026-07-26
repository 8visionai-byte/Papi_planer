/**
 * GET /api/roundtable/status/[id]
 *
 * The screen's only window into a debate that runs in the background. Poll it
 * every couple of seconds while the status is "running"; everything already
 * produced is in `events`, so a phone that slept through round 2 catches up in
 * one request instead of losing the debate.
 *
 * Next.js 16: `params` is a Promise, see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import {
  extractEssence,
  isStaleRunning,
  readAppliedIndexes,
  readPlanChanges,
  STALE_MESSAGE,
} from "@/lib/roundtable/runner";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const { id } = await params;

  // Scoped by userId inside the query: somebody else's debate answers 404
  // exactly like a missing one, which is the only answer that does not confirm
  // it exists.
  const row = await prisma.roundTableSession.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      inputText: true,
      inputType: true,
      status: true,
      error: true,
      consensus: true,
      debateTranscript: true,
      planChanges: true,
      applied: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  if (!row) {
    return NextResponse.json({ error: "Nie znaleziono debaty" }, { status: 404 });
  }

  // A row stuck in "running" with an old heartbeat means the container went down
  // mid debate. Reported as an error, never repaired here: a GET must not write.
  const stale = isStaleRunning(row.status, row.updatedAt);
  const status = stale ? "error" : row.status;
  const error = stale ? STALE_MESSAGE : row.error;

  const changes = readPlanChanges(row.planChanges);

  return NextResponse.json({
    sessionId: row.id,
    status,
    error,
    // The question, so a screen restored after a full reload can show it back.
    inputText: row.inputText,
    inputType: row.inputType,
    events: Array.isArray(row.debateTranscript) ? row.debateTranscript : [],
    consensus: row.consensus,
    essence: extractEssence(row.debateTranscript),
    planChanges: changes,
    appliedIndexes: readAppliedIndexes(row.planChanges, changes.length, row.applied),
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  });
}
