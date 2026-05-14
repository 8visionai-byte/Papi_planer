import { anthropic, MODELS, DEFAULTS } from "@/lib/ai/claude";

export interface FileAnalysis {
  summary: string;
  category: "training" | "diet" | "medical" | "other";
  extractedData: Record<string, unknown>;
  recommendations: string[];
}

const SYSTEM_PROMPT = `Jesteś asystentem analizującym dokumenty przesłane przez użytkownika w programie transformacji osobistej PapiCoach.

Twoim zadaniem jest wyodrębnić kluczowe informacje z dokumentu: plany treningowe, plany dietetyczne, dane medyczne, cele, metryki.

Odpowiedz WYŁĄCZNIE poprawnym JSON-em (bez markdown, bez backticks), zgodnie z poniższą strukturą:

{
  "summary": "Krótkie podsumowanie dokumentu po polsku (1-3 zdania)",
  "category": "training" | "diet" | "medical" | "other",
  "extractedData": {
    // Wyodrębnione dane strukturalne z dokumentu.
    // Dla planu treningowego: ćwiczenia, serie, powtórzenia, dni.
    // Dla diety: posiłki, kalorie, makroskładniki.
    // Dla danych medycznych: wyniki badań, wskaźniki.
    // Dla innych: kluczowe punkty.
  },
  "recommendations": [
    "Konkretna rekomendacja 1 po polsku",
    "Konkretna rekomendacja 2 po polsku"
  ]
}`;

export async function analyzeFile(
  content: string,
  filename: string,
  _userId: string
): Promise<FileAnalysis> {
  // Skip analysis for non-extractable content
  if (content.startsWith("[Obraz") || content.startsWith("[Nieobsługiwany")) {
    return {
      summary: `Plik "${filename}" został zapisany, ale nie można go automatycznie przeanalizować.`,
      category: "other",
      extractedData: {},
      recommendations: [
        "Rozważ przesłanie pliku w formacie tekstowym (PDF, DOCX, TXT) dla pełnej analizy.",
      ],
    };
  }

  // Truncate very long content
  const maxChars = 30_000;
  const truncated =
    content.length > maxChars
      ? content.slice(0, maxChars) + "\n\n[...treść skrócona]"
      : content;

  try {
    const response = await anthropic.messages.create({
      model: MODELS.CHAT,
      max_tokens: DEFAULTS.CHAT_MAX_TOKENS,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Przeanalizuj poniższy dokument o nazwie "${filename}":\n\n${truncated}`,
        },
      ],
    });

    const text =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    // Parse JSON response
    const parsed = JSON.parse(text) as FileAnalysis;

    // Validate category
    const validCategories = ["training", "diet", "medical", "other"];
    if (!validCategories.includes(parsed.category)) {
      parsed.category = "other";
    }

    return {
      summary: parsed.summary || `Analiza pliku "${filename}"`,
      category: parsed.category,
      extractedData: parsed.extractedData || {},
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations
        : [],
    };
  } catch (err) {
    console.error("File analysis error:", err);
    return {
      summary: `Nie udało się przeanalizować pliku "${filename}". Spróbuj ponownie.`,
      category: "other",
      extractedData: {},
      recommendations: [],
    };
  }
}
