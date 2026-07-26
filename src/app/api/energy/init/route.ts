import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { ensureEnergySetup, readEnergyConfig } from "@/lib/energy";

/**
 * POST /api/energy/init
 *
 * Creates the seven pillars and their components when the user has none. Idempotent:
 * calling it twice creates nothing the second time and never overwrites a weight,
 * target or tolerance the user has already tuned. GET /api/energy calls the same
 * function lazily, so this endpoint is only for an explicit "odbuduj filary".
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const created = await ensureEnergySetup(session.user.id);
    const config = await readEnergyConfig(session.user.id, { init: false });
    return NextResponse.json({ ok: true, created, config });
  } catch (err) {
    console.error("[api/energy/init] POST nie powiodlo sie:", err);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Nie udało się założyć filarów energii. Tabele mogą jeszcze nie istnieć w bazie.",
      },
      { status: 500 }
    );
  }
}
