/**
 * The dietitian's idea generator.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The diet advice kept repeating the same "200 g twarogu" forever, because
 * nothing anywhere recorded what the user actually likes, what he refused, or
 * what he already ate this month. Variety is not a nice-to-have here, it IS the
 * feature. So every call builds three lists out of the database and hands them
 * to the model as hard constraints:
 *
 *   - LUBI      (MealIdea.rating = 1 or favorite)  -> aim in this direction
 *   - ODRZUCIL  (MealIdea.rating = -1)             -> never propose again
 *   - OSTATNIO  (ideas + real meals, last 30 days) -> not this month
 *
 * The last list also reads the real `Meal` rows, not only saved ideas: the
 * repetition the user complained about lives in what he EATS, and a suggestion
 * engine that only looks at its own past suggestions would keep proposing the
 * curd cheese he has eaten every morning for three weeks.
 *
 * WEB SEARCH
 * ----------
 * The dietitian gets Anthropic's server-side `web_search` tool so it can lean on
 * real recipes instead of its own internal rotation. The tool type string comes
 * from the SDK types (`WebSearchTool20260209` in
 * node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts), NOT from
 * memory. Two hard rules:
 *   - at most MAX_WEB_SEARCHES searches per call, so a tap on "Podrzuc pomysly"
 *     cannot quietly burn the budget;
 *   - if the tool errors or is unavailable, the whole call is retried once
 *     WITHOUT tools. The user must always get ideas, never an error message.
 *
 * This module only READS from the database. Saving happens in the API route,
 * after the user rates or saves an idea.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODELS } from "@/lib/ai/claude";
import { prisma } from "@/lib/db/prisma";
import { buildUserContext } from "@/lib/ai/user-context";
import { subDays, startOfDay } from "date-fns";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export type MealIdeaSource = "ai" | "web" | "user";

/** One proposal. Shape matches the MealIdea model so the route can upsert it as-is. */
export interface MealIdeaSuggestion {
  title: string;
  /** One sentence: what it is and why it fits this user today. */
  description: string;
  /** Ingredients WITH amounts, ready to become a shopping list line. */
  ingredients: string[];
  steps: string[];
  prepMinutes: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  tags: string[];
  source: MealIdeaSource;
  /** Only set when the idea leans on a page the model actually opened. */
  sourceUrl: string | null;
}

export interface SuggestMealIdeasOptions {
  /** "sniadanie" | "obiad" | "kolacja" | "przekaska" - free text, goes into the prompt. */
  mealType?: string;
  /** How many proposals. Clamped to 1..6. */
  count?: number;
  /** Let the model search the web. Default true. */
  useWeb?: boolean;
}

export interface SuggestMealIdeasResult {
  ideas: MealIdeaSuggestion[];
  /** True when the model really ran a search (not just when it was allowed to). */
  usedWeb: boolean;
  /**
   * Why the web pass did not work, for the server log only. The UI never shows
   * this: a failed search still returns ideas, just without sources.
   */
  webNote: string | null;
}

/* ------------------------------------------------------------------ */
/*  Tuning                                                             */
/* ------------------------------------------------------------------ */

const DEFAULT_COUNT = 3;
const MAX_COUNT = 6;
/** Budget guard: three searches is enough to ground three dishes. */
const MAX_WEB_SEARCHES = 3;
const MAX_TOKENS = 4000;
/** Server-side tool loops can pause; we resume at most this many times. */
const MAX_CONTINUATIONS = 2;
/** How far back "already had that" reaches. */
const RECENT_DAYS = 30;

/**
 * Server tool identifier. Verified against the installed SDK
 * (`WebSearchTool20260209` -> type "web_search_20260209", name "web_search").
 * Do not retype from memory; re-check the SDK types if the SDK is upgraded.
 */
const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: MAX_WEB_SEARCHES,
} as const satisfies Anthropic.ToolUnion;

/* ------------------------------------------------------------------ */
/*  Prompt                                                             */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `Jestes osobistym dietetykiem tego uzytkownika. Proponujesz konkretne posilki, ktore on faktycznie zrobi.

TWARDE ZASADY (lamiesz je = odpowiedz jest bezuzyteczna):
1. Czas przygotowania 15-20 minut, nigdy wiecej niz 25.
2. Maksymalnie 6 skladnikow na danie.
3. Wszystko do kupienia w zwyklym sklepie (Biedronka, Lidl, Auchan).
4. Minimum przetworzonych rzeczy, ale gotowe elementy, ktore skracaja robote, sa jak najbardziej OK:
   gotowa piers z kurczaka juz pokrojona, mrozone warzywa, ryz w torebce, gotowa kasza, jajka.
5. NIGDY nie proponuj dania z listy ODRZUCONE ani z listy OSTATNIO (uzytkownik ma tego dosc).
6. Kazda propozycja w tej odpowiedzi ma byc inna: inne zrodlo bialka i inna baza (ryz / ziemniaki / kasza / makaron / pieczywo).
7. Trafiaj w cel kaloryczny i zapotrzebowanie na bialko z kontekstu uzytkownika.
8. Skladniki podawaj z gramatura, tak zeby dalo sie z tego zrobic liste zakupow ("piers z kurczaka 200 g", nie "kurczak").
9. Kroki krotkie i czynnosciowe, 3 do 5 krokow. Zadnych projektow restauracyjnych.
10. Pisz po polsku, prosto. Nie uzywaj myslnika (—), uzywaj przecinka albo kropki.

WYSZUKIWANIE W INTERNECIE:
Jesli masz narzedzie wyszukiwania, uzyj go maksymalnie ${MAX_WEB_SEARCHES} razy, zeby znalezc realne, szybkie przepisy.
Gdy pomysl opierasz na znalezionej stronie, wpisz jej pelny adres w pole "sourceUrl".
Gdy pomysl jest twoj wlasny, ustaw "sourceUrl" na null. Nie wymyslaj adresow.

FORMAT ODPOWIEDZI:
Zwroc WYLACZNIE JSON, bez komentarza przed ani po, bez bloku kodu:
{"ideas":[{"title":"krotka nazwa dania","description":"jedno zdanie: co to jest i dlaczego pasuje wlasnie jemu","ingredients":["piers z kurczaka 200 g","ryz w torebce 1 szt","mrozona fasolka szparagowa 150 g"],"steps":["krok 1","krok 2","krok 3"],"prepMinutes":18,"calories":620,"protein":48,"carbs":62,"fat":16,"tags":["obiad","szybkie","wysokobialkowe"],"sourceUrl":null}]}`;

function listOrDash(items: string[], max: number): string {
  const trimmed = items
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
  return trimmed.length > 0 ? trimmed.join(", ") : "(brak)";
}

function buildUserMessage(params: {
  contextText: string;
  liked: string[];
  rejected: string[];
  recent: string[];
  count: number;
  mealType?: string;
}): string {
  const { contextText, liked, rejected, recent, count, mealType } = params;
  const target = mealType?.trim()
    ? `Posilek: ${mealType.trim()}.`
    : "Posilek: dowolny, dopasuj do pory dnia i tego, co zostalo mu z celu kalorycznego.";

  return [
    contextText,
    "",
    "## Co juz wiemy o jego gustach",
    `LUBI (dawaj podobne): ${listOrDash(liked, 20)}`,
    `ODRZUCIL (nigdy wiecej): ${listOrDash(rejected, 25)}`,
    `OSTATNIO JADL lub dostal (ostatnie ${RECENT_DAYS} dni, NIE powtarzaj): ${listOrDash(recent, 40)}`,
    "",
    "## Zadanie",
    target,
    `Zaproponuj dokladnie ${count} ${count === 1 ? "danie" : "dania"}, kazde inne.`,
    "Zwroc sam JSON.",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/*  Response parsing (defensive on purpose)                            */
/* ------------------------------------------------------------------ */

function collectText(content: Anthropic.ContentBlock[]): string {
  // With server tools the response is interleaved: server_tool_use blocks,
  // web_search_tool_result blocks and text blocks. Only the text carries JSON.
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** URLs the search actually returned. Anything the model "cites" outside this set is invented. */
function collectSearchUrls(content: Anthropic.ContentBlock[]): Set<string> {
  const urls = new Set<string>();
  for (const block of content) {
    if (block.type !== "web_search_tool_result") continue;
    const inner = block.content;
    // `content` is either an error object or an array of results.
    if (!Array.isArray(inner)) continue;
    for (const result of inner) {
      if (result.type === "web_search_result" && typeof result.url === "string") {
        urls.add(result.url);
      }
    }
  }
  return urls;
}

/** First web_search error code in the response, if the tool failed server side. */
function firstSearchError(content: Anthropic.ContentBlock[]): string | null {
  for (const block of content) {
    if (block.type !== "web_search_tool_result") continue;
    const inner = block.content;
    if (!Array.isArray(inner) && inner?.type === "web_search_tool_result_error") {
      return inner.error_code;
    }
  }
  return null;
}

function extractJson(raw: string): string {
  let s = raw.trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    s = fenced[1].trim();
  }
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  return s;
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

function strArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max);
}

function parseIdeas(raw: string, allowedUrls: Set<string>): MealIdeaSuggestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return [];
  }

  const root = parsed as Record<string, unknown>;
  // Tolerate both {"ideas": [...]} and a bare array.
  const rawIdeas = Array.isArray(root?.ideas)
    ? (root.ideas as unknown[])
    : Array.isArray(parsed)
      ? (parsed as unknown[])
      : [];

  const out: MealIdeaSuggestion[] = [];
  const seenTitles = new Set<string>();

  for (const entry of rawIdeas) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    if (!title) continue;

    // The DB has a unique (userId, title); dropping duplicates here keeps the
    // later upsert from silently collapsing two different cards into one.
    const key = title.toLowerCase();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);

    // A "source" the model invented is worse than no source at all, so a URL is
    // kept only when the search really returned it.
    const claimedUrl = typeof o.sourceUrl === "string" ? o.sourceUrl.trim() : "";
    const sourceUrl = claimedUrl && allowedUrls.has(claimedUrl) ? claimedUrl : null;

    out.push({
      title: title.slice(0, 120),
      description: typeof o.description === "string" ? o.description.trim().slice(0, 400) : "",
      ingredients: strArray(o.ingredients, 12),
      steps: strArray(o.steps, 8),
      prepMinutes: Math.min(60, num(o.prepMinutes, 20) || 20),
      calories: num(o.calories),
      protein: num(o.protein),
      carbs: num(o.carbs),
      fat: num(o.fat),
      tags: strArray(o.tags, 6).map((t) => t.toLowerCase()),
      source: sourceUrl ? "web" : "ai",
      sourceUrl,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/*  Model call                                                         */
/* ------------------------------------------------------------------ */

/**
 * One request, resuming `pause_turn` if the server-side tool loop stops early.
 * `pause_turn` is not an error: the server ran out of its own iterations and
 * wants the same conversation sent back so it can carry on.
 */
async function runModel(
  system: string,
  userMessage: string,
  tools: Anthropic.ToolUnion[] | undefined
): Promise<Anthropic.ContentBlock[]> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
  const collected: Anthropic.ContentBlock[] = [];

  for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
    const response = await anthropic.messages.create({
      model: MODELS.CHAT,
      max_tokens: MAX_TOKENS,
      temperature: 0.8, // variety is the point of this feature
      system,
      messages,
      ...(tools && tools.length > 0 ? { tools } : {}),
    });

    collected.push(...response.content);

    if (response.stop_reason !== "pause_turn") break;

    // Resume: hand the partial assistant turn straight back. Response blocks and
    // request blocks are the same wire shape here; the cast only bridges the
    // "read" and "write" type variants of the SDK.
    messages.push({
      role: "assistant",
      content: response.content as unknown as Anthropic.ContentBlockParam[],
    });
  }

  return collected;
}

/* ------------------------------------------------------------------ */
/*  Main entry                                                         */
/* ------------------------------------------------------------------ */

/**
 * The `meal_ideas` table only exists after `prisma db push` has been run against
 * this database. Until then the taste history is simply empty and the dietitian
 * still proposes dishes, because the user must never get an error instead of
 * ideas. Same defence as `insights-context.ts` uses for `UserInsight`.
 */
async function safeIdeaQuery<T>(label: string, run: () => Promise<T[]>): Promise<T[]> {
  try {
    return await run();
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2021") {
      console.warn(`[meal-ideas] tabela meal_ideas nie istnieje (${label}), pomijam historie smaku`);
      return [];
    }
    throw err;
  }
}

export async function suggestMealIdeas(
  userId: string,
  opts: SuggestMealIdeasOptions = {}
): Promise<SuggestMealIdeasResult> {
  const count = Math.max(1, Math.min(MAX_COUNT, opts.count ?? DEFAULT_COUNT));
  const wantWeb = opts.useWeb !== false && Boolean(process.env.ANTHROPIC_API_KEY);
  const since = startOfDay(subDays(new Date(), RECENT_DAYS));

  const [context, likedRows, rejectedRows, recentIdeaRows, recentMealRows] = await Promise.all([
    buildUserContext(userId, { scope: "chat" }),
    safeIdeaQuery("liked", () =>
      prisma.mealIdea.findMany({
        where: { userId, OR: [{ rating: 1 }, { favorite: true }] },
        select: { title: true, tags: true },
        orderBy: [{ favorite: "desc" }, { timesCooked: "desc" }, { createdAt: "desc" }],
        take: 20,
      })
    ),
    safeIdeaQuery("rejected", () =>
      prisma.mealIdea.findMany({
        where: { userId, rating: -1 },
        select: { title: true },
        orderBy: { createdAt: "desc" },
        take: 25,
      })
    ),
    safeIdeaQuery("recent", () =>
      prisma.mealIdea.findMany({
        where: {
          userId,
          OR: [{ lastCookedAt: { gte: since } }, { createdAt: { gte: since } }],
        },
        select: { title: true },
        orderBy: { createdAt: "desc" },
        take: 30,
      })
    ),
    // The real repetition lives in what he actually ate, not in what we proposed.
    prisma.meal.findMany({
      where: { dailyLog: { userId, date: { gte: since } } },
      select: { name: true },
      take: 150,
    }),
  ]);

  const liked = likedRows.map((r) =>
    r.tags.length > 0 ? `${r.title} (${r.tags.slice(0, 3).join("/")})` : r.title
  );
  const rejected = rejectedRows.map((r) => r.title);

  // One entry per dish, case-insensitive: 20 rows of "Twarog ze szczypiorkiem"
  // would otherwise eat the whole list budget.
  const recentSeen = new Set<string>();
  const recent: string[] = [];
  for (const name of [...recentIdeaRows.map((r) => r.title), ...recentMealRows.map((r) => r.name)]) {
    const key = name.trim().toLowerCase();
    if (!key || recentSeen.has(key)) continue;
    recentSeen.add(key);
    recent.push(name.trim());
  }

  const userMessage = buildUserMessage({
    contextText: context.text,
    liked,
    rejected,
    recent,
    count,
    mealType: opts.mealType,
  });

  let webNote: string | null = null;
  let content: Anthropic.ContentBlock[] = [];

  if (wantWeb) {
    try {
      content = await runModel(SYSTEM_PROMPT, userMessage, [WEB_SEARCH_TOOL]);
      const searchError = firstSearchError(content);
      if (searchError) {
        webNote = `web_search zwrocil blad: ${searchError}`;
      }
    } catch (err) {
      // Tool unavailable, rejected by the API, network hiccup: whatever it was,
      // the user must not see it. Fall through to the plain retry below.
      webNote = err instanceof Error ? err.message : "web_search niedostepne";
      content = [];
    }
  }

  let ideas = content.length > 0 ? parseIdeas(collectText(content), collectSearchUrls(content)) : [];
  let usedWeb = ideas.some((i) => i.source === "web");

  if (ideas.length === 0) {
    // Second and final attempt, no tools. If this one throws, the route turns it
    // into a 500 and the UI shows its own "nie udalo sie" message.
    if (!webNote && wantWeb) {
      webNote = "pierwsza proba z wyszukiwaniem nie zwrocila poprawnego JSON";
    }
    const plain = await runModel(SYSTEM_PROMPT, userMessage, undefined);
    ideas = parseIdeas(collectText(plain), new Set());
    usedWeb = false;
  }

  return { ideas: ideas.slice(0, count), usedWeb, webNote };
}
