/**
 * Change proposals: the "czy akceptujesz?" queue between an agent and the data.
 *
 *  GET   /api/proposals            pending proposals, newest first
 *  POST  /api/proposals            { sourceText } - ask the memory agent what should
 *                                  change, park the answer as pending rows
 *
 * Nothing here writes to a goal, an insight, a habit or the profile. Creating a
 * proposal is deliberately inert: the only place a proposal becomes a real change
 * is PATCH /api/proposals/[id] with { decision: "accept" }, after the user has read
 * the sentence and tapped yes.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { proposeChangesFromNote } from "@/lib/ai/memory-agent";
import type { Prisma } from "@/generated/prisma/client";

// Kept local, not exported: a route.ts may only export HTTP handlers and route
// segment config, anything else fails the generated route type check.
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

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  // Default view is the queue itself; ?status=all is for the history screen.
  const statusParam = req.nextUrl.searchParams.get("status") ?? "pending";
  const status = ["pending", "accepted", "rejected"].includes(statusParam)
    ? statusParam
    : null;

  try {
    const proposals = await prisma.changeProposal.findMany({
      where: { userId: session.user.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      select: SELECT,
      take: 50,
    });
    return NextResponse.json({ proposals });
  } catch {
    // Table missing (migration not run yet) must not take down the Wnioski screen.
    return NextResponse.json({ proposals: [] });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const sourceText = (body?.sourceText ?? "").toString().trim();
  if (!sourceText) {
    return NextResponse.json({ error: "sourceText jest wymagany" }, { status: 400 });
  }

  const changes = await proposeChangesFromNote(session.user.id, sourceText.slice(0, 2000));
  if (changes.length === 0) {
    // An empty list is a correct answer, not a failure: most notes change nothing.
    return NextResponse.json({ proposals: [] });
  }

  try {
    const proposals = await prisma.$transaction(
      changes.map((c) =>
        prisma.changeProposal.create({
          data: {
            userId: session.user.id as string,
            sourceText: sourceText.slice(0, 2000),
            entity: c.entity,
            entityId: c.entityId,
            action: c.action,
            summary: c.summary,
            payload: c.payload as Prisma.InputJsonValue,
            status: "pending",
          },
          select: SELECT,
        }),
      ),
    );
    return NextResponse.json({ proposals });
  } catch {
    return NextResponse.json(
      { error: "Nie udało się zapisać propozycji zmian." },
      { status: 500 },
    );
  }
}
