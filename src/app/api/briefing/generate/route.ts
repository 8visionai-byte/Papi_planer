import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS, DEFAULTS } from "@/lib/ai/claude";
import { createSSEStream } from "@/lib/ai/streaming";
import { BRIEFING_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { buildBriefingContext } from "@/lib/briefing/generator";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

  // Check if briefing already exists for today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  if (!force) {
    const existing = await prisma.briefing.findUnique({
      where: { userId_date: { userId, date: todayStart } },
    });

    if (existing) {
      // Return existing briefing as a single SSE event
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "text_delta", text: existing.content })}\n\n`
            )
          );
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "done", text: existing.content, briefingId: existing.id })}\n\n`
            )
          );
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }
  }

  try {
    const context = await buildBriefingContext(userId);

    const userMessage = `Oto kontekst uzytkownika:\n\n${context}\n\nWygeneruj spersonalizowany poranny briefing.`;

    const stream = anthropic.messages.stream({
      model: MODELS.CHAT,
      max_tokens: DEFAULTS.BRIEFING_MAX_TOKENS,
      temperature: DEFAULTS.CREATIVE_TEMPERATURE,
      system: BRIEFING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    // We need to both stream to client AND accumulate for DB save
    let fullText = "";
    const encoder = new TextEncoder();

    const sseStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              const text = event.delta.text;
              fullText += text;
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "text_delta", text })}\n\n`
                )
              );
            }
          }

          // Save to DB after streaming completes
          const briefing = await prisma.briefing.upsert({
            where: { userId_date: { userId, date: todayStart } },
            create: {
              userId,
              date: todayStart,
              content: fullText,
            },
            update: {
              content: fullText,
              audioUrl: null, // reset audio on regenerate
            },
          });

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "done", text: fullText, briefingId: briefing.id })}\n\n`
            )
          );
          controller.close();
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown streaming error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", error: message })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

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
