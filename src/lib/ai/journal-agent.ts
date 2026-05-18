import { anthropic, MODELS } from "@/lib/ai/claude";
import { prisma } from "@/lib/db/prisma";

export const DEFAULT_JOURNAL_SYSTEM_PROMPT =
  'Jesteś redaktorem dziennika osobistego. Z surowego tekstu użytkownika (luźne myśli) napisz krótszą, ustrukturyzowaną wersję w formacie Markdown — zachowaj WSZYSTKIE fakty i emocje. Następnie zaklasyfikuj wpis. Zwróć TYLKO JSON: {"redacted": "...", "category": "Myśl|Refleksja|Wniosek|Doświadczenie", "topic": "zdrowie|dzieci|dziewczyna|biznes|inne"}';

export const JOURNAL_CATEGORIES = [
  "Myśl",
  "Refleksja",
  "Wniosek",
  "Doświadczenie",
] as const;

export const JOURNAL_TOPICS = [
  "zdrowie",
  "dzieci",
  "dziewczyna",
  "biznes",
  "inne",
] as const;

export type JournalCategory = (typeof JOURNAL_CATEGORIES)[number];
export type JournalTopic = (typeof JOURNAL_TOPICS)[number];

export interface RedactedJournalEntry {
  redactedText: string;
  category: JournalCategory | null;
  topic: JournalTopic | null;
}

function extractJsonString(raw: string): string {
  let jsonStr = raw.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  } else {
    const firstBrace = jsonStr.indexOf("{");
    const lastBrace = jsonStr.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
  }
  return jsonStr;
}

function normalizeCategory(value: unknown): JournalCategory | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  for (const c of JOURNAL_CATEGORIES) {
    if (c.toLowerCase() === v.toLowerCase()) return c;
  }
  return null;
}

function normalizeTopic(value: unknown): JournalTopic | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  for (const t of JOURNAL_TOPICS) {
    if (t.toLowerCase() === v) return t;
  }
  return null;
}

/**
 * Redact + classify a raw journal entry using the user's configured journal agent.
 * Returns null on parse / model error so the caller can decide whether to still
 * persist the raw entry.
 */
export async function redactJournalEntry(
  userId: string,
  rawText: string
): Promise<RedactedJournalEntry | null> {
  const text = rawText?.trim();
  if (!text) return null;

  const config = await prisma.journalAgentConfig.findUnique({
    where: { userId },
  });

  const systemPrompt = config?.systemPrompt?.trim()
    ? config.systemPrompt
    : DEFAULT_JOURNAL_SYSTEM_PROMPT;
  const model = config?.model || MODELS.CHAT;

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: "user", content: text }],
    });

    const content = response.content[0];
    if (!content || content.type !== "text") return null;

    const jsonStr = extractJsonString(content.text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;

    const redacted =
      typeof obj.redacted === "string"
        ? obj.redacted.trim()
        : typeof obj.redactedText === "string"
          ? (obj.redactedText as string).trim()
          : "";

    if (!redacted) return null;

    return {
      redactedText: redacted,
      category: normalizeCategory(obj.category),
      topic: normalizeTopic(obj.topic),
    };
  } catch (err) {
    console.error("[journal-agent] redactJournalEntry failed:", err);
    return null;
  }
}
