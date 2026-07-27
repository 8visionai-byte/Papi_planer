/**
 * One tick, one truth: a habit ticked anywhere is ticked everywhere.
 *
 * The owner ticked "poranna Vipassana" on the habits screen and the identical line in
 * the day plan stayed open, because nothing tied the two rows together. Comparing
 * titles on every read was never going to hold ("Vipassana rano" vs "poranna Vipassana
 * 20 min") and would run the fuzzy match on every single render of the dashboard.
 *
 * So the match happens ONCE, when the plan is written, and the winner is stored in
 * `Activity.habitId`. From then on both toggle routes do a primary-key lookup, not a
 * guess: /api/habits/toggle flips every activity carrying that habitId, and
 * /api/activities/toggle writes (or removes) the HabitCompletion for that day.
 *
 * `normalizeForMatch` and `matchHabit` are pure — no Prisma, no clock — so the matching
 * rules can be reasoned about and checked without a database.
 *
 * Dates: the container runs on UTC, the owner lives in Poland, and
 * `HabitCompletion.date` is a `@db.Date` column. Every day here is the POLISH calendar
 * day turned into the UTC midnight those columns store, so a tick at 23:30 Warsaw time
 * lands on today and not on tomorrow.
 */

import { startOfDay } from "date-fns";
import { prisma } from "@/lib/db/prisma";
import { polishDayBounds } from "@/lib/google/calendar";

/* ------------------------------------------------------------------ */
/*  Normalisation                                                      */
/* ------------------------------------------------------------------ */

/**
 * Words that describe WHEN or HOW OFTEN something happens, plus time units.
 * They carry no identity: "Vipassana", "poranna Vipassana" and "Vipassana 20 min"
 * are the same practice, and the plan generator words it differently every morning.
 */
const NOISE_WORDS = new Set<string>([
  // time units (digits are stripped separately, so "20 min" leaves just "min")
  "min",
  "minut",
  "minuty",
  "minutach",
  "minutowa",
  "minutowy",
  "minutowe",
  "h",
  "godz",
  "godzina",
  "godziny",
  "godzin",
  "godzinna",
  "godzinny",
  "godzinne",
  "sek",
  "sekund",
  "sekundy",
  // time of day
  "poranna",
  "poranny",
  "poranne",
  "poranek",
  "rano",
  "rankiem",
  "przedpoludniem",
  // "po poludniu" arrives as two tokens, "popoludniu" as one — both must go
  "po",
  "poludnie",
  "poludniu",
  "popoludnie",
  "popoludniu",
  "popoludniowa",
  "popoludniowy",
  "wieczor",
  "wieczorem",
  "wieczorna",
  "wieczorny",
  "wieczorne",
  "wieczorami",
  // frequency
  "codziennie",
  "codzienna",
  "codzienny",
  "codzienne",
  "dziennie",
  "dzienna",
  "dzienny",
  "dzienne",
  // leftover of "2x", "3x"
  "x",
]);

/**
 * Time-of-day words grouped by the part of the day they name.
 *
 * `normalizeForMatch` throws them away, which is right for "poranna Vipassana 20 min"
 * against "Vipassana rano" (one practice worded twice) and wrong for "Suplementy rano"
 * against "Suplementy wieczorem" - two different acts that normalise to the same
 * string. `matchHabit` therefore reads the part of the day off the raw text first and
 * refuses a match when the two sides name opposite ones.
 *
 * "po" is deliberately absent: on its own it is "po treningu", not "po poludniu".
 */
const DAY_PART_WORDS: Record<string, "rano" | "dzien" | "wieczor"> = {
  poranna: "rano",
  poranny: "rano",
  poranne: "rano",
  poranek: "rano",
  rano: "rano",
  rankiem: "rano",
  przedpoludniem: "rano",
  poludnie: "dzien",
  poludniu: "dzien",
  popoludnie: "dzien",
  popoludniu: "dzien",
  popoludniowa: "dzien",
  popoludniowy: "dzien",
  wieczor: "wieczor",
  wieczorem: "wieczor",
  wieczorna: "wieczor",
  wieczorny: "wieczor",
  wieczorne: "wieczor",
  wieczorami: "wieczor",
};

/**
 * Lowercase, strip Polish accents, turn everything that is not a latin letter into a
 * separator. Shared by the normaliser and by the part-of-day reader, so the two can
 * never disagree about how a word is spelled.
 */
function deaccentWords(s: string): string {
  if (typeof s !== "string") return "";

  return s
    .toLowerCase()
    // NFD splits ą ć ę ń ó ś ź ż into a base letter plus a combining mark, which the
    // next replace removes. It does NOT touch "ł" — U+0142 is a letter in its own
    // right, not a composed one — so that one needs an explicit substitution, or
    // "Siłownia" and "silownia" would stay two different strings.
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Everything that is not a latin letter becomes a separator: digits, punctuation,
    // emoji. "Vipassana 20 min" and "Vipassana!" reach the same shape.
    .replace(/[^a-z]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Which part of the day a title names, or null when it names none - or more than one,
 * which is no signal at all ("rano albo wieczorem").
 */
function dayPartOf(s: string): "rano" | "dzien" | "wieczor" | null {
  const words = deaccentWords(s);
  if (!words) return null;

  let found: "rano" | "dzien" | "wieczor" | null = null;
  for (const token of words.split(" ")) {
    const part = DAY_PART_WORDS[token];
    if (!part) continue;
    if (found && found !== part) return null;
    found = part;
  }
  return found;
}

/**
 * Lowercase, strip Polish accents, drop numbers / units / time-of-day / frequency
 * words, squash whitespace. Used on both sides of every comparison.
 */
export function normalizeForMatch(s: string): string {
  const deaccented = deaccentWords(s);
  if (!deaccented) return "";

  const tokens = deaccented.split(" ").filter((t) => t && !NOISE_WORDS.has(t));
  const joined = tokens.join(" ");

  // Guard: a habit called literally "Rano" would normalise to nothing, and an empty
  // string would then look identical to every other empty one. Keep the plain
  // de-accented text instead of producing a match-everything value.
  return joined || deaccented;
}

/* ------------------------------------------------------------------ */
/*  Matching                                                           */
/* ------------------------------------------------------------------ */

export interface HabitLike {
  id: string;
  name: string;
}

export interface HabitMatch {
  habitId: string;
  confidence: number;
}

/** A shared word shorter than this proves nothing: "na", "do", "sie" join everything. */
const MIN_SHARED_WORD_LEN = 4;
/** Below this share of the shorter title the two names are simply different things. */
const MIN_OVERLAP = 0.6;
/** Word overlap never outranks a full containment match (0.9). */
const MAX_OVERLAP_CONFIDENCE = 0.85;
const EPSILON = 1e-9;

/**
 * Best habit for a day-plan task name, or null.
 *
 * Order of the rules:
 *  0. opposite parts of the day                       -> no match at all
 *  1. equal after normalisation                       -> 1
 *  2. one title contains the other whole (word-wise)  -> 0.9
 *  3. shared words / words of the shorter title       -> the ratio, from 0.6 up,
 *     counting only shared words of at least 4 characters
 *
 * A draw at the top returns null on purpose: with two similar habits ("Nauka
 * angielskiego" and "Nauka niemieckiego") a wrong link would tick the wrong habit
 * every day, and not linking costs one extra tap.
 */
export function matchHabit(activityName: string, habits: HabitLike[]): HabitMatch | null {
  const na = normalizeForMatch(activityName);
  if (!na) return null;

  const aTokens = na.split(" ");
  const aSet = new Set(aTokens);
  const aPart = dayPartOf(activityName);

  let best: HabitMatch | null = null;
  let tied = false;

  for (const habit of habits) {
    if (!habit?.id) continue;
    const nh = normalizeForMatch(habit.name);
    if (!nh) continue;

    // Opposite parts of the day are two different acts, however identical the rest of
    // the words are: "Suplementy rano" (D3 do sniadania) is not "Suplementy wieczorem"
    // (magnez). One side saying nothing about the time is fine - "Spacer" still matches
    // "Spacer wieczorem".
    const hPart = dayPartOf(habit.name);
    if (aPart && hPart && aPart !== hPart) continue;

    const hTokens = nh.split(" ");
    let confidence = 0;

    if (na === nh) {
      confidence = 1;
    } else if (` ${na} `.includes(` ${nh} `) || ` ${nh} `.includes(` ${na} `)) {
      // Padded with spaces so containment is word-aligned: "bieg" must not swallow
      // "biegunka", but "vipassana" inside "vipassana z oddechem" is a real hit.
      confidence = 0.9;
    } else {
      let shared = 0;
      const seen = new Set<string>();
      for (let i = 0; i < hTokens.length; i++) {
        const t = hTokens[i];
        if (t.length < MIN_SHARED_WORD_LEN || seen.has(t)) continue;
        seen.add(t);
        if (aSet.has(t)) shared++;
      }
      const shorter = Math.min(aTokens.length, hTokens.length);
      const ratio = shorter > 0 ? shared / shorter : 0;
      confidence = ratio >= MIN_OVERLAP ? Math.min(ratio, MAX_OVERLAP_CONFIDENCE) : 0;
    }

    if (confidence <= 0) continue;

    if (!best || confidence > best.confidence + EPSILON) {
      best = { habitId: habit.id, confidence };
      tied = false;
    } else if (Math.abs(confidence - best.confidence) <= EPSILON) {
      tied = true;
    }
  }

  // Better no link than the wrong link.
  if (!best || tied) return null;
  return best;
}

/* ------------------------------------------------------------------ */
/*  Days                                                               */
/* ------------------------------------------------------------------ */

const POLISH_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today in Warsaw, as the UTC midnight a `@db.Date` column stores. */
export function polishDayDate(now: Date = new Date()): Date {
  const { from } = polishDayBounds(now);
  // `from` is Polish midnight expressed as a UTC instant; formatting it back in
  // Warsaw gives the calendar date the owner is actually living in.
  return new Date(`${POLISH_DATE_FMT.format(from)}T00:00:00.000Z`);
}

/**
 * The date the rest of the app writes into `DailyLog.date` (`startOfDay(new Date())`).
 * On the UTC container this is the same instant as `polishDayDate` for 22 hours a day;
 * they drift apart only between Polish midnight and 02:00.
 */
export function appDayDate(now: Date = new Date()): Date {
  return startOfDay(now);
}

/**
 * Which day plans to mirror a habit tick onto. One entry almost always; two only
 * inside the short window where the UTC day and the Polish day disagree, so a tick
 * at 00:30 still reaches the plan the owner is looking at.
 */
export function habitDayCandidates(now: Date = new Date()): Date[] {
  const polish = polishDayDate(now);
  const app = appDayDate(now);
  return polish.getTime() === app.getTime() ? [polish] : [polish, app];
}

/**
 * Which day a habit completion belongs to when the tick came from a plan activity.
 *
 * For today's plan it is the Polish day — exactly what /api/habits/toggle writes, so
 * both directions land on the same row. For an older plan it is that plan's own day,
 * because ticking Monday's task must not mark the habit done today.
 */
export function habitDateForLog(logDate: Date, now: Date = new Date()): Date {
  const polish = polishDayDate(now);
  const app = appDayDate(now);
  const t = logDate.getTime();
  if (t === polish.getTime() || t === app.getTime()) return polish;
  return logDate;
}

/* ------------------------------------------------------------------ */
/*  Writing the links                                                  */
/* ------------------------------------------------------------------ */

/**
 * Match this day's still-unlinked activities against the user's active habits and
 * store the winners in `Activity.habitId`. Returns how many links were written.
 *
 * Called once per plan generation / regeneration. Never on read.
 */
export async function linkActivitiesToHabits(
  userId: string,
  dailyLogId: string
): Promise<number> {
  if (!userId || !dailyLogId) return 0;

  // Ownership check: a dailyLogId from elsewhere must not be writable through here.
  const log = await prisma.dailyLog.findUnique({
    where: { id: dailyLogId },
    select: { id: true, userId: true },
  });
  if (!log || log.userId !== userId) return 0;

  const [habits, activities] = await Promise.all([
    prisma.habit.findMany({
      where: { userId, active: true },
      select: { id: true, name: true },
    }),
    prisma.activity.findMany({
      where: { dailyLogId: log.id, habitId: null },
      select: { id: true, name: true },
    }),
  ]);

  if (habits.length === 0 || activities.length === 0) return 0;

  // Group by habit so one UPDATE covers every activity that matched it.
  const byHabit = new Map<string, string[]>();
  for (const activity of activities) {
    const match = matchHabit(activity.name, habits);
    if (!match) continue;
    const bucket = byHabit.get(match.habitId);
    if (bucket) bucket.push(activity.id);
    else byHabit.set(match.habitId, [activity.id]);
  }

  let linked = 0;
  const entries = Array.from(byHabit.entries());
  for (let i = 0; i < entries.length; i++) {
    const [habitId, ids] = entries[i];
    // `habitId: null` in the filter keeps a second run a no-op instead of a rewrite.
    const res = await prisma.activity.updateMany({
      where: { id: { in: ids }, habitId: null },
      data: { habitId },
    });
    linked += res.count;
  }

  return linked;
}
