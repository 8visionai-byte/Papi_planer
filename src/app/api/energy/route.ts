import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import {
  buildEnergyDay,
  parseDateKey,
  patchEnergyDay,
  polishDateKey,
  type EnergyPatch,
} from "@/lib/energy";

/**
 * GET  /api/energy?date=YYYY-MM-DD  -> the whole day, spec section 4.
 * PATCH /api/energy                 -> merge manual values, rescore, return the same shape.
 *
 * The day is always a Warsaw calendar day: the container runs on UTC, so "today" is
 * resolved through `polishDateKey`, never through `new Date()`.
 */

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = req.nextUrl.searchParams.get("date");
  const dateKey = parseDateKey(raw) ?? polishDateKey();

  try {
    // init: true -> the seven pillars are seeded on first visit (lazy initialisation).
    const day = await buildEnergyDay(session.user.id, dateKey, { init: true });
    return NextResponse.json(day);
  } catch (err) {
    console.error("[api/energy] GET nie powiodlo sie:", err);
    return NextResponse.json(
      { error: "Nie udało się wczytać energii dnia." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane." }, { status: 400 });
  }

  const dateKey = parseDateKey(body?.date) ?? polishDateKey();

  const patch: EnergyPatch = {
    values: body?.values,
    feltEnergy: body?.feltEnergy,
    note: body?.note,
  };

  try {
    const day = await patchEnergyDay(session.user.id, dateKey, patch);
    return NextResponse.json(day);
  } catch (err) {
    console.error("[api/energy] PATCH nie powiodlo sie:", err);
    return NextResponse.json({ error: "Nie udało się zapisać dnia." }, { status: 500 });
  }
}
