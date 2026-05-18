import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { disconnectGoogleCalendar } from "@/lib/google/calendar";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }
  try {
    await disconnectGoogleCalendar(session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn("[calendar/disconnect] error:", err);
    return NextResponse.json(
      { ok: false, error: "Nie udało się rozłączyć" },
      { status: 500 },
    );
  }
}
