import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import {
  CALORIES_COMPONENT_KEY,
  CALORIE_DEFICIT_MAX,
  CALORIE_DEFICIT_MIN,
  readEnergyConfig,
  updateEnergyConfig,
  type EnergyConfigPatch,
  type EnergyConfigView,
} from "@/lib/energy";

/**
 * GET   /api/energy/config -> every pillar and component, including the switched-off
 *                             ones (the settings tab has to be able to switch them
 *                             back on) plus live weight sums for the "must be 100"
 *                             counter.
 * PATCH /api/energy/config -> weights, targets, tolerances, order, on/off.
 *
 * Rows are addressed by `id` or by `key`; keys are stable, so the client can send
 * `{ key: "woda-ml", target: 3000 }` without holding onto database ids.
 *
 * ONE target is special. The `kcal` row does not hold a goal, it holds the calorie
 * DEFICIT, and that deficit is the single knob behind the calorie goal of the whole
 * app (/dieta, /pulpit, /posilki, mentorzy). So editing it writes to
 * `UserProfile.data.calorieDeficit` — the value `lib/ai/body-metrics.ts` reads — and
 * only mirrors the same number onto the component row so the form shows what is
 * actually in force. `woda-ml` stays a plain row value: it is a ml/kg multiplier used
 * nowhere outside this module.
 */

/** Profile field holding the calorie deficit. Read by lib/ai/body-metrics.ts. */
const PROFILE_DEFICIT_KEY = "calorieDeficit";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Seeds the seven pillars if the user lands here before opening "Dziś".
    const config = await readEnergyConfig(session.user.id, { init: true });
    return NextResponse.json(config);
  } catch (err) {
    console.error("[api/energy/config] GET nie powiodlo sie:", err);
    return NextResponse.json(
      { pillars: [], totals: { pillars: 0, byPillar: {} }, degraded: true },
      { status: 200 }
    );
  }
}

function asArray(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object");
}

/** Component key of one patch entry: sent directly, or resolved from its database id. */
function resolveKey(
  raw: Record<string, unknown>,
  keyById: Map<string, string>
): string | null {
  if (typeof raw.key === "string" && raw.key) return raw.key;
  if (typeof raw.id === "string") return keyById.get(raw.id) ?? null;
  return null;
}

type DeficitRead =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

/**
 * The new calorie deficit, if this request touches it at all.
 *
 * Out-of-range values are REJECTED, not clamped: silently turning a typed 900 into
 * 700 would tell the user his pace was accepted when it was not.
 */
function readCalorieDeficit(
  patch: EnergyConfigPatch,
  keyById: Map<string, string>
): DeficitRead {
  let value: number | null = null;

  for (const raw of asArray(patch.components)) {
    if (raw.target === undefined || raw.target === null) continue;
    if (resolveKey(raw, keyById) !== CALORIES_COMPONENT_KEY) continue;

    const n = Number(raw.target);
    if (!Number.isFinite(n)) {
      return { ok: false, error: "Deficyt kaloryczny musi być liczbą." };
    }
    if (n < CALORIE_DEFICIT_MIN || n > CALORIE_DEFICIT_MAX) {
      return {
        ok: false,
        error: `Deficyt kaloryczny musi mieścić się w zakresie od ${CALORIE_DEFICIT_MIN} do ${CALORIE_DEFICIT_MAX} kcal. Dostałem ${Math.round(n)}.`,
      };
    }
    value = Math.round(n);
  }

  return { ok: true, value };
}

/**
 * Merge the deficit into `UserProfile.data`, never replace the object: that blob
 * holds the whole profile (waga, wzrost, dzieci, cele), and overwriting it would
 * erase everything the user ever filled in.
 */
async function saveCalorieDeficitToProfile(userId: string, deficit: number): Promise<void> {
  const existing = await prisma.userProfile.findUnique({
    where: { userId },
    select: { data: true },
  });
  const base =
    existing?.data && typeof existing.data === "object" && !Array.isArray(existing.data)
      ? (existing.data as Record<string, unknown>)
      : {};

  const merged = { ...base, [PROFILE_DEFICIT_KEY]: deficit } as Prisma.InputJsonValue;

  await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, data: merged },
    update: { data: merged },
  });
}

/** Ids of every component the user has, so a patch addressed by id can be understood. */
function keyByIdOf(config: EnergyConfigView): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of config.pillars) {
    for (const c of p.components) {
      if (c.id) map.set(c.id, c.key);
    }
  }
  return map;
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe dane." }, { status: 400 });
  }

  const patch: EnergyConfigPatch = {
    pillars: body?.pillars,
    components: body?.components,
  };

  try {
    // Read first, only to translate ids into keys — the calorie row must be
    // recognised whether the client addressed it by `key` or by `id`.
    const current = await readEnergyConfig(userId, { init: true });
    const deficit = readCalorieDeficit(patch, keyByIdOf(current));
    if (!deficit.ok) {
      return NextResponse.json({ error: deficit.error }, { status: 400 });
    }

    // Component rows first: they carry the rest of the validation (weights must sum
    // to 100). Writing the profile before that could leave a rejected save with the
    // deficit already changed.
    const result = await updateEnergyConfig(userId, patch);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    if (deficit.value !== null) {
      await saveCalorieDeficitToProfile(userId, deficit.value);
    }

    return NextResponse.json(result.config);
  } catch (err) {
    console.error("[api/energy/config] PATCH nie powiodlo sie:", err);
    return NextResponse.json(
      { error: "Nie udało się zapisać ustawień energii." },
      { status: 500 }
    );
  }
}
