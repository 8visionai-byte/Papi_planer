import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import {
  CalendarError,
  getCalendarEvents,
} from "@/lib/google/calendar";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  let from: Date | undefined;
  let to: Date | undefined;
  if (fromParam) {
    const d = new Date(fromParam);
    if (!isNaN(d.getTime())) from = d;
  }
  if (toParam) {
    const d = new Date(toParam);
    if (!isNaN(d.getTime())) to = d;
  }

  try {
    const events = await getCalendarEvents(session.user.id, { from, to });
    return NextResponse.json({ connected: true, events });
  } catch (err) {
    if (err instanceof CalendarError) {
      const status =
        err.code === "not_connected" || err.code === "missing_scope"
          ? 200
          : 502;
      return NextResponse.json(
        {
          connected: false,
          error: err.message,
          code: err.code,
          events: [],
        },
        { status },
      );
    }
    console.warn("[calendar/events] unexpected:", err);
    return NextResponse.json(
      {
        connected: false,
        error: "Nieznany błąd Kalendarza",
        code: "unknown",
        events: [],
      },
      { status: 500 },
    );
  }
}
