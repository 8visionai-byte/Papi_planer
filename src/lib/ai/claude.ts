import Anthropic from "@anthropic-ai/sdk";

const globalForAnthropic = globalThis as unknown as {
  anthropic: Anthropic;
};

export const anthropic =
  globalForAnthropic.anthropic ||
  new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

if (process.env.NODE_ENV !== "production") {
  globalForAnthropic.anthropic = anthropic;
}

export const MODELS = {
  CHAT: "claude-sonnet-4-6",
  BRIEFING: "claude-sonnet-4-6",
  ROUNDTABLE: "claude-opus-4-6",
  FAST: "claude-haiku-4-5-20251001",
} as const;

export const AVAILABLE_MODELS = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6 (najbardziej inteligentny)" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (zbalansowany)" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (szybki/tani)" },
] as const;

export const DEFAULTS = {
  CHAT_MAX_TOKENS: 2048,
  BRIEFING_MAX_TOKENS: 4096,
  CREATIVE_TEMPERATURE: 0.7,
  ANALYSIS_TEMPERATURE: 0.3,
} as const;
