import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { DEFAULT_JOURNAL_SYSTEM_PROMPT } from "@/lib/ai/journal-agent";
import { MODELS } from "@/lib/ai/claude";

const ALLOWED_MODELS = [
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await prisma.journalAgentConfig.findUnique({
    where: { userId: session.user.id },
  });

  if (!config) {
    return NextResponse.json({
      systemPrompt: DEFAULT_JOURNAL_SYSTEM_PROMPT,
      model: MODELS.CHAT,
      isDefault: true,
    });
  }

  return NextResponse.json({
    systemPrompt: config.systemPrompt,
    model: config.model,
    updatedAt: config.updatedAt,
    isDefault: false,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data = (body ?? {}) as { systemPrompt?: unknown; model?: unknown };

  const updates: { systemPrompt?: string; model?: string } = {};

  if (typeof data.systemPrompt === "string") {
    const trimmed = data.systemPrompt.trim();
    if (!trimmed) {
      return NextResponse.json(
        { error: "systemPrompt nie może być pusty" },
        { status: 400 }
      );
    }
    updates.systemPrompt = trimmed;
  }

  if (typeof data.model === "string") {
    if (!ALLOWED_MODELS.includes(data.model)) {
      return NextResponse.json(
        { error: "Nieobsługiwany model" },
        { status: 400 }
      );
    }
    updates.model = data.model;
  }

  if (!updates.systemPrompt && !updates.model) {
    return NextResponse.json(
      { error: "Brak pól do aktualizacji" },
      { status: 400 }
    );
  }

  const existing = await prisma.journalAgentConfig.findUnique({
    where: { userId: session.user.id },
  });

  const finalSystemPrompt =
    updates.systemPrompt ??
    existing?.systemPrompt ??
    DEFAULT_JOURNAL_SYSTEM_PROMPT;
  const finalModel = updates.model ?? existing?.model ?? MODELS.CHAT;

  const config = await prisma.journalAgentConfig.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      systemPrompt: finalSystemPrompt,
      model: finalModel,
    },
    update: {
      systemPrompt: finalSystemPrompt,
      model: finalModel,
    },
  });

  return NextResponse.json({
    systemPrompt: config.systemPrompt,
    model: config.model,
    updatedAt: config.updatedAt,
    isDefault: false,
  });
}
