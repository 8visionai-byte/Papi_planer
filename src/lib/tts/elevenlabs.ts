const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/text-to-speech";

// Known-free premade voices — guaranteed available on every tier including free.
// Order matters: tried sequentially when the configured voice fails with auth/payment errors.
// IDs verified against ElevenLabs public catalog (Rachel, Adam, Bella, Antoni).
const FREE_TIER_FALLBACK_VOICES = [
  "21m00Tcm4TlvDq8ikWAM", // Rachel — calm, narrative
  "EXAVITQu4vr4xnSDxMaL", // Bella — warm, professional
  "pNInz6obpgDQGcFmaJgB", // Adam — deep, narration
];

// HTTP statuses that indicate the voice is unavailable on the current plan
// (rather than a transient API failure). Triggers fallback retry.
const VOICE_UNAVAILABLE_STATUSES = new Set([401, 402, 403, 404]);

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
  const configuredVoiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY nie jest skonfigurowany. Dodaj klucz do .env.local."
    );
  }

  // Build ordered list of voices to try: configured first, then fallbacks (deduped).
  const voicesToTry: string[] = [];
  if (configuredVoiceId) voicesToTry.push(configuredVoiceId);
  for (const v of FREE_TIER_FALLBACK_VOICES) {
    if (!voicesToTry.includes(v)) voicesToTry.push(v);
  }

  let lastStatus = 0;
  let lastMessage = "Brak prób TTS";

  for (let i = 0; i < voicesToTry.length; i++) {
    const voiceId = voicesToTry[i];
    const isLast = i === voicesToTry.length - 1;
    const response = await callTts(voiceId, text, apiKey);

    if (response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("audio/")) {
        // 200 OK but wrong body — treat as error
        const raw = await response.text().catch(() => "");
        const msg = extractErrorMessage(raw);
        if (isLast) {
          throw new Error(
            `ElevenLabs zwrócił status 200 ale nie audio (content-type=${contentType}): ${msg}`
          );
        }
        lastStatus = 200;
        lastMessage = `content-type=${contentType}, body=${msg}`;
        console.warn(
          `[TTS] voice ${voiceId} returned non-audio 200 (${contentType}), trying next`
        );
        continue;
      }
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        if (isLast) {
          throw new Error("ElevenLabs zwrócił pusty plik audio (0 bajtów)");
        }
        console.warn(`[TTS] voice ${voiceId} returned empty body, trying next`);
        continue;
      }
      if (i > 0) {
        console.log(
          `[TTS] succeeded with fallback voice ${voiceId} (configured voice ${configuredVoiceId} failed)`
        );
      }
      return Buffer.from(arrayBuffer);
    }

    // Non-OK response — capture error, decide whether to retry with next voice
    const raw = await response.text().catch(() => "");
    lastStatus = response.status;
    lastMessage = extractErrorMessage(raw);
    console.warn(
      `[TTS] voice ${voiceId} failed: HTTP ${response.status} — ${lastMessage}`
    );

    const shouldRetry =
      !isLast && VOICE_UNAVAILABLE_STATUSES.has(response.status);
    if (!shouldRetry) {
      throw new Error(
        `ElevenLabs API błąd (HTTP ${response.status}): ${lastMessage}`
      );
    }
  }

  throw new Error(
    `Wszystkie głosy ElevenLabs nieudane. Ostatni status=${lastStatus}, błąd=${lastMessage}`
  );
}
