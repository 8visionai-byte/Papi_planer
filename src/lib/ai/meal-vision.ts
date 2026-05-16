import { anthropic, MODELS } from "@/lib/ai/claude";

export type Confidence = "low" | "medium" | "high";

export interface VisionMealResult {
  foods: string[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: Confidence;
  notes: string;
}

const SYSTEM_PROMPT =
  'Jesteś dietetykiem analizującym zdjęcia posiłków. Rozpoznaj składniki i oszacuj wartości odżywcze. Zwróć TYLKO JSON: {"foods": ["nazwa1", "nazwa2"], "calories": N, "protein": N, "carbs": N, "fat": N, "confidence": "low|medium|high", "notes": "krótka notatka o porcji i pewności estymacji"}';

const USER_PROMPT =
  "Przeanalizuj to zdjęcie posiłku i oszacuj wartości odżywcze.";

const ALLOWED_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function confidence(v: unknown): Confidence {
  const s = str(v).toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  return "low";
}

function extractJson(text: string): string | null {
  const t = text.trim();
  const codeBlock = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return t.slice(first, last + 1);
  }
  return null;
}

/**
 * Recognize meal from an image using Claude Vision.
 * Returns nutrition estimate or null on parse error.
 */
export async function recognizeMealFromImage(
  base64Image: string,
  mimeType: string
): Promise<VisionMealResult | null> {
  if (!base64Image) return null;
  if (!ALLOWED_MEDIA.has(mimeType)) {
    return null;
  }
  const media: ImageMediaType = mimeType as ImageMediaType;

  const response = await anthropic.messages.create({
    model: MODELS.CHAT,
    max_tokens: 1000,
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: media,
              data: base64Image,
            },
          },
          { type: "text", text: USER_PROMPT },
        ],
      },
    ],
  });

  const block = response.content[0];
  if (!block || block.type !== "text") return null;

  const jsonStr = extractJson(block.text);
  if (!jsonStr) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const foods = Array.isArray(obj.foods)
    ? (obj.foods as unknown[])
        .map((f) => str(f))
        .filter((f) => f.length > 0)
    : [];

  return {
    foods,
    calories: num(obj.calories),
    protein: num(obj.protein),
    carbs: num(obj.carbs),
    fat: num(obj.fat),
    confidence: confidence(obj.confidence),
    notes: str(obj.notes),
  };
}
