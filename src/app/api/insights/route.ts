/**
 * "Wnioski" screen API - the user-facing side of the long-term memory.
 *
 *  GET    /api/insights            list active insights (add ?includeInactive=1 for all)
 *  PATCH  /api/insights            { id, active } - "To nieprawda" flips active to false
 *  POST   /api/insights            { kind?, title, content } - the user states a fact about themselves
 *
 * Insights are never hard-deleted here. Deactivating is how the user corrects what
 * the app believes about them: the row stays for auditing, but `getActiveInsights`
 * stops feeding it to the mentors.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

/** Kinds a human may create by hand. "weekly_summary" is generated only. */
const USER_WRITABLE_KINDS = ["preference", "pattern", "milestone"] as const;

const SELECT = {
  id: true,
  kind: true,
  period: true,
  title: true,
  content: true,
  evidence: true,
  confidence: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const includeInactive = req.nextUrl.searchParams.get("includeInactive") === "1";

  try {
    const insights = await prisma.userInsight.findMany({
      where: {
        userId: session.user.id,
        ...(includeInactive ? {} : { active: true }),
      },
      orderBy: [{ active: "desc" }, { confidence: "desc" }, { createdAt: "desc" }],
      select: SELECT,
      take: 200,
    });
    return NextResponse.json({ insights });
  } catch {
    // Table missing (migration not run yet) must not blow up the screen.
    return NextResponse.json({ insights: [] });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const existing = await prisma.userInsight.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Default action is deactivation ("To nieprawda"); pass active:true to restore.
  const active = typeof body.active === "boolean" ? body.active : false;

  const insight = await prisma.userInsight.update({
    where: { id },
    data: { active },
    select: SELECT,
  });
  return NextResponse.json({ insight });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const title = (body?.title ?? "").toString().trim();
  const content = (body?.content ?? "").toString().trim();
  if (!content) {
    return NextResponse.json({ error: "Treść jest wymagana" }, { status: 400 });
  }

  const kindRaw = (body?.kind ?? "preference").toString();
  const kind = (USER_WRITABLE_KINDS as readonly string[]).includes(kindRaw)
    ? kindRaw
    : "preference";

  const insight = await prisma.userInsight.create({
    data: {
      userId: session.user.id,
      kind,
      // Hand-written insights are open-ended, so they never collide with the
      // (userId, kind, period) unique index used by weekly summaries.
      period: null,
      title: title ? title.slice(0, 80) : content.slice(0, 60),
      content: content.slice(0, 1200),
      // The user said it about themselves - nothing is more reliable than that.
      evidence: { source: "user" } as unknown as Prisma.InputJsonValue,
      confidence: 1,
      active: true,
    },
    select: SELECT,
  });

  return NextResponse.json({ insight });
}
