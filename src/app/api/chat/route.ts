import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { anthropic, MODELS, DEFAULTS } from "@/lib/ai/claude";
import { createSSEStream } from "@/lib/ai/streaming";
import { buildMentorContext } from "@/lib/ai/mentor";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let mentorId: string;
  let message: string;

  try {
    const body = await request.json();
    mentorId = body.mentorId;
    message = body.message;

    if (!mentorId || !message) {
      return NextResponse.json(
        { error: "mentorId and message are required" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const ctx = await buildMentorContext(mentorId, session.user.id);

    const systemContent = [
      ctx.systemPrompt,
      "",
      "---",
      "",
      "## Kontekst użytkownika",
      ctx.userContext,
    ].join("\n");

    const stream = anthropic.messages.stream({
      model: MODELS.CHAT,
      max_tokens: DEFAULTS.CHAT_MAX_TOKENS,
      temperature: DEFAULTS.CREATIVE_TEMPERATURE,
      system: systemContent,
      messages: [{ role: "user", content: message }],
    });

    const sseStream = createSSEStream(stream);

    return new Response(sseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const errMessage =
      err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: errMessage }, { status: 500 });
  }
}
