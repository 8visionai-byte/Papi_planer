/**
 * Habit coaching: turns a bare habit name into a full habit loop.
 *
 * WHY this exists: a habit stored as a name plus a checkbox gives the user nothing to
 * argue with at 6am. The loop (cue -> routine -> reward) is what actually makes the
 * behaviour stick, and the second half of the model matters even more: a habit is never
 * deleted, only SWAPPED. You keep the same cue and the same reward and change only what
 * happens in between. When `kind` is "replace" the prompt below forces exactly that, so
 * the suggestion cannot quietly propose "just stop doing it".
 *
 * The whole function is best-effort: any failure (no API key, model down, broken JSON)
 * returns null and the caller saves the habit without a suggestion. Nothing in the app
 * may depend on this succeeding.
 */

import { anthropic, MODELS } from "@/lib/ai/claude";
import { buildUserContext } from "@/lib/ai/user-context";

export type HabitKind = "build" | "replace";

export interface HabitLoopInput {
  name: string;
  description?: string | null;
  timeOfDay?: string | null;
  kind: HabitKind;
  /** The old behaviour being swapped out. Only meaningful when kind is "replace". */
  replaces?: string | null;
}

export interface HabitLoopSuggestion {
  cue: string;
  routine: string;
  reward: string;
  why: string;
  identity: string;
  /** One practical note: the swap rule and what to change in the environment. */
  tip: string;
}

/** Same ceiling the /api/habits validation uses, so a suggestion always fits the column. */
const MAX_FIELD = 500;

const TIME_LABEL: Record<string, string> = {
  morning: "rano",
  afternoon: "po poludniu",
  evening: "wieczorem",
  any: "o dowolnej porze dnia",
};

const SYSTEM_PROMPT = [
  "Jesteś psychologiem, który zajmuje się zmianą nawyków. Znasz pętlę nawyku:",
  "WYZWALACZ (co uruchamia zachowanie) -> RUTYNA (co dokładnie robisz) -> NAGRODA (co mózg dostaje zaraz potem).",
  "",
  "Zasada nadrzędna: nawyku nie da się wykasować. Można go tylko podmienić.",
  "Zostawiasz ten sam wyzwalacz i tę samą nagrodę, a zmieniasz wyłącznie rutynę.",
  "",
  "Gdy rodzaj nawyku to \"replace\" i podano stary nawyk:",
  "1. wyzwalacz MUSI być taki sam jak przy starym nawyku,",
  "2. nagroda MUSI być taka sama jak przy starym nawyku,",
  "3. zmieniasz tylko rutynę,",
  "4. w polu \"tip\" wprost napisz, że wyzwalacz i nagroda zostają te same, a zmienia się tylko to, co robisz pomiędzy.",
  "",
  "W polu \"tip\" dodaj zawsze radę o środowisku: co utrudnić przy starym zachowaniu i co ułatwić przy nowym.",
  "",
  "Zasady pisania:",
  "- po polsku, krótkie zdania, zwracasz się do użytkownika na ty,",
  "- konkret zamiast ogólników: podaj moment, miejsce, liczbę minut albo powtórzeń,",
  "- nagroda ma być odczuwalna tego samego dnia, nie za rok,",
  "- pole \"why\" wiąże nawyk z celami i sytuacją użytkownika z kontekstu poniżej,",
  "- pole \"identity\" to jedno zdanie zaczynające się od \"Jestem kimś, kto\",",
  "- nie używaj myślnika (—), używaj przecinka, kropki albo dwukropka,",
  "- każde pole maksymalnie 200 znaków.",
  "",
  "Zwróć WYŁĄCZNIE JSON, bez markdown, bez komentarza przed ani po:",
  '{"cue":"...","routine":"...","reward":"...","why":"...","identity":"...","tip":"..."}',
].join("\n");

/**
 * Pulls the JSON object out of a model answer.
 * Handles a markdown fence and any chatter before or after the object.
 */
function extractJson(raw: string): string {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : text;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return candidate.slice(first, last + 1);
  }
  return candidate;
}

function field(value: unknown): string {
  if (typeof value !== "string") return "";
  const clean = value.trim().replace(/\s+/g, " ");
  return clean.length > MAX_FIELD ? clean.slice(0, MAX_FIELD - 3).trimEnd() + "..." : clean;
}

/**
 * Asks Claude for the habit loop of ONE habit, written for this specific user.
 *
 * The user context (scope "chat") is pasted into the user message on purpose: the goals,
 * training days and time of day are what make the difference between "medytuj rano" and
 * a cue that fits a day this person actually has.
 *
 * @returns the suggestion, or null when anything went wrong (never throws).
 */
export async function suggestHabitLoop(
  userId: string,
  input: HabitLoopInput
): Promise<HabitLoopSuggestion | null> {
  const name = input.name?.trim();
  if (!userId || !name) return null;

  const kind: HabitKind = input.kind === "replace" ? "replace" : "build";
  const replaces = input.replaces?.trim() || null;

  try {
    const ctx = await buildUserContext(userId, { scope: "chat" });

    const lines: string[] = [
      ctx.text,
      "",
      "---",
      "",
      "## Nawyk do opisania",
      `Nazwa: ${name}`,
    ];
    const description = input.description?.trim();
    if (description) lines.push(`Opis od użytkownika: ${description}`);
    const when = input.timeOfDay ? TIME_LABEL[input.timeOfDay] : null;
    if (when) lines.push(`Pora dnia: ${when}`);
    lines.push(`Rodzaj: ${kind}`);
    if (kind === "replace") {
      lines.push(
        replaces
          ? `Stary nawyk do podmiany: ${replaces}`
          : "Stary nawyk nie został podany, więc opisz wyzwalacz i nagrodę tak, żeby pasowały do typowego starego zachowania w tej sytuacji, i zaznacz to w polu tip."
      );
    }
    lines.push(
      "",
      "Opisz pętlę tego nawyku: wyzwalacz, rutyna, nagroda, po co to długoterminowo, kim to czyni użytkownika, plus jedna rada."
    );

    const response = await anthropic.messages.create({
      model: MODELS.CHAT,
      max_tokens: 700,
      temperature: 0.4,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: lines.join("\n") }],
    });

    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return null;

    const parsed = JSON.parse(extractJson(block.text)) as Record<string, unknown>;

    const suggestion: HabitLoopSuggestion = {
      cue: field(parsed.cue),
      // The routine is what the row shows in the middle of the loop line; falling back
      // to the habit name keeps that line readable even if the model skipped the field.
      routine: field(parsed.routine) || name,
      reward: field(parsed.reward),
      why: field(parsed.why),
      identity: field(parsed.identity),
      tip: field(parsed.tip),
    };

    // Cue and reward ARE the feature. An answer missing either of them is not worth
    // showing, so the caller falls back to "no suggestion" instead of half a loop.
    if (!suggestion.cue || !suggestion.reward) return null;

    return suggestion;
  } catch {
    // Missing API key, model error, malformed JSON: the habit still saves without this.
    return null;
  }
}
