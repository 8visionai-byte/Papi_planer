/**
 * Read side of the long-term memory.
 *
 * `insight-generator.ts` writes rows into `UserInsight`; this module renders the
 * active ones back into a short markdown block that any agent can paste into its
 * system prompt.
 *
 * HOW TO WIRE IT INTO `src/lib/ai/user-context.ts`
 * ------------------------------------------------
 * This is section 2 of the context ("Co juz o nim wiemy", BRAIN-SPEC table 2.2,
 * budget ~900 characters). Inside `buildUserContext`, add it to the existing
 * `Promise.all` and push the result into the STABLE part of the block:
 *
 * ```ts
 * import { getActiveInsights } from "@/lib/ai/insights-context";
 *
 * const [profile, insights, ...] = await Promise.all([
 *   loadProfile(userId),
 *   getActiveInsights(userId, 8),
 *   // ...
 * ]);
 *
 * if (insights) {
 *   stableParts.push(insights);   // already a "## ..." markdown section
 *   sections.push("insights");
 * }
 * ```
 *
 * Contract, so the caller never has to defend itself:
 *  - returns `""` when there is nothing to say (new user, or the table does not
 *    exist yet on this database) - never throws, never returns null;
 *  - the string is already a complete markdown section with its own heading;
 *  - the output is hard-capped (`maxChars`, default 1400 ≈ 400 tokens in Polish),
 *    so the context cannot grow with the user's tenure. That cap is the whole
 *    point of the insight layer: raw data stays a fixed size, knowledge grows.
 */

import { prisma } from "@/lib/db/prisma";

export type InsightKind =
  | "weekly_summary"
  | "pattern"
  | "preference"
  | "milestone"
  | "user_note";

export interface ActiveInsight {
  id: string;
  kind: string;
  /** "app" = written by an agent, "user" = the user's own words. */
  origin: string;
  period: string | null;
  title: string;
  content: string;
  confidence: number;
  createdAt: Date;
}

/** What the user himself stated has changed. Feeds the "zmiany" context section. */
export interface UserStatedInsight {
  id: string;
  title: string;
  content: string;
  createdAt: Date;
}

export interface GetActiveInsightsOptions {
  /** Hard cap on the returned markdown. Default 1400 characters (~400 tokens PL). */
  maxChars?: number;
  /** Restrict to selected kinds. Default: all kinds. */
  kinds?: InsightKind[];
}

/** Polish section labels, in the order they should appear in the prompt. */
const KIND_LABEL: Record<string, string> = {
  user_note: "Notatki uzytkownika",
  weekly_summary: "Podsumowania tygodnia",
  pattern: "Wzorce zachowan",
  preference: "Preferencje",
  milestone: "Kamienie milowe",
};

const KIND_ORDER = ["user_note", "pattern", "preference", "milestone", "weekly_summary"];

/**
 * Heading for everything the user wrote himself. It comes FIRST, above every
 * agent-written conclusion, because a note in his own words is the newest and the
 * most authoritative thing the app knows - and because burying it under "Wzorce
 * zachowan" is how "zdalem egzamin" ended up losing an argument with a four-week-old
 * training plan.
 */
const USER_ORIGIN_HEADING = "### Od uzytkownika (jego wlasne slowa, maja pierwszenstwo)";

/** `origin` value that marks a row as written by the user, not by an agent. */
const USER_ORIGIN = "user";

/** "2026-07-27" - no locale dependency, and short enough for a prompt budget. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Freshness-weighted score. Confidence dominates, recency breaks ties and slowly
 * pushes stale conclusions down: an insight loses ~0.1 of score per 30 days, so a
 * three-month-old 0.9 still outranks a fresh 0.4, which is the behaviour we want.
 */
function score(insight: ActiveInsight, now: number): number {
  const ageDays = Math.max(0, (now - insight.createdAt.getTime()) / 86_400_000);
  return insight.confidence - Math.min(0.35, (ageDays / 30) * 0.1);
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.75) return "wysoka pewnosc";
  if (confidence >= 0.5) return "srednia pewnosc";
  return "hipoteza";
}

/**
 * Fetches the active insights for one user, most trustworthy and freshest first.
 * Returns raw rows - use `getActiveInsights` when you want prompt-ready text.
 */
export async function listActiveInsights(
  userId: string,
  limit = 8,
  kinds?: InsightKind[],
): Promise<ActiveInsight[]> {
  try {
    const rows = await prisma.userInsight.findMany({
      where: {
        userId,
        active: true,
        ...(kinds && kinds.length > 0 ? { kind: { in: kinds } } : {}),
      },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      // Over-fetch a little: the final ordering is the freshness-weighted score,
      // not raw confidence, so the top `limit` by confidence is not the answer.
      take: Math.max(limit * 3, limit),
      select: {
        id: true,
        kind: true,
        origin: true,
        period: true,
        title: true,
        content: true,
        confidence: true,
        createdAt: true,
      },
    });

    const now = Date.now();
    // What the user wrote himself is never pushed out by the score: it goes to the
    // front of the list, so the `limit` slice can only ever drop agent-written rows.
    const sorted = rows.sort((a, b) => score(b, now) - score(a, now));
    const mine = sorted.filter((i) => i.origin === USER_ORIGIN);
    const rest = sorted.filter((i) => i.origin !== USER_ORIGIN);
    return [...mine, ...rest].slice(0, limit);
  } catch {
    // The table may not exist yet on a database that has not run the migration
    // (BRAIN-SPEC risk R1). A missing memory must never take the AI layer down.
    return [];
  }
}

/**
 * Only what the user wrote about himself ("zdalem egzamin", "przestalem biegac"),
 * newest first. This is the raw material for the "Co sie zmienilo" section of the
 * user context, which outranks the profile, the mentor prompts and the old plans.
 *
 * Same contract as everything else in this file: never throws, `[]` on a database
 * that has no `user_insights` table (or no `origin` column) yet.
 */
export async function listUserStatedInsights(
  userId: string,
  limit = 6,
): Promise<UserStatedInsight[]> {
  try {
    return await prisma.userInsight.findMany({
      where: { userId, active: true, origin: USER_ORIGIN },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, title: true, content: true, createdAt: true },
    });
  } catch {
    return [];
  }
}

/**
 * Prompt-ready markdown with what the app has learned about the user.
 *
 * @param userId owner
 * @param limit  how many insights to include. Default 8 (BRAIN-SPEC 4.4 point 3).
 * @returns markdown section, or `""` when there is nothing worth saying.
 *
 * @example
 * const block = await getActiveInsights(userId, 8);
 * // ## Co juz wiemy o uzytkowniku
 * // ### Wzorce zachowan
 * // - **Wieczorne treningi wypadaja** (wysoka pewnosc): pominal 7 z 9 sesji po 19:00.
 */
export async function getActiveInsights(
  userId: string,
  limit = 8,
  options: GetActiveInsightsOptions = {},
): Promise<string> {
  const maxChars = options.maxChars ?? 1400;
  const insights = await listActiveInsights(userId, limit, options.kinds);
  if (insights.length === 0) return "";

  // The user's own notes are pulled out of the kind grouping entirely and printed
  // as the first block, tagged "od uzytkownika". Grouping them by `kind` would file
  // "zdalem egzamin" under "Kamienie milowe", three headings below a stale pattern.
  const mine = insights.filter((i) => i.origin === USER_ORIGIN);
  const rest = insights.filter((i) => i.origin !== USER_ORIGIN);

  const grouped = new Map<string, ActiveInsight[]>();
  for (const i of rest) {
    const list = grouped.get(i.kind) ?? [];
    list.push(i);
    grouped.set(i.kind, list);
  }

  const parts: string[] = ["## Co juz wiemy o uzytkowniku"];

  if (mine.length > 0) {
    parts.push(USER_ORIGIN_HEADING);
    for (const i of mine) {
      const body = i.content.replace(/\s*\n+\s*/g, " ").trim();
      parts.push(`- **${i.title}** (od uzytkownika, ${isoDay(i.createdAt)}): ${body}`);
    }
  }

  for (const kind of KIND_ORDER) {
    const list = grouped.get(kind);
    if (!list || list.length === 0) continue;
    parts.push(`### ${KIND_LABEL[kind] ?? kind}`);
    for (const i of list) {
      const period = i.period ? ` [${i.period}]` : "";
      // Newlines inside content would break the one-bullet-per-insight shape.
      const body = i.content.replace(/\s*\n+\s*/g, " ").trim();
      parts.push(`- **${i.title}**${period} (${confidenceLabel(i.confidence)}): ${body}`);
    }
  }

  // Any kind the app starts writing later still shows up, just at the end.
  for (const [kind, list] of grouped) {
    if (KIND_ORDER.includes(kind)) continue;
    parts.push(`### ${KIND_LABEL[kind] ?? kind}`);
    for (const i of list) {
      const body = i.content.replace(/\s*\n+\s*/g, " ").trim();
      parts.push(`- **${i.title}** (${confidenceLabel(i.confidence)}): ${body}`);
    }
  }

  // Drop whole bullets from the end until the block fits. Cutting mid-sentence
  // would hand the model half a statistic, which is worse than one fewer insight.
  while (parts.join("\n").length > maxChars && parts.length > 2) {
    parts.pop();
    // Never leave a heading as the last line.
    while (parts.length > 1 && parts[parts.length - 1].startsWith("###")) parts.pop();
  }

  const text = parts.join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
