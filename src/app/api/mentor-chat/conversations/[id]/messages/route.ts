import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { anthropic } from "@/lib/ai/claude";

const MAX_TOKENS = 1500;
const HISTORY_LIMIT = 20;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const { id } = await params;

  let content: string;
  try {
    const body = await request.json();
    content = body.content;
    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "content wymagany" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  try {
    const conv = await prisma.mentorConversation.findFirst({
      where: { id, userId: session.user.id },
      include: {
        mentor: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!conv) {
      return NextResponse.json({ error: "Konwersacja nie znaleziona" }, { status: 404 });
    }

    // Build history (last N messages) + new user message
    const recent = conv.messages.slice(-HISTORY_LIMIT);
    const aiMessages: { role: "user" | "assistant"; content: string }[] = [
      ...recent.map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      })),
      { role: "user", content: content.trim() },
    ];

    const aiResp = await anthropic.messages.create({
      model: conv.mentor.model || "claude-sonnet-4-6",
      max_tokens: MAX_TOKENS,
      system: conv.mentor.systemPrompt,
      messages: aiMessages,
    });

    const assistantText = aiResp.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");

    // Persist user + assistant messages; touch updatedAt
    const [userMsg, assistantMsg] = await prisma.$transaction([
      prisma.mentorChatMessage.create({
        data: { conversationId: id, role: "user", content: content.trim() },
      }),
      prisma.mentorChatMessage.create({
        data: { conversationId: id, role: "assistant", content: assistantText },
      }),
    ]);

    await prisma.mentorConversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({
      userMessage: {
        id: userMsg.id,
        role: userMsg.role,
        content: userMsg.content,
        createdAt: userMsg.createdAt,
      },
      assistantMessage: {
        id: assistantMsg.id,
        role: assistantMsg.role,
        content: assistantMsg.content,
        createdAt: assistantMsg.createdAt,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
