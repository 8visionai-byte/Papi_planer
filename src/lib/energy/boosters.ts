/**
 * Small steps that raise an energy pillar.
 *
 * Owner, 2026-07-27: "powinna sugerowac krotki spacer, jakis 15-20 minutowy spacer
 * (...) i tez powinna sledzic trendy, a nie od razu dawac mi dwie godziny, bo to jest
 * glowny cel. Nie, na przyklad (...) po wysilku umyslowym zrobic wysilek fizyczny (...)
 * zeby podnosic ta moja energie sukcesywnie, ale nie zeby od razu iles godzin."
 *
 * So this file is deliberately a catalog of SHORT things, never of goals. The pillar
 * target for Ruch is 90 minutes and for Swieze powietrze 120 minutes, but nothing here
 * is allowed to be longer than 30 minutes: the target is reached with several steps
 * spread over the day, which is exactly what he asked for.
 *
 * No Prisma types and no import from ./index on purpose. `index.ts` re-exports this
 * file, so importing back from it would build a module cycle; everything needed here
 * is either plain data or read straight from the client.
 */

import { prisma } from "@/lib/db/prisma";

/* ------------------------------------------------------------------ */
/*  Hard limits                                                        */
/* ------------------------------------------------------------------ */

/**
 * The whole point of the change. A booster longer than this is not a booster, it is
 * the goal itself, and the owner rejected being handed the goal in one block.
 */
export const BOOSTER_MAX_MIN = 30;

/**
 * The rule the owner gave is "10 to 30 minutes", and every movement / mind / outdoor
 * step below respects it. Three items are 5 minutes because he named them himself as
 * one-gesture steps ("szklanka wody z sola") and stretching a glass of water into a
 * ten minute calendar block would be a lie about how long it takes.
 */
export const BOOSTER_MIN_MIN = 5;

/** A pillar above this is doing fine today; suggesting anything for it is noise. */
export const BOOSTER_SKIP_ABOVE_PERCENT = 80;

/** Default: two or three steps a day, together no longer than an hour. */
export const BOOSTER_MAX_COUNT = 3;
export const BOOSTER_MAX_TOTAL_MIN = 60;

/** "ponizej polowy" from the spec, reused for the multi-day trend. */
export const WEAK_PILLAR_PERCENT = 50;

/* ------------------------------------------------------------------ */
/*  Shape                                                              */
/* ------------------------------------------------------------------ */

/** Rough part of the day a step belongs to. Used to drop steps whose time has passed. */
export type BoosterSlot = "rano" | "dzien" | "wieczor";

const SLOT_HOURS: Record<BoosterSlot, { from: number; to: number }> = {
  rano: { from: 5, to: 11 },
  dzien: { from: 10, to: 18 },
  wieczor: { from: 17, to: 23 },
};

const SLOT_LABEL: Record<BoosterSlot, string> = {
  rano: "rano",
  dzien: "w ciągu dnia",
  wieczor: "wieczorem",
};

export interface BoosterLift {
  /** Pillar key from docs/ENERGIA-SPEC.md, e.g. "swieze-powietrze". */
  pillarKey: string;
  /** Fallback name, used only when the user's own pillar row is not at hand. */
  pillarName: string;
  /**
   * Roughly how many percentage points OF THAT PILLAR one repetition adds.
   *
   * Computed from the component targets and weights in the spec, at a body weight of
   * about 100 kg (water goal ~3000 ml, protein goal ~200 g). It is an estimate for
   * the mentor's sentence, never a promise: the real number is recomputed by
   * `scoreDay` after the activity is ticked off.
   */
  liftPercent: number;
}

export interface Booster {
  id: string;
  /** Ready to drop into the plan as an activity name. */
  title: string;
  durationMin: number;
  /** One of VALID_ACTIVITY_TYPES in lib/ai/plan-generator.ts. */
  type: string;
  /** Strongest lift first. `lifts[0]` is what the step is mainly for. */
  lifts: BoosterLift[];
  slots: BoosterSlot[];
  /** One short Polish sentence: how to do it, or when it works best. */
  cue: string;
}

/* ------------------------------------------------------------------ */
/*  Catalog                                                            */
/* ------------------------------------------------------------------ */

const RUCH = "ruch";
const SWIEZE = "swieze-powietrze";
const NAWODNIENIE = "nawodnienie";
const UMYSL = "umysl";
const SEN = "sen";
const ODZYWIANIE = "odzywianie";
const SUPLEMENTACJA = "suplementacja";

const N_RUCH = "Ruch";
const N_SWIEZE = "Świeże powietrze";
const N_NAWODNIENIE = "Nawodnienie";
const N_UMYSL = "Umysł";
const N_SEN = "Sen";
const N_ODZYWIANIE = "Odżywianie";
const N_SUPLEMENTACJA = "Suplementacja";

/**
 * Everything here is doable at home or right outside it, between other duties.
 *
 * The owner asked in so many words for steps that lift TWO pillars at once ("spacer
 * z oddychaniem", "wyjscie na dwor po pracy umyslowej"), so four entries carry two
 * lifts. `pickBoosters` prefers those when both pillars are actually weak.
 */
export const BOOSTERS: Booster[] = [
  {
    id: "spacer-oddech-15",
    title: "Spacer z oddychaniem, 15 minut",
    durationMin: 15,
    type: "exercise",
    // dwor 15/120*40 = 5 pkt, oddech 10/10*20 = 20 pkt -> 25 pkt swiezego powietrza.
    lifts: [
      { pillarKey: SWIEZE, pillarName: N_SWIEZE, liftPercent: 25 },
      { pillarKey: RUCH, pillarName: N_RUCH, liftPercent: 17 },
    ],
    slots: ["rano", "dzien", "wieczor"],
    cue: "Wolny marsz, oddech nosem, wydech dwa razy dłuższy niż wdech.",
  },
  {
    id: "spacer-20",
    title: "Spacer, 20 minut",
    durationMin: 20,
    type: "exercise",
    // ruch 20/90*100 = 22 pkt, dwor 20/120*40 = 7 pkt.
    lifts: [
      { pillarKey: RUCH, pillarName: N_RUCH, liftPercent: 22 },
      { pillarKey: SWIEZE, pillarName: N_SWIEZE, liftPercent: 7 },
    ],
    slots: ["dzien", "wieczor"],
    cue: "Najlepiej zaraz po dłuższym bloku pracy umysłowej, bez telefonu.",
  },
  {
    id: "worek-15",
    title: "Trening na worku, 15 minut",
    durationMin: 15,
    type: "training",
    lifts: [{ pillarKey: RUCH, pillarName: N_RUCH, liftPercent: 17 }],
    slots: ["dzien", "wieczor"],
    cue: "Krótkie rundy. Po bloku pracy umysłowej rozładowuje głowę szybciej niż przerwa przy biurku.",
  },
  {
    id: "rozciaganie-okno-10",
    title: "Rozciąganie z oddechem przy otwartym oknie, 10 minut",
    durationMin: 10,
    type: "exercise",
    // oddech 10/10*20 = 20 pkt swiezego powietrza, ruch 10/90*100 = 11 pkt.
    lifts: [
      { pillarKey: SWIEZE, pillarName: N_SWIEZE, liftPercent: 20 },
      { pillarKey: RUCH, pillarName: N_RUCH, liftPercent: 11 },
    ],
    slots: ["rano", "wieczor"],
    cue: "Okno na oścież, spokojny oddech przy każdym rozciągnięciu.",
  },
  {
    id: "marsz-w-domu-15",
    title: "Marsz albo rower w domu, 15 minut",
    durationMin: 15,
    type: "exercise",
    lifts: [{ pillarKey: RUCH, pillarName: N_RUCH, liftPercent: 17 }],
    slots: ["rano", "dzien", "wieczor"],
    cue: "Wersja na deszcz i na dzień bez wyjścia z domu.",
  },
  {
    id: "rozciaganie-10",
    title: "Rozciąganie, 10 minut",
    durationMin: 10,
    type: "exercise",
    lifts: [{ pillarKey: RUCH, pillarName: N_RUCH, liftPercent: 11 }],
    slots: ["rano", "dzien", "wieczor"],
    cue: "Biodra, plecy, barki. Liczy się do minut ruchu tak samo jak trening.",
  },
  {
    id: "slonce-20",
    title: "Wyjście na słońce, 20 minut",
    durationMin: 20,
    type: "health",
    // dwor 20/120*40 = 7 pkt, slonce 20/120*40 = 7 pkt.
    lifts: [{ pillarKey: SWIEZE, pillarName: N_SWIEZE, liftPercent: 13 }],
    slots: ["rano", "dzien"],
    cue: "Po bloku pracy umysłowej, twarz i przedramiona odsłonięte.",
  },
  {
    id: "oddech-10",
    title: "Przerwa oddechowa przy otwartym oknie, 10 minut",
    durationMin: 10,
    type: "mindset",
    lifts: [{ pillarKey: SWIEZE, pillarName: N_SWIEZE, liftPercent: 20 }],
    slots: ["rano", "dzien", "wieczor"],
    cue: "Dziesięć minut zamyka dzienny cel ćwiczeń oddechowych w całości.",
  },
  {
    id: "woda-lyki-10",
    title: "Dolewka wody: 500 ml małymi łykami, ze szkła",
    durationMin: 10,
    type: "health",
    // nawyk "male lyki" 25 pkt + 500 ml z celu okolo 3000 ml -> 8 pkt.
    lifts: [{ pillarKey: NAWODNIENIE, pillarName: N_NAWODNIENIE, liftPercent: 33 }],
    slots: ["rano", "dzien", "wieczor"],
    cue: "Szklanka postawiona na widoku, wypijana łykami między zadaniami.",
  },
  {
    id: "woda-sol-5",
    title: "Szklanka wody z solą",
    durationMin: 5,
    type: "health",
    // bool "woda z sola" 25 pkt + 300 ml -> 5 pkt.
    lifts: [{ pillarKey: NAWODNIENIE, pillarName: N_NAWODNIENIE, liftPercent: 30 }],
    slots: ["rano"],
    cue: "Szczypta soli do szklanki wody, najlepiej zaraz po wstaniu.",
  },
  {
    id: "nauka-30",
    title: "Nauka, 30 minut",
    durationMin: 30,
    type: "study",
    // nauka 30/45*40 = 27 pkt filaru Umysl.
    lifts: [{ pillarKey: UMYSL, pillarName: N_UMYSL, liftPercent: 27 }],
    slots: ["rano", "dzien"],
    cue: "Jeden temat, bez przeskakiwania. Po tym bloku zaplanuj ruch, nie kolejny ekran.",
  },
  {
    id: "vipassana-30",
    title: "Sesja Vipassany, 30 minut",
    durationMin: 30,
    type: "mindset",
    // vipassana 30/120*40 = 10 pkt. Cel to dwie godziny, wiec jedna sesja to kawalek.
    lifts: [{ pillarKey: UMYSL, pillarName: N_UMYSL, liftPercent: 10 }],
    slots: ["rano", "wieczor"],
    cue: "Kawałek dziennego celu dwóch godzin, nie całość. Rano albo wieczorem.",
  },
  {
    id: "vipassana-20",
    title: "Krótka sesja Vipassany, 20 minut",
    durationMin: 20,
    type: "mindset",
    lifts: [{ pillarKey: UMYSL, pillarName: N_UMYSL, liftPercent: 7 }],
    slots: ["rano", "wieczor"],
    cue: "Wersja na zapchany dzień. Lepiej dwadzieścia minut niż zero.",
  },
  {
    id: "posilek-plan-20",
    title: "Posiłek dokładnie z planu, 20 minut",
    durationMin: 20,
    type: "nutrition",
    lifts: [{ pillarKey: ODZYWIANIE, pillarName: N_ODZYWIANIE, liftPercent: 20 }],
    slots: ["dzien"],
    cue: "Bez improwizacji. To domyka składową posiłków z planu na cały dzień.",
  },
  {
    id: "bialko-15",
    title: "Porcja białka, 50 g, do najbliższego posiłku",
    durationMin: 15,
    type: "nutrition",
    lifts: [{ pillarKey: ODZYWIANIE, pillarName: N_ODZYWIANIE, liftPercent: 8 }],
    slots: ["dzien"],
    cue: "Dołożone do posiłku, który i tak jest w planie.",
  },
  {
    id: "sypialnia-10",
    title: "Przewietrz sypialnię, 10 minut",
    durationMin: 10,
    type: "health",
    lifts: [{ pillarKey: SEN, pillarName: N_SEN, liftPercent: 10 }],
    slots: ["wieczor"],
    cue: "Okno na oścież na dziesięć minut przed pójściem spać.",
  },
  {
    id: "bez-ekranu-30",
    title: "Trzydzieści minut bez ekranu przed snem",
    durationMin: 30,
    type: "rest",
    lifts: [{ pillarKey: SEN, pillarName: N_SEN, liftPercent: 15 }],
    slots: ["wieczor"],
    cue: "Telefon i laptop odłożone. Książka, rozciąganie albo nic.",
  },
  {
    id: "magnez-5",
    title: "Magnez wieczorem",
    durationMin: 5,
    type: "health",
    lifts: [{ pillarKey: SUPLEMENTACJA, pillarName: N_SUPLEMENTACJA, liftPercent: 20 }],
    slots: ["wieczor"],
    cue: "Wieczorem, bo wspiera sen.",
  },
  {
    id: "d3k2-5",
    title: "Witamina D3 z K2 do śniadania",
    durationMin: 5,
    type: "health",
    lifts: [{ pillarKey: SUPLEMENTACJA, pillarName: N_SUPLEMENTACJA, liftPercent: 20 }],
    slots: ["rano"],
    cue: "Rano, do posiłku z tłuszczem.",
  },
];

/* ------------------------------------------------------------------ */
/*  Picking                                                            */
/* ------------------------------------------------------------------ */

export interface BoosterPillarState {
  key: string;
  name: string;
  percent: number;
}

/**
 * Whatever the caller knows about today's pillars.
 *
 * `EnergySummary` from ./index satisfies this shape as it stands, so a caller can pass
 * `userCtx.energy` straight in. `pillars` is the richer option (the full
 * `EnergyDayView.pillars`) for callers that already hold every percentage.
 */
export interface PickBoostersInput {
  weakestToday?: BoosterPillarState | null;
  /** Pillars below 60% today, weakest first. */
  belowTarget?: BoosterPillarState[];
  /** Every pillar with today's percentage, when the caller has it. */
  pillars?: BoosterPillarState[];
}

export interface PickBoostersOptions {
  /** Used to drop steps whose part of the day is already gone. */
  now?: Date;
  maxCount?: number;
  maxTotalMinutes?: number;
  /** Pillar above this gets nothing. */
  skipAbovePercent?: number;
  /** Booster ids to leave out, e.g. because the user already did them today. */
  excludeIds?: string[];
}

const POLISH_HOUR_FMT = new Intl.DateTimeFormat("pl-PL", {
  hour: "2-digit",
  hour12: false,
  timeZone: "Europe/Warsaw",
});

/** The container runs on UTC, so `getHours()` is not the hour the user is living in. */
function polishHour(now: Date): number {
  const parsed = parseInt(POLISH_HOUR_FMT.format(now), 10);
  return Number.isFinite(parsed) ? parsed : 12;
}

/** A step is still usable if at least one of its slots has not closed yet. */
function fitsRestOfDay(booster: Booster, hour: number): boolean {
  return booster.slots.some((s) => SLOT_HOURS[s].to > hour);
}

function collectStates(input: PickBoostersInput | null | undefined): BoosterPillarState[] {
  if (!input) return [];
  if (input.pillars && input.pillars.length > 0) return [...input.pillars];

  // Fall back to what EnergySummary carries: everything below 60% plus the weakest
  // pillar, which is listed even on a day where nothing dropped below 60. That second
  // part matters: it is how a decent-but-not-great day still gets one small step,
  // which is the "sukcesywnie" the owner asked for.
  const byKey = new Map<string, BoosterPillarState>();
  for (const p of input.belowTarget ?? []) byKey.set(p.key, p);
  if (input.weakestToday) byKey.set(input.weakestToday.key, input.weakestToday);
  return [...byKey.values()];
}

/**
 * Two or three short steps for today, weakest pillar first.
 *
 * Rules, all from the owner's brief:
 *  - never two steps for the same pillar (one activity per pillar, and a step that
 *    lifts two pillars closes both),
 *  - the whole set stays under an hour,
 *  - a step that lifts two WEAK pillars beats one that lifts a single pillar,
 *  - a pillar already above 80% gets nothing.
 */
export function pickBoosters(
  input: PickBoostersInput | null | undefined,
  opts: PickBoostersOptions = {}
): Booster[] {
  const maxCount = opts.maxCount ?? BOOSTER_MAX_COUNT;
  const maxTotal = opts.maxTotalMinutes ?? BOOSTER_MAX_TOTAL_MIN;
  const skipAbove = opts.skipAbovePercent ?? BOOSTER_SKIP_ABOVE_PERCENT;
  const hour = polishHour(opts.now ?? new Date());
  const excluded = new Set(opts.excludeIds ?? []);

  const eligible = collectStates(input)
    .filter((p) => Number.isFinite(p.percent) && p.percent <= skipAbove)
    .sort((a, b) => a.percent - b.percent);

  if (eligible.length === 0) return [];

  const eligibleKeys = new Set(eligible.map((p) => p.key));
  const covered = new Set<string>();
  const picked: Booster[] = [];
  let usedMinutes = 0;

  for (const pillar of eligible) {
    if (picked.length >= maxCount) break;
    if (covered.has(pillar.key)) continue;

    const candidates = BOOSTERS.filter((b) => {
      if (excluded.has(b.id)) return false;
      if (b.durationMin > BOOSTER_MAX_MIN || b.durationMin < BOOSTER_MIN_MIN) return false;
      if (usedMinutes + b.durationMin > maxTotal) return false;
      if (!fitsRestOfDay(b, hour)) return false;
      if (!b.lifts.some((l) => l.pillarKey === pillar.key)) return false;
      // One activity per pillar: a step must not touch a pillar already served.
      return b.lifts.every((l) => !covered.has(l.pillarKey));
    });

    if (candidates.length === 0) continue;

    const best = candidates
      .map((b) => {
        const onTarget = b.lifts.find((l) => l.pillarKey === pillar.key)?.liftPercent ?? 0;
        // Extra weak pillars this one step also closes. The owner asked for exactly
        // this ("ruch na swiezym powietrzu"), so it outranks raw lift size.
        const extraWeak = b.lifts.filter(
          (l) => l.pillarKey !== pillar.key && eligibleKeys.has(l.pillarKey)
        ).length;
        return { booster: b, rank: extraWeak * 1000 + onTarget * 10 - b.durationMin };
      })
      .sort((a, b) => b.rank - a.rank)[0].booster;

    picked.push(best);
    usedMinutes += best.durationMin;
    for (const l of best.lifts) covered.add(l.pillarKey);
  }

  return picked;
}

/* ------------------------------------------------------------------ */
/*  Trend: how many days in a row a pillar has been weak                */
/* ------------------------------------------------------------------ */

const POLISH_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today in Warsaw as "YYYY-MM-DD", even though the server clock is UTC. */
function polishDateKey(now: Date): string {
  return POLISH_DATE_FMT.format(now);
}

function shiftDateKey(key: string, deltaDays: number): string {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function dateKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function readPillarScore(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const pillars = (raw as Record<string, unknown>).pillars;
  if (!pillars || typeof pillars !== "object" || Array.isArray(pillars)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(pillars as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export interface WeakStreakOptions {
  threshold?: number;
  /** How far back to walk. Longer streaks than this are simply reported as this. */
  lookbackDays?: number;
  now?: Date;
}

/**
 * For every pillar: how many FINISHED days in a row, counting back from yesterday, it
 * stayed below the threshold.
 *
 * Today is left out on purpose. At 09:00 every pillar is honestly near zero because
 * the day has not been lived yet, and counting it would turn "trzeci dzien z rzedu"
 * into a sentence the app prints every single morning. The plan generator adds today
 * back in only when today's pillar is genuinely weak (see `describeWeakStreak`).
 *
 * A day with no energy entry breaks the streak instead of extending it: a day nobody
 * filled in is missing data, not a bad day.
 */
export async function getWeakPillarStreaks(
  userId: string,
  opts: WeakStreakOptions = {}
): Promise<Record<string, number>> {
  const threshold = opts.threshold ?? WEAK_PILLAR_PERCENT;
  const lookback = Math.max(1, Math.min(30, opts.lookbackDays ?? 14));
  const todayKey = polishDateKey(opts.now ?? new Date());
  const fromKey = shiftDateKey(todayKey, -lookback);
  const toKey = shiftDateKey(todayKey, -1);

  let rows: Array<{ date: Date; score: unknown }> = [];
  try {
    rows = await prisma.energyEntry.findMany({
      where: { userId, date: { gte: dateKeyToDate(fromKey), lte: dateKeyToDate(toKey) } },
      orderBy: { date: "desc" },
      select: { date: true, score: true },
    });
  } catch {
    // The energy tables reach production only after the container restarts and
    // `prisma db push` runs. A missing table must degrade into "no trend", never
    // into a failed day plan.
    return {};
  }

  const byDate = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const pillars = readPillarScore(r.score);
    if (pillars) byDate.set(r.date.toISOString().slice(0, 10), pillars);
  }

  const yesterday = byDate.get(toKey);
  if (!yesterday) return {};

  const alive = new Set(
    Object.keys(yesterday).filter((k) => yesterday[k] < threshold)
  );
  const out: Record<string, number> = {};

  for (let i = 1; i <= lookback && alive.size > 0; i++) {
    const day = byDate.get(shiftDateKey(todayKey, -i));
    if (!day) break;
    for (const key of [...alive]) {
      const percent = day[key];
      if (typeof percent === "number" && percent < threshold) {
        out[key] = (out[key] ?? 0) + 1;
      } else {
        alive.delete(key);
      }
    }
  }

  return out;
}

const ORDINALS: Record<number, string> = {
  2: "drugi",
  3: "trzeci",
  4: "czwarty",
  5: "piąty",
  6: "szósty",
  7: "siódmy",
};

/**
 * "trzeci dzien z rzedu ponizej polowy", or null when one weak day is all there is.
 *
 * `previousWeakDays` counts finished days only, so today is added here. Below two days
 * in total there is nothing to say: one weak day is a day, not a trend.
 */
export function describeWeakStreak(previousWeakDays: number): string | null {
  const total = previousWeakDays + 1;
  if (total < 2) return null;
  const word = ORDINALS[total];
  return word
    ? `${word} dzień z rzędu poniżej połowy`
    : `${total} dzień z rzędu poniżej połowy`;
}

/* ------------------------------------------------------------------ */
/*  Prompt text                                                        */
/* ------------------------------------------------------------------ */

export interface BoosterPromptText {
  /** A whole section for the user message. Empty string when there is nothing to say. */
  block: string;
  /** Bullets to drop into the existing "Reguly" list. Each line already ends with \n. */
  rules: string;
}

/**
 * Turns picked steps into the two pieces of prompt the day plan needs.
 *
 * Percentages are looked up from `input`, never recomputed, so the number in the plan
 * note and the number on the energy screen are the same number.
 */
/** "1 punkt / 22 punkty / 25 punktow" - the model copies this wording into notes. */
function pointsWord(n: number): string {
  const abs = Math.abs(Math.round(n));
  if (abs === 1) return "punkt";
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return "punkty";
  return "punktów";
}

/** All three slots means "whenever"; spelling them out reads like a stutter. */
function whenLabel(slots: BoosterSlot[]): string {
  if (slots.length >= 3) return "o dowolnej porze dnia";
  return slots.map((s) => SLOT_LABEL[s]).join(" albo ");
}

export function formatBoostersForPrompt(
  picked: Booster[],
  input: PickBoostersInput | null | undefined,
  streaks: Record<string, number> = {}
): BoosterPromptText {
  if (picked.length === 0) return { block: "", rules: "" };

  const stateByKey = new Map(collectStates(input).map((p) => [p.key, p]));
  let anyStreak = false;

  const lines = picked.map((b) => {
    const main = b.lifts[0];
    const state = stateByKey.get(main.pillarKey);
    // The user can rename a pillar in settings, so his name wins over the catalog's.
    const name = state?.name ?? main.pillarName;
    const level = state ? `dziś na ${state.percent}%` : "dziś słaby";

    const extra = b.lifts
      .slice(1)
      .map((l) => stateByKey.get(l.pillarKey)?.name ?? l.pillarName);
    const extraPart =
      extra.length > 0 ? ` Przy okazji podnosi też: ${extra.join(", ")}.` : "";

    const when = whenLabel(b.slots);

    const streakDays = streaks[main.pillarKey] ?? 0;
    const streakText =
      state && state.percent < WEAK_PILLAR_PERCENT ? describeWeakStreak(streakDays) : null;
    if (streakText) anyStreak = true;
    const streakPart = streakText
      ? ` UWAGA: filar ${name} jest ${streakText}, powiedz to w notatce wprost.`
      : "";

    return (
      `- "${b.title}" (${b.durationMin} min). Podnosi filar ${name}, ${level}, ` +
      `o około ${main.liftPercent} ${pointsWord(main.liftPercent)}.${extraPart} Kiedy: ${when}. ${b.cue}${streakPart}`
    );
  });

  const block =
    `\n\n## Energia: małe kroki na dziś\n\n` +
    `Aplikacja policzyła, które filary energii są dziś najsłabsze, i dobrała pod nie ` +
    `krótkie czynności. Wpleć je w plan jako zwykłe pozycje.\n` +
    lines.join("\n");

  const rules =
    `- Czynności z sekcji "Energia: małe kroki na dziś" WPLEĆ MIĘDZY istniejące zadania, w sensownych godzinach. Nie doklejaj ich na koniec dnia i nie zbijaj w jeden blok\n` +
    `- Przeplataj wysiłek: po dłuższym bloku pracy umysłowej (45 minut lub więcej) zaplanuj krótki ruch albo wyjście na dwór, a nie kolejny blok umysłowy. Po ruchu może wrócić praca umysłowa, potem znowu coś fizycznego\n` +
    `- W polu notes każdej takiej pozycji napisz JEDNYM zdaniem, który filar ona podnosi i z jakiego poziomu, na przykład: "świeże powietrze masz dziś na 20%"\n` +
    `- ZAKAZ: żadna czynność dodana pod filar energii nie może trwać dłużej niż ${BOOSTER_MAX_MIN} minut. Nawet gdy cel filaru to dwie godziny, dochodzisz do niego kilkoma krótkimi krokami w ciągu dnia, nigdy jednym długim wyjściem\n` +
    `- Nie wymyślaj własnych czynności "na energię" poza tymi z listy i nie wydłużaj ich. Dwie albo trzy w ciągu dnia to komplet\n` +
    (anyStreak
      ? `- Gdy przy czynności stoi UWAGA o kilku dniach z rzędu, napisz to w notatce wprost, bo kilka słabych dni pod rząd to mocniejszy sygnał niż jeden\n`
      : "");

  return { block, rules };
}
