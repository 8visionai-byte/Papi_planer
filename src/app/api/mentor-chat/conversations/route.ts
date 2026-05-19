import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { anthropic } from "@/lib/ai/claude";

const MAX_TOKENS = 1500;

function makeTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 60) return cleaned;
  return cleaned.slice(0, 60) + "…";
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const mentorId = searchParams.get("mentorId");
  if (!mentorId) {
    return NextResponse.json({ error: "mentorId wymagany" }, { status: 400 });
  }

  try {
    // Verify mentor belongs to user
    const mentor = await prisma.mentor.findFirst({
      where: { id: mentorId, userId: session.user.id },
      select: { id: true },
    });
    if (!mentor) {
      return NextResponse.json({ error: "Mentor nie znaleziony" }, { status: 404 });
    }

    const conversations = await prisma.mentorConversation.findMany({
      where: { userId: session.user.id, mentorId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json(
      conversations.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: c._count.messages,
      }))
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  let mentorId: string;
  let firstMessage: string;
  try {
    const body = await request.json();
    mentorId = body.mentorId;
    firstMessage = body.firstMessage;
    if (!mentorId || !firstMessage || typeof firstMessage !== "string") {
      return NextResponse.json(
        { error: "mentorId i firstMessage są wymagane" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  try {
    const mentor = await prisma.mentor.findFirst({
      where: { id: mentorId, userId: session.user.id },
    });
    if (!mentor) {
      return NextResponse.json({ error: "Mentor nie znaleziony" }, { status: 404 });
    }

    // Call Anthropic with mentor systemPrompt + first message
    const aiResp = await anthropic.messages.create({
      model: mentor.model || "claude-sonnet-4-6",
      max_tokens: MAX_TOKENS,
      system: mentor.systemPrompt,
      messages: [{ role: "user", content: firstMessage }],
    });

    const assistantText = aiResp.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");

    // Create conversation + both messages in one transaction
    const conversation = await prisma.mentorConversation.create({
      data: {
        userId: session.user.id,
        mentorId,
        title: makeTitle(firstMessage),
        messages: {
          create: [
            { role: "user", content: firstMessage },
            { role: "assistant", content: assistantText },
          ],
        },
      },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    return NextResponse.json({
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
      messages: conversation.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Błąd serwera";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
