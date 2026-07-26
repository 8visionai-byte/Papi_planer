import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { suggestHabitLoop, type HabitKind } from "@/lib/ai/habit-coach";

/**
 * POST /api/habits/suggest
 *
 * Body: { name, description?, timeOfDay?, kind?, replaces? }
 * Answer: { suggestion } or { suggestion: null }.
 *
 * Deliberately answers 200 with `suggestion: null` when the model fails: the form uses
 * this to fill empty fields, so a coaching hiccup must never block saving a habit.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const name = (body?.name ?? "").toString().trim();
  if (!name) {
    return NextResponse.json({ error: "Nazwa jest wymagana" }, { status: 400 });
  }

  const kindRaw = (body?.kind ?? "build").toString();
  const kind: HabitKind = kindRaw === "replace" ? "replace" : "build";

  const suggestion = await suggestHabitLoop(session.user.id, {
    name,
    description: body?.description ? body.description.toString().trim() : null,
    timeOfDay: body?.timeOfDay ? body.timeOfDay.toString() : null,
    kind,
    replaces: body?.replaces ? body.replaces.toString().trim() : null,
  });

  return NextResponse.json({ suggestion });
}
