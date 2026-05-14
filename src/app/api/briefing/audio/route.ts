import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { generateSpeech } from "@/lib/tts/elevenlabs";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "") // headers
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1") // italic
    .replace(/^[-*+]\s+/gm, "") // list markers
    .replace(/^>\s+/gm, "") // blockquotes
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links
    .replace(/\n{3,}/g, "\n\n") // excessive newlines
    .trim();
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  let briefingId: string;
  try {
    const body = await request.json();
    briefingId = body.briefingId;
    if (!briefingId) {
      return NextResponse.json(
        { error: "briefingId is required" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const briefing = await prisma.briefing.findUnique({
      where: { id: briefingId },
    });

    if (!briefing || briefing.userId !== userId) {
      return NextResponse.json(
        { error: "Briefing not found" },
        { status: 404 }
      );
    }

    // If audio already exists, return it
    if (briefing.audioUrl) {
      return NextResponse.json({ audioUrl: briefing.audioUrl });
    }

    // Generate audio
    const plainText = stripMarkdown(briefing.content);
    const audioBuffer = await generateSpeech(plainText);

    // Save file
    const audioDir = join(process.cwd(), "public", "audio");
    await mkdir(audioDir, { recursive: true });

    const filename = `${briefingId}.mp3`;
    const filePath = join(audioDir, filename);
    await writeFile(filePath, audioBuffer);

    const audioUrl = `/audio/${filename}`;

    // Update DB
    await prisma.briefing.update({
      where: { id: briefingId },
      data: { audioUrl },
    });

    return NextResponse.json({ audioUrl });
  } catch (err) {
    const errMessage =
      err instanceof Error ? err.message : "TTS generation failed";
    return NextResponse.json({ error: errMessage }, { status: 500 });
  }
}
