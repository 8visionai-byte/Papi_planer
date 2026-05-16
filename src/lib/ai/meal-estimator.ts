import { anthropic, MODELS } from "@/lib/ai/claude";

export interface EstimatedMeal {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  foods: string[];
}

const SYSTEM_PROMPT =
  'Jesteś dietetykiem. Z opisu posiłku oszacuj kalorie i makra. Zwróć TYLKO JSON: {"calories": N, "protein": N, "carbs": N, "fat": N, "foods": ["nazwa1", ...]}';

/**
 * Estimate macros from a free-form meal description using Claude.
 * Returns calories (kcal) and protein/carbs/fat (grams) plus an array of
 * food names extracted from the description.
 */
export async function estimateMacros(description: string): Promise<EstimatedMeal> {
  const text = description?.trim();
  if (!text) {
    throw new Error("Opis posiłku jest pusty");
  }

  const response = await anthropic.messages.create({
    model: MODELS.FAST,
    max_tokens: 500,
    temperature: 0.3,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: text }],
  });

  const content = response.content[0];
  if (!content || content.type !== "text") {
    throw new Error("Nieoczekiwany format odpowiedzi z Claude");
  }

  let jsonStr = content.text.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  } else {
    // Strip any leading text before the first '{'
    const firstBrace = jsonStr.indexOf("{");
    const lastBrace = jsonStr.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Nie udało się sparsować odpowiedzi AI");
  }

  const obj = parsed as Record<string, unknown>;
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };

  const foods = Array.isArray(obj.foods)
    ? (obj.foods as unknown[]).filter((f): f is string => typeof f === "string")
    : [];

  return {
    calories: num(obj.calories),
    protein: num(obj.protein),
    carbs: num(obj.carbs),
    fat: num(obj.fat),
    foods,
  };
}
