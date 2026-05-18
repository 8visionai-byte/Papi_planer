import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

const BOOL_KEYS = ["showCalendarInPlan"] as const;
type BoolKey = (typeof BOOL_KEYS)[number];

function readProfileFlags(data: unknown): Record<BoolKey, boolean> {
  const out: Record<BoolKey, boolean> = { showCalendarInPlan: false };
  if (!data || typeof data !== "object") return out;
  const d = data as Record<string, unknown>;
  for (const k of BOOL_KEYS) {
    if (typeof d[k] === "boolean") out[k] = d[k] as boolean;
  }
  return out;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }
  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.user.id },
    select: { data: true },
  });
  return NextResponse.json(readProfileFlags(profile?.data));
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const patch: Partial<Record<BoolKey, boolean>> = {};
  for (const k of BOOL_KEYS) {
    if (typeof body[k] === "boolean") {
      patch[k] = body[k] as boolean;
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Brak pól do zapisania" },
      { status: 400 },
    );
  }

  const existing = await prisma.userProfile.findUnique({
    where: { userId: session.user.id },
    select: { data: true },
  });

  const currentData =
    existing?.data && typeof existing.data === "object" && !Array.isArray(existing.data)
      ? (existing.data as Record<string, unknown>)
      : {};

  const nextData = { ...currentData, ...patch };

  await prisma.userProfile.upsert({
    where: { userId: session.user.id },
    update: { data: nextData },
    create: { userId: session.user.id, data: nextData },
  });

  return NextResponse.json(readProfileFlags(nextData));
}
