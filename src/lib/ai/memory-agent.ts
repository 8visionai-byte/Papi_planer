/**
 * Memory agent: reads a note the user just wrote about themselves and PROPOSES
 * what should change in their data. It never writes anything itself.
 *
 * The reason this file exists, in the user's own words: "zeby nie bylo sytuacji,
 * gdzie ja mu cos powiem, on usunie dane i pozniej jakies dane znikna". So the
 * entire output is a list of candidate changes that get parked as `ChangeProposal`
 * rows with status "pending". The accept step in `/api/proposals/[id]` is the only
 * place in the app that turns one of them into a real write.
 *
 * Two independent layers of defence, on purpose:
 *  1. here - the model may only name ids it was actually shown, only whitelisted
 *     fields, and only entity+action pairs the API knows how to apply;
 *  2. in the route - `sanitizePayload` runs AGAIN on the stored payload before it
 *     is written, because a pending row can sit in the table longer than this file
 *     stays unchanged.
 *
 * A failure here is never fatal: the note the user wrote is saved by the caller
 * first, and an empty proposal list is a perfectly good answer.
 */

import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS } from "@/lib/ai/claude";
// The reader of the plans decides what "switched off" means; this file only has to
// avoid offering the same plan twice.
import { isMentorPlanRetired } from "@/lib/ai/user-context";

/* ------------------------------------------------------------------ */
/*  Vocabulary                                                         */
/* ------------------------------------------------------------------ */

export const PROPOSAL_ENTITIES = [
  "goal",
  "insight",
  "habit",
  "profile",
  // Added 2026-07-27. Closing a goal was never enough: the exam the owner had
  // already passed lived in a mentor plan and in a mentor's systemPrompt as well,
  // and neither of them was reachable from any card he could tap.
  "mentorPlan",
  "mentor",
] as const;
export type ProposalEntity = (typeof PROPOSAL_ENTITIES)[number];

export const PROPOSAL_ACTIONS = ["create", "update", "deactivate"] as const;
export type ProposalAction = (typeof PROPOSAL_ACTIONS)[number];

export interface ProposedChange {
  entity: ProposalEntity;
  /** Row being changed. Always null for "create" and for the profile blob. */
  entityId: string | null;
  action: ProposalAction;
  /** One Polish sentence the user can judge without any other context. */
  summary: string;
  /** One short sentence: what he will NOTICE afterwards. Null when the model skipped it. */
  effect: string | null;
  /** Flat, already sanitised set of fields to write. */
  payload: Record<string, unknown>;
}

/**
 * Reserved payload key carrying {@link ProposedChange.effect}.
 *
 * It rides inside `payload` for one reason: `ChangeProposal` has no column for it
 * and the schema is frozen. It survives both sanitiser passes, and the accept step
 * strips it with {@link splitEffect} before any applier sees the payload - which
 * matters most for the profile, where the payload is merged into the blob wholesale.
 */
export const EFFECT_KEY = "skutek";

/**
 * Which actions the accept step can actually perform per entity. Anything outside
 * this table is dropped before it ever reaches the database - a proposal the API
 * would reject with 400 is only a dead card in the user's face.
 *
 * Note there is no hard delete anywhere: an insight that stopped being true is
 * "deactivate" (active = false), a habit likewise. History is never destroyed.
 */
const ALLOWED_COMBOS: Record<ProposalEntity, readonly ProposalAction[]> = {
  goal: ["update"],
  insight: ["create", "deactivate"],
  habit: ["update", "deactivate"],
  profile: ["update"],
  // A plan is only ever switched off, never edited and never deleted: the ticked
  // tasks inside it are the record that the work actually happened.
  mentorPlan: ["deactivate"],
  // A mentor's description is hand-written and long. The agent may correct the one
  // sentence that is out of date, and nothing else.
  mentor: ["update"],
};

/** Fields the accept step may write. Everything else in a payload is discarded. */
const FIELD_WHITELIST: Record<ProposalEntity, readonly string[]> = {
  goal: ["status", "outcome", "progress", "targetDate", "title", "description"],
  insight: ["kind", "title", "content", "confidence"],
  habit: ["name", "active", "cue", "routine", "reward", "why", "identity", "timeOfDay"],
  // The profile is a free-form JSON blob, so it has no fixed field list. It is
  // guarded by shape instead: flat, few keys, scalar values only. See below.
  profile: [],
  // Deactivation carries no fields at all; the route knows what it means.
  mentorPlan: [],
  // `removeFragment` / `replaceWith` are a surgical edit performed server-side on
  // the CURRENT prompt. `systemPrompt` (a full rewrite) is accepted too, but the
  // route refuses one that is much shorter than what is already there: the model is
  // shown a truncated prompt, and "rewrite it" would silently amputate the tail.
  mentor: ["systemPrompt", "removeFragment", "replaceWith"],
};

const GOAL_STATUSES = ["active", "achieved", "abandoned", "paused"] as const;
const CREATABLE_INSIGHT_KINDS = ["pattern", "preference", "milestone"] as const;
const HABIT_TIMES = ["morning", "afternoon", "evening", "any"] as const;

/**
 * Hard ceiling on how much one note may propose.
 *
 * Was five. One finished event now legitimately needs more than that: save the fact,
 * close the goal, switch off the plan built around it, fix the mentor description
 * that still announces it. Cutting that set in half leaves the app half-corrected,
 * which is exactly the state the owner complained about.
 */
export const MAX_PROPOSALS = 6;

/** Guard against a runaway model rewriting the whole profile blob in one card. */
const MAX_PROFILE_KEYS = 8;

export function isProposalEntity(value: unknown): value is ProposalEntity {
  return (
    typeof value === "string" && (PROPOSAL_ENTITIES as readonly string[]).includes(value)
  );
}

export function isProposalAction(value: unknown): value is ProposalAction {
  return (
    typeof value === "string" && (PROPOSAL_ACTIONS as readonly string[]).includes(value)
  );
}

/** True only for entity+action pairs the accept step implements. */
export function isAllowedCombo(entity: unknown, action: unknown): boolean {
  if (!isProposalEntity(entity) || !isProposalAction(action)) return false;
  return ALLOWED_COMBOS[entity].includes(action);
}

/* ------------------------------------------------------------------ */
/*  Payload sanitising                                                 */
/* ------------------------------------------------------------------ */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** "2026-09-01" and nothing else. Anything the Date constructor guesses at is refused. */
function asIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

/**
 * Profile patches have no schema, so they are limited by shape: a flat object,
 * at most a handful of keys, only strings / numbers / booleans / short string
 * arrays. Nested objects are refused, which is what stops a "profile update"
 * from quietly replacing a whole sub-tree of the blob.
 */
function sanitizeProfilePatch(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_PROFILE_KEYS) break;
    // Not a profile field: it is the sentence shown under the card. Re-attached by
    // the caller, never merged into the blob.
    if (key === EFFECT_KEY) continue;
    // Keys have to look like profile fields, not like prototype tricks.
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;

    if (typeof value === "string") {
      const s = asTrimmedString(value, 600);
      if (s) out[key] = s;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else if (Array.isArray(value)) {
      const items = value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean)
        .slice(0, 20);
      if (items.length > 0) out[key] = items;
    }
    // null / nested object: skipped. Clearing a profile field is a decision for a
    // human on the profile screen, not something an agent should slip into a card.
  }
  return out;
}

/**
 * Reduces a raw payload to exactly what the accept step is allowed to write.
 *
 * @returns the cleaned payload, or `null` when nothing usable is left (the caller
 *          must then drop the proposal - an empty update is a card that does nothing).
 */
export function sanitizePayload(
  entity: ProposalEntity,
  action: ProposalAction,
  raw: unknown,
): Record<string, unknown> | null {
  // The one key that survives every branch below, because it is not data at all:
  // it is the sentence shown under the card, and it is stripped again before the
  // payload reaches a database write.
  const effect = isPlainObject(raw) ? asTrimmedString(raw[EFFECT_KEY], 160) : null;
  const withEffect = (out: Record<string, unknown>) => {
    if (effect) out[EFFECT_KEY] = effect;
    return out;
  };

  // Deactivation carries no fields: the route knows what "deactivate" means for
  // each entity, so a payload could only be a way to smuggle in an extra write.
  if (action === "deactivate") return withEffect({});

  if (!isPlainObject(raw)) return null;

  if (entity === "profile") {
    const patch = sanitizeProfilePatch(raw);
    return Object.keys(patch).length > 0 ? withEffect(patch) : null;
  }

  const allowed = FIELD_WHITELIST[entity];
  const out: Record<string, unknown> = {};

  for (const key of allowed) {
    if (!(key in raw)) continue;
    const value = raw[key];

    switch (key) {
      case "status": {
        if (
          typeof value === "string" &&
          (GOAL_STATUSES as readonly string[]).includes(value)
        ) {
          out.status = value;
        }
        break;
      }
      case "progress": {
        const n = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(n)) out.progress = Math.min(100, Math.max(0, Math.round(n)));
        break;
      }
      case "targetDate": {
        const d = asIsoDate(value);
        if (d) out.targetDate = d;
        break;
      }
      case "confidence": {
        const n = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(n)) out.confidence = Math.min(1, Math.max(0, n));
        break;
      }
      case "active": {
        const b = asBoolean(value);
        if (b !== null) out.active = b;
        break;
      }
      case "kind": {
        if (
          typeof value === "string" &&
          (CREATABLE_INSIGHT_KINDS as readonly string[]).includes(value)
        ) {
          out.kind = value;
        }
        break;
      }
      case "timeOfDay": {
        if (typeof value === "string" && (HABIT_TIMES as readonly string[]).includes(value)) {
          out.timeOfDay = value;
        }
        break;
      }
      case "title":
      case "name": {
        const s = asTrimmedString(value, 120);
        if (s) out[key] = s;
        break;
      }
      case "identity": {
        const s = asTrimmedString(value, 160);
        if (s) out.identity = s;
        break;
      }
      case "systemPrompt": {
        // Mentor prompts run to 19 000 characters in production. The generic 1200
        // cap below would turn "poprawka jednego zdania" into a beheading.
        const s = asTrimmedString(value, 24000);
        if (s) out.systemPrompt = s;
        break;
      }
      case "removeFragment":
      case "replaceWith": {
        // One sentence out of the prompt, quoted exactly. Longer than this is not a
        // correction any more, it is a rewrite in disguise.
        const s = asTrimmedString(value, 400);
        if (s) out[key] = s;
        break;
      }
      default: {
        // Free text: content, description, outcome, cue, routine, reward, why.
        const s = asTrimmedString(value, 1200);
        if (s) out[key] = s;
      }
    }
  }

  if (entity === "insight" && action === "create") {
    // An insight without a body is not an insight.
    if (typeof out.content !== "string") return null;
    if (typeof out.title !== "string") out.title = (out.content as string).slice(0, 60);
    if (typeof out.kind !== "string") out.kind = "milestone";
  }

  if (entity === "mentor") {
    // Either "swap this exact sentence" or "here is the whole new text". A card
    // that says neither would be accepted and change nothing.
    const hasFragment = typeof out.removeFragment === "string";
    const hasFull = typeof out.systemPrompt === "string";
    if (!hasFragment && !hasFull) return null;
  }

  // `skutek` alone is a card that does nothing: it describes a change that is not
  // there. The caller drops the whole proposal on null.
  const writes = Object.keys(out).filter((k) => k !== EFFECT_KEY);
  return writes.length > 0 ? withEffect(out) : null;
}

/**
 * Splits the display sentence off a stored payload.
 *
 * Called by the accept step before dispatching to an applier, so `skutek` can never
 * be written into a goal, a habit or - the case that would actually hurt - merged
 * into the profile blob.
 */
export function splitEffect(payload: Record<string, unknown>): {
  effect: string | null;
  data: Record<string, unknown>;
} {
  const { [EFFECT_KEY]: raw, ...data } = payload;
  return { effect: typeof raw === "string" && raw.trim() ? raw.trim() : null, data };
}

/* ------------------------------------------------------------------ */
/*  Memory snapshot                                                    */
/* ------------------------------------------------------------------ */

interface MemorySnapshot {
  insights: {
    id: string;
    kind: string;
    /** "user" rows are the user's own words and may never be proposed for removal. */
    origin: string;
    title: string;
    content: string;
  }[];
  goals: { id: string; title: string; status: string; targetDate: Date | null }[];
  habits: { id: string; name: string; active: boolean }[];
  /** Weekly plans still reaching the AI. A retired one is not offered again. */
  plans: {
    id: string;
    mentorName: string;
    goalTitle: string | null;
    weekNumber: number;
    taskTitles: string[];
  }[];
  /** Mentor descriptions - only the passage that talks about what the note says. */
  mentors: { id: string; name: string; promptExcerpt: string }[];
}

/**
 * Lower case, no Polish diacritics. A local four-liner rather than an import: the
 * prompt-rendering module deaccents for a different purpose (budgeted output), and
 * coupling a data agent to its stemming rules buys nothing.
 * Built from a string so the source file stays plain ASCII.
 */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

function plain(s: string): string {
  return s
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase();
}

/** Polish glue that would match every prompt ever written. */
const NOTE_STOPWORDS = new Set([
  "ktory", "ktora", "ktore", "zeby", "bardzo", "wiec", "tego", "jest", "jestem",
  "moje", "moja", "przez", "przed", "oraz", "albo", "juz", "nie", "tak", "takze",
  "rowniez", "ponieważ", "poniewaz", "dlatego", "wszystko", "jeszcze", "potrzebuje",
  "musze", "chce", "mam", "sie",
]);

/** Content words of the note, shortened to a prefix so Polish endings do not matter. */
function noteKeywords(note: string): string[] {
  const out = new Set<string>();
  for (const w of plain(note).split(/[^a-z0-9]+/)) {
    if (w.length < 5 || NOTE_STOPWORDS.has(w)) continue;
    out.add(w.slice(0, 6));
  }
  return Array.from(out).slice(0, 12);
}

/** Half-width of the passage handed to the model, in characters. */
const EXCERPT_RADIUS = 450;

/**
 * The passage of a mentor prompt the note is actually about, or `null` when the
 * note has nothing to do with this mentor.
 *
 * Not "the first 900 characters": the karate mentor's prompt is 6 600 characters
 * long and the sentence that matters ("Egzamin na zielona belke: za ~4 tygodnie")
 * sits in the middle of it. The window is placed where the note's words cluster
 * most densely, which is how a paragraph headed "KARATE - STATUS" wins over a
 * passing mention of karate in a list of sports.
 */
function pickPromptExcerpt(systemPrompt: string, keys: string[]): string | null {
  if (keys.length === 0) return null;
  const hay = plain(systemPrompt);

  const positions: number[] = [];
  for (const k of keys) {
    let from = 0;
    while (positions.length < 400) {
      const i = hay.indexOf(k, from);
      if (i < 0) break;
      positions.push(i);
      from = i + k.length;
    }
  }
  if (positions.length === 0) return null;

  let bestPos = positions[0];
  let bestScore = -1;
  for (const pos of positions) {
    const window = hay.slice(Math.max(0, pos - 300), pos + 300);
    const score = keys.filter((k) => window.includes(k)).length;
    if (score > bestScore) {
      bestScore = score;
      bestPos = pos;
    }
  }

  const start = Math.max(0, bestPos - EXCERPT_RADIUS);
  const end = Math.min(systemPrompt.length, bestPos + EXCERPT_RADIUS);
  const head = start > 0 ? "..." : "";
  const tail = end < systemPrompt.length ? "..." : "";
  return `${head}${systemPrompt.slice(start, end).trim()}${tail}`;
}

/** Ids and titles only. The model needs to recognise a row, not to re-read it. */
async function loadSnapshot(userId: string, note: string): Promise<MemorySnapshot> {
  const [insights, goals, habits, plans, mentors] = await Promise.all([
    prisma.userInsight.findMany({
      where: { userId, active: true },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      select: { id: true, kind: true, origin: true, title: true, content: true },
      take: 30,
    }),
    prisma.goal.findMany({
      where: { userId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      select: { id: true, title: true, status: true, targetDate: true },
      take: 30,
    }),
    prisma.habit.findMany({
      where: { userId },
      orderBy: [{ active: "desc" }, { sortOrder: "asc" }],
      select: { id: true, name: true, active: true },
      take: 40,
    }),
    prisma.mentorPlan.findMany({
      where: { userId },
      orderBy: { weekNumber: "desc" },
      select: {
        id: true,
        weekNumber: true,
        tasks: true,
        notes: true,
        mentor: { select: { name: true } },
        goal: { select: { title: true } },
      },
      take: 12,
    }),
    prisma.mentor.findMany({
      where: { userId, active: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, systemPrompt: true },
      take: 12,
    }),
  ]);

  const keys = noteKeywords(note);

  return {
    insights,
    goals,
    habits,
    plans: plans
      // Already switched off: offering it again is a card that changes nothing.
      .filter((p) => !isMentorPlanRetired(p.notes))
      .map((p) => ({
        id: p.id,
        mentorName: p.mentor.name,
        goalTitle: p.goal?.title ?? null,
        weekNumber: p.weekNumber,
        taskTitles: (Array.isArray(p.tasks) ? (p.tasks as { title?: unknown }[]) : [])
          .map((t) => (typeof t.title === "string" ? t.title : ""))
          .filter(Boolean),
      })),
    // Only mentors whose description touches the subject of the note. A mentor the
    // note says nothing about is not shown, so it cannot be "corrected" by mistake.
    mentors: mentors
      .map((m) => ({
        id: m.id,
        name: m.name,
        promptExcerpt: pickPromptExcerpt(m.systemPrompt, keys),
      }))
      .filter((m): m is { id: string; name: string; promptExcerpt: string } =>
        m.promptExcerpt !== null
      )
      .slice(0, 4),
  };
}

function snapshotToText(snapshot: MemorySnapshot): string {
  const lines: string[] = [];

  lines.push("AKTYWNE WNIOSKI (id | rodzaj | zrodlo | tytul | tresc):");
  if (snapshot.insights.length === 0) {
    lines.push("- brak");
  } else {
    for (const i of snapshot.insights) {
      const body = i.content.replace(/\s*\n+\s*/g, " ").slice(0, 160);
      // "TWOJE SLOWA" is not a label, it is a fence: these rows are off limits for
      // deactivation, and the model has to be able to see which ones they are.
      const src = i.origin === "user" ? "TWOJE SLOWA" : "aplikacja";
      lines.push(`- ${i.id} | ${i.kind} | ${src} | ${i.title} | ${body}`);
    }
  }

  lines.push("", "CELE (id | status | termin | tytul):");
  if (snapshot.goals.length === 0) {
    lines.push("- brak");
  } else {
    for (const g of snapshot.goals) {
      const date = g.targetDate ? g.targetDate.toISOString().slice(0, 10) : "bez terminu";
      lines.push(`- ${g.id} | ${g.status} | ${date} | ${g.title}`);
    }
  }

  lines.push("", "NAWYKI (id | aktywny | nazwa):");
  if (snapshot.habits.length === 0) {
    lines.push("- brak");
  } else {
    for (const h of snapshot.habits) {
      lines.push(`- ${h.id} | ${h.active ? "tak" : "nie"} | ${h.name}`);
    }
  }

  lines.push("", "PLANY TYGODNIOWE MENTOROW (id | mentor | cel | tydzien | zadania):");
  if (snapshot.plans.length === 0) {
    lines.push("- brak");
  } else {
    for (const p of snapshot.plans) {
      // Task titles are the whole point: this is where "tydzien egzaminowy" hides,
      // under a goal that is still perfectly active.
      const tasks = p.taskTitles.map((t) => t.slice(0, 90)).join(" // ").slice(0, 420);
      lines.push(
        `- ${p.id} | ${p.mentorName} | ${p.goalTitle ?? "bez celu"} | tydzien ${p.weekNumber} | ${tasks}`
      );
    }
  }

  lines.push("", "OPISY MENTOROW, fragmenty dotyczace notatki (id | mentor | fragment):");
  if (snapshot.mentors.length === 0) {
    lines.push("- brak");
  } else {
    for (const m of snapshot.mentors) {
      lines.push(`- ${m.id} | ${m.name} | ${m.promptExcerpt.replace(/\s*\n+\s*/g, " ")}`);
    }
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Prompt                                                             */
/* ------------------------------------------------------------------ */

const SYSTEM = `Jestes agentem pamieci aplikacji rozwojowej. Uzytkownik wlasnie zapisal notatke o sobie.
Twoje zadanie: sprawdzic, czy ta notatka zmienia cokolwiek w JEGO ZAPISANYCH DANYCH, i zaproponowac zmiany do akceptacji.

GDY COS SIE SKONCZYLO, SPRZATNIJ WSZYSTKIE MIEJSCA
Kiedy uzytkownik pisze, ze cos ma juz za soba (zdal egzamin, zamknal projekt, przestal cos robic), zapisanie samej notatki NIE WYSTARCZY. To samo wydarzenie siedzi w kilku miejscach naraz i kazde trzeba zamknac osobno. Przejdz po kolei przez listy ponizej i zaproponuj komplet:
1. zapisz fakt w pamieci (insight + create), zeby aplikacja pamietala go na stale,
2. zamknij cel, ktory dotyczyl TEGO wydarzenia (goal + update, status "achieved" gdy sie udalo, "abandoned" gdy odpuscil),
3. wylacz plany tygodniowe, ktorych zadania mowia o tym wydarzeniu (mentorPlan + deactivate),
4. popraw opis mentora, jesli zapowiada to wydarzenie jako przyszle (mentor + update).
Kazda zmiana to OSOBNA pozycja, zeby uzytkownik mogl przyjac jedne i odrzucic inne.

CZEGO NIE RUSZASZ
- Dyscyplina to nie to samo co wydarzenie. Koniec egzaminu z karate nie oznacza konca karate: cele o nauce kombinacji albo sile uderzen zostaja aktywne. Zamykaj wylacznie to, co notatka nazywa skonczonym.
- Wnioski oznaczone jako TWOJE SLOWA to zapis tego, co uzytkownik sam napisal. NIGDY nie proponujesz ich wylaczenia ani zmiany. To jest jego pamiec, nie twoja.
- NIGDY nie proponujesz twardego usuniecia danych. Wniosek aplikacji, ktory przestal byc prawda, to "deactivate". Nawyk, ktorego uzytkownik juz nie prowadzi, tez "deactivate".
- Nie proponujesz zmiany "na wszelki wypadek". Zmieniasz tylko to, co z notatki wynika wprost.
- Jesli notatka niczego nie zmienia w danych, zwroc pusta liste []. To jest POPRAWNA odpowiedz, nie porazka.
- "id" musi byc DOKLADNYM identyfikatorem z list ponizej, przepisanym znak w znak. Nie wymyslasz id.
- Maksymalnie 6 pozycji. Lepiej 2 trafne niz 6 domyslow.

JAK PISAC (to jest tak samo wazne jak reszta)
Uzytkownik czyta te zdania na telefonie i ma jednym ruchem zdecydowac: przyjac czy odrzucic. Ma zrozumiec od razu, bez zastanawiania sie, co ta zmiana wlasciwie robi.
- "summary": JEDNO zdanie zaczynajace sie od czasownika, mowiace CO ROBISZ i CZEGO to dotyczy. O sobie pisz w pierwszej osobie (zamkne, wylacze, zapisze, poprawie), o uzytkowniku w drugiej (zdales, napisales).
- "skutek": JEDNO krotkie zdanie, co uzytkownik ZAUWAZY po tej zmianie.
- Poprawna polszczyzna z polskimi znakami. Bez emoji. Bez myslnika, uzywaj przecinka albo kropki.

ZAKAZANE SLOWA w "summary" i "skutek" (to jezyk bazy danych, nie rozmowy):
dezaktywuje, encja, rekord, pole, status, payload, propozycja zmiany, aktualizuje wpis, oznacze jako nieaktywny.

TAK PISZ:
summary: "Zamkne cel Egzamin karate jako osiagniety." skutek: "Zniknie z planu dnia."
summary: "Zapisze w pamieci, ze zdales egzamin na zielona belke." skutek: "Mentorzy przestana pytac o przygotowania."
summary: "Wylacze stary plan treningowy pod egzamin." skutek: "Przestanie podpowiadac tryb egzaminacyjny."
summary: "Poprawie opis trenera karate, zeby nie pisal o przygotowaniu do egzaminu." skutek: "Trener przestanie planowac pod egzamin."

TAK NIE PISZ:
"Dezaktywuje wniosek o zdanym egzaminie karate, bo informacja jest juz zapisana." (jezyk bazy, i nie wiadomo, co sie stanie)
"Cel nauki kombinacji karate oznacze jako porzucony." (nie wiadomo, co uzytkownik z tego bedzie mial)

DOZWOLONE PARY entity + action (nic innego):
- goal + update        (id celu z listy)
- insight + create     (id: null)
- insight + deactivate (id wniosku z listy, TYLKO wniosek aplikacji, nigdy TWOJE SLOWA)
- habit + update       (id nawyku z listy)
- habit + deactivate   (id nawyku z listy)
- profile + update     (id: null)
- mentorPlan + deactivate (id planu z listy planow)
- mentor + update      (id mentora z listy opisow)

DOZWOLONE POLA W payload (plaski obiekt, tylko pola, ktore realnie zmieniasz):
- goal: status, outcome, progress, targetDate, title, description
  status: "active" | "achieved" | "abandoned" | "paused"; progress: liczba 0-100; targetDate: "RRRR-MM-DD"
- insight (create): kind ("pattern" | "preference" | "milestone"), title, content, confidence (0-1)
- habit: name, active, cue, routine, reward, why, identity, timeOfDay ("morning" | "afternoon" | "evening" | "any")
- profile: pola profilu, ktore notatka zmienia, plasko, wartosci proste
- mentor: removeFragment (fragment opisu mentora przepisany ZNAK W ZNAK z listy powyzej, ten ktory jest juz nieaktualny) oraz opcjonalnie replaceWith (czym go zastapic). Bez replaceWith fragment po prostu znika. W "summary" napisz, ktorego fragmentu to dotyczy.
- przy action "deactivate" payload zostaw pusty: {}

Odpowiedz TYLKO tablica JSON, bez komentarza i bez bloku kodu:
[{"entity":"goal","id":"abc123","action":"update","summary":"Zamkne cel Egzamin karate jako osiagniety.","skutek":"Zniknie z planu dnia.","payload":{"status":"achieved","outcome":"zdany"}}]`;

/* ------------------------------------------------------------------ */
/*  Parsing                                                            */
/* ------------------------------------------------------------------ */

interface RawProposal {
  entity?: unknown;
  id?: unknown;
  entityId?: unknown;
  action?: unknown;
  summary?: unknown;
  /** Emitted at the top level by the model; folded into the payload below. */
  skutek?: unknown;
  effect?: unknown;
  payload?: unknown;
}

/**
 * Vocabulary that reads like a database log instead of a sentence. The owner, on
 * the old wording: "musze sie zastanawiac naprawde grubo, czy ja chce to zapisac,
 * czy usunac z pamieci". A card he has to decode is a card he cannot judge, so it
 * is dropped rather than shown.
 */
// "status" and "pole" are banned in the prompt but NOT checked here: as substrings
// they fire on "statystyka", "polega", "polecenie" and would throw away good cards.
const BANNED_WORDS = [
  "dezaktyw",
  "encj",
  "rekord",
  "payload",
  "propozycja zmiany",
  "aktualizuje wpis",
  "aktualizuję wpis",
  "nieaktywn",
];

function readsLikeALog(text: string): boolean {
  const t = text.toLowerCase();
  return BANNED_WORDS.some((w) => t.includes(w));
}

/** Pulls the first JSON array out of the reply. Fences and chatter are tolerated. */
function parseArray(text: string): RawProposal[] {
  const cleaned = text
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed: unknown = JSON.parse(match[0]);
    return Array.isArray(parsed) ? (parsed as RawProposal[]) : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Turns one note into a short list of proposed changes. Writes nothing.
 *
 * @param userId   owner of the memory
 * @param noteText what the user just wrote about themselves
 * @returns at most {@link MAX_PROPOSALS} validated changes; `[]` whenever the note
 *          changes nothing, the model misbehaves, or the API call fails.
 */
export async function proposeChangesFromNote(
  userId: string,
  noteText: string,
): Promise<ProposedChange[]> {
  const note = noteText.trim();
  if (!note) return [];

  let snapshot: MemorySnapshot;
  try {
    snapshot = await loadSnapshot(userId, note);
  } catch {
    // No snapshot means no ids to reference, so any proposal would be a guess.
    return [];
  }

  const hasAnything =
    snapshot.insights.length > 0 ||
    snapshot.goals.length > 0 ||
    snapshot.habits.length > 0 ||
    snapshot.plans.length > 0;

  let text: string | null = null;
  try {
    const res = await anthropic.messages.create({
      model: MODELS.CHAT,
      max_tokens: 1500,
      temperature: 0.2,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `STAN PAMIECI:\n${snapshotToText(snapshot)}\n\nNOTATKA UZYTKOWNIKA:\n${note.slice(0, 2000)}`,
        },
      ],
    });
    const block = res.content.find((b) => b.type === "text");
    text = block && block.type === "text" ? block.text : null;
  } catch {
    // The note itself is already saved by the caller. A missing proposal list is
    // an inconvenience; failing the request would look like the note was lost.
    return [];
  }
  if (!text) return [];

  const raw = parseArray(text);
  if (raw.length === 0) return [];

  // Ids the model is allowed to name, per entity. Anything else is a hallucination
  // and gets dropped here rather than being caught later by an ownership check.
  const knownIds: Record<ProposalEntity, Set<string>> = {
    goal: new Set(snapshot.goals.map((g) => g.id)),
    insight: new Set(snapshot.insights.map((i) => i.id)),
    habit: new Set(snapshot.habits.map((h) => h.id)),
    profile: new Set<string>(),
    mentorPlan: new Set(snapshot.plans.map((p) => p.id)),
    mentor: new Set(snapshot.mentors.map((m) => m.id)),
  };

  // Insights the user wrote himself. Enforced here as well as in the prompt, because
  // this is exactly how the app lost the note it needed: the agent proposed
  // "dezaktywuje wniosek o zdanym egzaminie", the wording sounded like tidying up,
  // the user accepted, and his own sentence stopped reaching every mentor.
  const userOwnInsights = new Set(
    snapshot.insights.filter((i) => i.origin === "user").map((i) => i.id),
  );

  const out: ProposedChange[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (out.length >= MAX_PROPOSALS) break;

    const entity = item.entity;
    const action = item.action;
    if (!isProposalEntity(entity) || !isProposalAction(action)) continue;
    if (!isAllowedCombo(entity, action)) continue;

    const summary = asTrimmedString(item.summary, 240);
    if (!summary) continue;
    // A card he would have to decode is worse than no card: nothing changes, and
    // the note he wrote is already saved either way.
    if (readsLikeALog(summary)) continue;

    const rawId = item.id ?? item.entityId;
    let entityId: string | null = null;
    if (action === "create" || entity === "profile") {
      entityId = null;
    } else {
      if (typeof rawId !== "string" || !knownIds[entity].has(rawId)) continue;
      entityId = rawId;
    }

    // The user's own words are never up for removal, whatever the model decided.
    if (entity === "insight" && action === "deactivate" && entityId && userOwnInsights.has(entityId)) {
      continue;
    }

    // "skutek" arrives at the top level (that is what the prompt asks for) and
    // travels inside the payload, which is the only column that survives to the
    // accept step. The route splits it off again before anything is written.
    const rawEffect = asTrimmedString(item.skutek ?? item.effect, 160);
    const effectClean = rawEffect && !readsLikeALog(rawEffect) ? rawEffect : null;
    const rawPayload = isPlainObject(item.payload) ? { ...item.payload } : {};
    if (effectClean) rawPayload[EFFECT_KEY] = effectClean;

    const payload = sanitizePayload(entity, action, rawPayload);
    if (payload === null) continue;
    const effect = typeof payload[EFFECT_KEY] === "string" ? (payload[EFFECT_KEY] as string) : null;

    // One card per (entity, id, action). A duplicate is always the same decision.
    const key = `${entity}:${entityId ?? "-"}:${action}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ entity, entityId, action, summary, effect, payload });
  }

  // A brand new user has nothing to change yet, so "create an insight" is the only
  // honest proposal shape. Everything else was already filtered by the id check.
  if (!hasAnything) {
    return out.filter((p) => p.entity === "insight" || p.entity === "profile");
  }

  return out;
}
