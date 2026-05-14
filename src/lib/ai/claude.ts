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
  CHAT: "claude-sonnet-4-20250514",
} as const;

export const DEFAULTS = {
  CHAT_MAX_TOKENS: 2048,
  BRIEFING_MAX_TOKENS: 4096,
  CREATIVE_TEMPERATURE: 0.7,
  ANALYSIS_TEMPERATURE: 0.3,
} as const;
