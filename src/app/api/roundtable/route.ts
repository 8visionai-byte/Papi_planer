/**
 * POST /api/roundtable
 * Body: { text: string, inputType?: "text" | "voice", mentorIds?: string[] }
 * Answers { sessionId } straight away, with 202.
 *
 * This endpoint used to stream the whole debate as SSE and generate it inside
 * the response body. A locked phone closed the socket and the work died with it.
 * The debate now runs in the background (see lib/roundtable/runner.ts) and the
 * screen follows it through GET /api/roundtable/status/[id].
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { startRoundTable } from "@/lib/roundtable/runner";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let text: string;
  let inputType: "text" | "voice" = "text";
  let mentorIds: string[] | undefined;

  try {
    const body = await request.json();
    text = body.text;
    if (body.inputType === "voice" || body.inputType === "text") inputType = body.inputType;
    if (Array.isArray(body.mentorIds)) {
      mentorIds = body.mentorIds.filter(
        (id: unknown): id is string => typeof id === "string"
      );
    }

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json(
        { error: "text is required" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const { sessionId } = await startRoundTable(
      session.user.id,
      text.trim(),
      mentorIds,
      inputType
    );
    // 202: accepted and running, the result is somewhere else.
    return NextResponse.json({ sessionId }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Nieznany błąd";
    return NextResponse.json(
      { error: `Nie udało się uruchomić debaty: ${message}` },
      { status: 500 }
    );
  }
}
