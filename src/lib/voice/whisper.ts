import OpenAI from "openai";

const globalForOpenAI = globalThis as unknown as { openai: OpenAI };

const openai =
  globalForOpenAI.openai ||
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

if (process.env.NODE_ENV !== "production") {
  globalForOpenAI.openai = openai;
}

// Whisper hallucinates on near-silent/very short audio (e.g. returning "KONIEC",
// "Tak", "Napisy stworzone przez..."). Reject anything under ~0.5s of opus audio.
// Opus at ~128kbps ≈ 16KB/s, so 5000 bytes ≈ ~0.3s — below this is almost
// certainly garbage.
const MIN_AUDIO_BYTES = 5000;

// Coaching/training vocabulary primer — biases Whisper toward Polish words
// the user is likely to dictate in PapiCoach (training logs, meals, mentors).
const POLISH_COACHING_PROMPT =
  "Trening, kalistenika, karate, basen, siłownia, dieta, kalorie, białko, węglowodany, tłuszcze. Cel, mentor, plan, aktywność, posiłek. Pompki, przysiady, plank.";

/**
 * Transcribe audio using OpenAI Whisper API.
 * Accepts a Blob or Buffer and returns the transcribed text in Polish.
 *
 * Returns empty string for too-short audio (Whisper hallucinates on silence).
 */
export async function transcribeAudio(
  audio: Blob | Buffer,
  filename = "audio.webm"
): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  // Convert Buffer/Blob to a File for the API
  let file: File;
  if (Buffer.isBuffer(audio)) {
    // Slice the underlying ArrayBuffer to get a proper ArrayBuffer (not SharedArrayBuffer)
    const ab = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
    file = new File([ab], filename, { type: "audio/webm" });
  } else {
    file = new File([audio], filename, { type: (audio as Blob).type || "audio/webm" });
  }

  // Reject empty audio
  if (file.size === 0) {
    throw new Error("Audio file is empty");
  }

  // Reject too-short audio — Whisper hallucinates on near-silent input
  if (file.size < MIN_AUDIO_BYTES) {
    console.warn(
      `[whisper] Rejecting too-short audio: ${file.size} bytes (min ${MIN_AUDIO_BYTES}). ` +
        `Whisper would likely hallucinate.`
    );
    return "";
  }

  try {
    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file,
      language: "pl",
      prompt: POLISH_COACHING_PROMPT,
      temperature: 0.0, // most deterministic — reduces hallucination
    });

    const text = transcription.text ?? "";
    const preview = text.slice(0, 50).replace(/\s+/g, " ");
    console.log(
      `[whisper] Transcribed ${file.size} bytes -> ${text.length} chars: "${preview}${text.length > 50 ? "..." : ""}"`
    );

    return text;
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 401) {
        throw new Error(
          "Klucz API OpenAI jest nieważny. Zaktualizuj OPENAI_API_KEY w .env.local na VPS."
        );
      }
      if (err.status === 429) {
        throw new Error(
          "Limit OpenAI API osiągnięty. Sprawdź billing na platform.openai.com."
        );
      }
      throw new Error(`Whisper API error (${err.status}): ${err.message}`);
    }
    throw err;
  }
}
