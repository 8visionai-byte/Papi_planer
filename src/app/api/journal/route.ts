import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { redactJournalEntry } from "@/lib/ai/journal-agent";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatEntryHeader(d: Date, category: string | null, topic: string | null): string {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());
  const cat = category || "—";
  const top = topic || "—";
  return `## ${y}-${m}-${day} ${hh}:${mm} — [${cat} | ${top}]`;
}

function buildAggregatedMarkdown(
  entries: Array<{
    createdAt: Date;
    redactedText: string | null;
    rawText: string;
    category: string | null;
    topic: string | null;
  }>
): string {
  // Newest first when fetched; for export reverse to chronological? Spec example
  // shows latest order. Keep order as-fetched (desc) but the visual list
  // shows newest first too, so we keep this consistent.
  return entries
    .map((e) => {
      const header = formatEntryHeader(e.createdAt, e.category, e.topic);
      const body = (e.redactedText ?? e.rawText).trim();
      return `${header}\n\n${body}\n\n---\n`;
    })
    .join("");
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entries = await prisma.journalEntry.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const markdown = buildAggregatedMarkdown(entries);

  return NextResponse.json({ entries, markdown });
}

export async function POST(req: NextRequest) {
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

  const data = (body ?? {}) as { rawText?: unknown; autoRedact?: unknown };
  const rawText =
    typeof data.rawText === "string" ? data.rawText.trim() : "";

  if (!rawText) {
    return NextResponse.json(
      { error: "rawText jest wymagany" },
      { status: 400 }
    );
  }

  const autoRedact = data.autoRedact === undefined ? true : Boolean(data.autoRedact);

  let redactedText: string | null = null;
  let category: string | null = null;
  let topic: string | null = null;

  if (autoRedact) {
    const result = await redactJournalEntry(session.user.id, rawText);
    if (result) {
      redactedText = result.redactedText;
      category = result.category;
      topic = result.topic;
    }
  }

  const entry = await prisma.journalEntry.create({
    data: {
      userId: session.user.id,
      rawText,
      redactedText,
      category,
      topic,
    },
  });

  return NextResponse.json(entry);
}

export async function DELETE(req: NextRequest) {
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
  const id = (body as { id?: unknown })?.id;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const existing = await prisma.journalEntry.findUnique({ where: { id } });
  if (!existing || existing.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.journalEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
