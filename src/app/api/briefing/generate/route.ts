import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS, DEFAULTS } from "@/lib/ai/claude";
import { BRIEFING_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { buildBriefingContext } from "@/lib/briefing/generator";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Accept regenerate flag either via JSON body or ?force=true query for backward compat.
  const url = new URL(request.url);
  const forceFromQuery = url.searchParams.get("force") === "true";
  let regenerate = forceFromQuery;
  try {
    const body = await request.clone().json();
    if (body && typeof body === "object" && body.regenerate === true) {
      regenerate = true;
    }
  } catch {
    // No body or not JSON — that's fine, default regenerate=false
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const existing = await prisma.briefing.findUnique({
    where: { userId_date: { userId, date: todayStart } },
  });

  // If briefing exists for today AND not regenerating — return it as-is via SSE.
  if (existing && !regenerate) {
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

  // Regenerate: drop the old briefing so we start clean (also wipes the stale audio link).
  if (existing && regenerate) {
    await prisma.briefing.delete({ where: { id: existing.id } });
  }

  try {
    const context = await buildBriefingContext(userId);

    const userMessage = `Oto pelny kontekst dnia uzytkownika do podsumowania:\n\n${context}\n\nWygeneruj wieczorne podsumowanie dnia wedlug instrukcji w system prompt. Pamietaj o refleksjach 2-3 mentorow.`;

    const stream = anthropic.messages.stream({
      model: MODELS.CHAT,
      max_tokens: DEFAULTS.BRIEFING_MAX_TOKENS,
      temperature: DEFAULTS.CREATIVE_TEMPERATURE,
      system: BRIEFING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

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
