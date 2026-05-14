import { anthropic, MODELS } from "@/lib/ai/claude";
import { INPUT_ANALYZER_PROMPT } from "@/lib/ai/prompts";

export interface AnalyzedInput {
  mood?: string | null;
  energy?: number | null;
  sleepHours?: number | null;
  sleepQuality?: number | null;
  activitiesCompleted?: string[];
  meals?: { name: string; description?: string; calories?: number | null }[];
  notes?: string | null;
  dayType?: string | null;
}

/**
 * Analyze natural language input (voice or text) and extract structured data
 * using Claude with the INPUT_ANALYZER_PROMPT.
 */
export async function analyzeInput(
  text: string,
  _userId: string
): Promise<AnalyzedInput> {
  if (!text.trim()) {
    return {};
  }

  const response = await anthropic.messages.create({
    model: MODELS.CHAT,
    max_tokens: 1024,
    temperature: 0.2,
    system: INPUT_ANALYZER_PROMPT,
    messages: [{ role: "user", content: text }],
  });

  const content = response.content[0];
  if (content.type !== "text") {
    throw new Error("Unexpected response type from Claude");
  }

  // Extract JSON from response — handle potential markdown code blocks
  let jsonStr = content.text.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);

    // Normalize and validate
    return {
      mood: typeof parsed.mood === "string" ? parsed.mood : null,
      energy: typeof parsed.energy === "number" ? Math.min(10, Math.max(1, parsed.energy)) : null,
      sleepHours: typeof parsed.sleepHours === "number" ? parsed.sleepHours : null,
      sleepQuality: typeof parsed.sleepQuality === "number" ? Math.min(10, Math.max(1, parsed.sleepQuality)) : null,
      activitiesCompleted: Array.isArray(parsed.activitiesCompleted)
        ? parsed.activitiesCompleted.filter((a: unknown) => typeof a === "string")
        : [],
      meals: Array.isArray(parsed.meals)
        ? parsed.meals
            .filter((m: unknown) => typeof m === "object" && m !== null && "name" in (m as Record<string, unknown>))
            .map((m: Record<string, unknown>) => ({
              name: String(m.name),
              description: typeof m.description === "string" ? m.description : undefined,
              calories: typeof m.calories === "number" ? m.calories : null,
            }))
        : [],
      notes: typeof parsed.notes === "string" && parsed.notes.trim() ? parsed.notes : null,
      dayType: typeof parsed.dayType === "string" ? parsed.dayType : null,
    };
  } catch {
    // If JSON parsing fails, treat the whole response as a note
    return { notes: text };
  }
}
