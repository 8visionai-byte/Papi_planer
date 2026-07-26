/**
 * "Wnioski" screen API - the user-facing side of the long-term memory.
 *
 *  GET    /api/insights            list active insights (add ?includeInactive=1 for all)
 *  PATCH  /api/insights            { id, active } - "To nieprawda" flips active to false
 *  POST   /api/insights            { kind?, title?, content } - the user states a fact about themselves
 *
 * Insights are never hard-deleted here. Deactivating is how the user corrects what
 * the app believes about them: the row stays for auditing, but `getActiveInsights`
 * stops feeding it to the mentors.
 *
 * A row written through POST always carries `origin: "user"`, which is what the
 * screen uses to badge it "Twoj wpis" and what tells the mentors that a human said
 * this, not the weekly agent.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Kinds a human may create by hand. "weekly_summary" is generated only.
 * "user_note" is the default: a free statement the user makes about themselves,
 * which does not pretend to be a computed pattern or preference.
 */
const USER_WRITABLE_KINDS = ["user_note", "preference", "pattern", "milestone"] as const;

const SELECT = {
  id: true,
  kind: true,
  origin: true,
  period: true,
  title: true,
  content: true,
  evidence: true,
  confidence: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * First sentence (or first words) of the note, used when the user did not bother
 * with a title. Cutting at a sentence boundary reads far better on a card than a
 * hard 60-character chop in the middle of a word.
 */
function titleFromContent(content: string): string {
  const firstSentence = content.split(/(?<=[.!?])\s/)[0]?.trim() ?? content;
  const base = firstSentence.length > 0 ? firstSentence : content;
  if (base.length <= 60) return base;
  const cut = base.slice(0, 60);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 24 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

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

  const kindRaw = (body?.kind ?? "user_note").toString();
  const kind = (USER_WRITABLE_KINDS as readonly string[]).includes(kindRaw)
    ? kindRaw
    : "user_note";

  try {
    const insight = await prisma.userInsight.create({
      data: {
        userId: session.user.id,
        kind,
        // "user" outranks "app" everywhere the memory is read: the person beats
        // the weekly agent on any subject they disagree about.
        origin: "user",
        // Hand-written insights are open-ended, so `period` stays null. Postgres
        // treats every NULL as distinct inside the (userId, kind, period) unique
        // index, so any number of notes coexist - verified below by handling P2002
        // anyway, because a future non-null period would collide silently.
        period: null,
        title: title ? title.slice(0, 80) : titleFromContent(content),
        content: content.slice(0, 1200),
        // The user said it about themselves - nothing is more reliable than that.
        evidence: { source: "user" } as unknown as Prisma.InputJsonValue,
        confidence: 1,
        active: true,
      },
      select: SELECT,
    });

    return NextResponse.json({ insight });
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      return NextResponse.json(
        { error: "Masz już wpis tego rodzaju z tego okresu. Zmień treść albo rodzaj." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Nie udało się zapisać wniosku." }, { status: 500 });
  }
}
