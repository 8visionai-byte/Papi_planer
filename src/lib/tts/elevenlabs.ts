const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";

// Premade voice available on free tier (Bella — professional/warm, supports multilingual v2 incl. Polish).
// Used as a fallback when the configured ELEVENLABS_VOICE_ID is unavailable (e.g. library voice on free plan).
const FALLBACK_VOICE_ID = "hpp4J3VqNfWAUOO0d1Us";

async function callTts(voiceId: string, text: string, apiKey: string) {
  return fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });
}

function extractErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.detail?.message) return String(parsed.detail.message);
    if (typeof parsed?.detail === "string") return parsed.detail;
    if (parsed?.message) return String(parsed.message);
  } catch {
    /* fall through */
  }
  return raw || "Unknown error";
}

export async function generateSpeech(text: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const configuredVoiceId = process.env.ELEVENLABS_VOICE_ID || FALLBACK_VOICE_ID;

  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY is not configured. Add it to .env.local."
    );
  }

  let response = await callTts(configuredVoiceId, text, apiKey);

  // Free-tier accounts can't use library voices (HTTP 402 paid_plan_required).
  // Retry once with a premade voice that works on every tier.
  if (
    !response.ok &&
    response.status === 402 &&
    configuredVoiceId !== FALLBACK_VOICE_ID
  ) {
    response = await callTts(FALLBACK_VOICE_ID, text, apiKey);
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    const msg = extractErrorMessage(raw);
    throw new Error(`ElevenLabs API error (${response.status}): ${msg}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
