import OpenAI from "openai";

const globalForOpenAI = globalThis as unknown as { openai: OpenAI };

const openai =
  globalForOpenAI.openai ||
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

if (process.env.NODE_ENV !== "production") {
  globalForOpenAI.openai = openai;
}

/**
 * Transcribe audio using OpenAI Whisper API.
 * Accepts a Blob or Buffer and returns the transcribed text in Polish.
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

  try {
    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file,
      language: "pl",
    });

    return transcription.text;
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      throw new Error(`Whisper API error (${err.status}): ${err.message}`);
    }
    throw err;
  }
}
