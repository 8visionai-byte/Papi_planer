import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { generateSpeech } from "@/lib/tts/elevenlabs";

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

    // If audio already cached as data URL, return it.
    // Legacy /audio/*.mp3 paths are treated as missing and regenerated as data URL.
    if (briefing.audioUrl && briefing.audioUrl.startsWith("data:audio/")) {
      return NextResponse.json({ audioUrl: briefing.audioUrl });
    }

    if (briefing.audioUrl) {
      console.warn(
        `[briefing/audio] cached audioUrl ${briefing.audioUrl.slice(0, 64)}... is not a data URL. Regenerating as data URL.`
      );
    }

    // Pre-flight: check API key before doing any work
    if (!process.env.ELEVENLABS_API_KEY) {
      console.error("[briefing/audio] ELEVENLABS_API_KEY not configured");
      return NextResponse.json(
        {
          error:
            "ELEVENLABS_API_KEY nie jest skonfigurowany. Dodaj klucz do .env.local i zrestartuj serwer.",
        },
        { status: 500 }
      );
    }

    // Generate audio
    const plainText = stripMarkdown(briefing.content);
    if (!plainText) {
      return NextResponse.json(
        { error: "Briefing content is empty after stripping markdown" },
        { status: 400 }
      );
    }

    console.log(
      `[briefing/audio] generating TTS for briefing ${briefingId} (${plainText.length} chars)`
    );

    const audioBuffer = await generateSpeech(plainText);
    console.log(
      `[briefing/audio] generated ${audioBuffer.length} bytes of audio`
    );

    if (audioBuffer.length === 0) {
      return NextResponse.json(
        { error: "TTS zwrócił 0 bajtów. Spróbuj ponownie." },
        { status: 502 }
      );
    }

    // Encode as base64 data URL — persists across container restarts,
    // no filesystem dependency, browser <audio src> plays it natively.
    const base64 = audioBuffer.toString("base64");
    const audioUrl = `data:audio/mpeg;base64,${base64}`;

    // Update DB
    await prisma.briefing.update({
      where: { id: briefingId },
      data: { audioUrl },
    });

    console.log(
      `[briefing/audio] stored ${base64.length} chars base64 for briefing ${briefingId}`
    );

    return NextResponse.json({ audioUrl });
  } catch (err) {
    console.error("[briefing/audio] generation failed:", err);
    const errMessage =
      err instanceof Error ? err.message : "TTS generation failed";
    return NextResponse.json({ error: errMessage }, { status: 500 });
  }
}
