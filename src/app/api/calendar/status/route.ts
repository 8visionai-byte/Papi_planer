import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { getCalendarStatus } from "@/lib/google/calendar";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  try {
    const status = await getCalendarStatus(session.user.id);
    return NextResponse.json(status);
  } catch (err) {
    console.warn("[calendar/status] error:", err);
    return NextResponse.json(
      {
        connected: false,
        scopes: [],
        hasRefreshToken: false,
        expiresAt: null,
      },
      { status: 200 },
    );
  }
}
