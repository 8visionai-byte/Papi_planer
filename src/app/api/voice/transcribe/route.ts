import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { transcribeAudio } from "@/lib/voice/whisper";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

// Known Whisper hallucinations on silent/short audio (single common Polish words).
// We don't auto-reject — Whisper might genuinely return them — but flag in logs.
const SUSPICIOUS_TRANSCRIPTIONS = new Set([
  "koniec",
  "koniec!",
  "koniec.",
  "tak",
  "tak.",
  "nie",
  "nie.",
  "ok",
  "ok.",
  "dziękuję",
  "dziekuje",
  "napisy stworzone przez społeczność amara.org",
]);

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof File)) {
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      );
    }

    if (audioFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 25MB." },
        { status: 413 }
      );
    }

    if (audioFile.size === 0) {
      return NextResponse.json(
        { error: "Audio file is empty" },
        { status: 400 }
      );
    }

    console.log(
      `[transcribe] Received audio: ${audioFile.size} bytes, mime="${audioFile.type}", name="${audioFile.name}"`
    );

    const text = await transcribeAudio(audioFile, audioFile.name || "audio.webm");

    // Flag suspicious transcriptions for diagnostics
    const normalized = text.trim().toLowerCase();
    if (normalized && SUSPICIOUS_TRANSCRIPTIONS.has(normalized)) {
      console.warn(
        `[transcribe] Suspicious transcription "${text}" from ${audioFile.size} bytes — ` +
          `likely Whisper hallucination on silent/short audio.`
      );
    }

    return NextResponse.json({ text });
  } catch (err) {
    console.error("Transcription error:", err);
    const message = err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
