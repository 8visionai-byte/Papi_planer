import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

/**
 * One saved meal idea.
 *
 * PATCH  { rating?: -1|0|1, favorite?: boolean, cooked?: true }
 * DELETE
 *
 * `cooked: true` is a counter bump, not a value the client sets: the server
 * increments `timesCooked` and stamps `lastCookedAt`. The client never sends the
 * count, so two taps from two tabs cannot overwrite each other.
 *
 * Ownership is checked with a `findFirst({ id, userId })` before every write -
 * the id alone comes from the URL and must never be trusted.
 */

function clampRating(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (n === 1) return 1;
  if (n === -1) return -1;
  if (n === 0) return 0;
  return undefined;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  try {
    const existing = await prisma.mealIdea.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Nie znaleziono pomysłu" }, { status: 404 });
    }

    const rating = clampRating(body.rating);
    const favorite = typeof body.favorite === "boolean" ? body.favorite : undefined;
    const cooked = body.cooked === true;

    if (rating === undefined && favorite === undefined && !cooked) {
      return NextResponse.json({ error: "Brak zmian do zapisania" }, { status: 400 });
    }

    const idea = await prisma.mealIdea.update({
      where: { id },
      data: {
        ...(rating !== undefined ? { rating } : {}),
        ...(favorite !== undefined ? { favorite } : {}),
        ...(cooked ? { timesCooked: { increment: 1 }, lastCookedAt: new Date() } : {}),
      },
    });

    return NextResponse.json({ idea });
  } catch (err) {
    console.error("[meal-ideas] PATCH failed", err);
    return NextResponse.json({ error: "Nie udało się zapisać zmiany" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  try {
    const existing = await prisma.mealIdea.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Nie znaleziono pomysłu" }, { status: 404 });
    }

    await prisma.mealIdea.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[meal-ideas] DELETE failed", err);
    return NextResponse.json({ error: "Nie udało się usunąć pomysłu" }, { status: 500 });
  }
}
