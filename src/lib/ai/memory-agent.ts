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

/* ------------------------------------------------------------------ */
/*  Vocabulary                                                         */
/* ------------------------------------------------------------------ */

export const PROPOSAL_ENTITIES = ["goal", "insight", "habit", "profile"] as const;
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
  /** Flat, already sanitised set of fields to write. */
  payload: Record<string, unknown>;
}

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
};

/** Fields the accept step may write. Everything else in a payload is discarded. */
const FIELD_WHITELIST: Record<ProposalEntity, readonly string[]> = {
  goal: ["status", "outcome", "progress", "targetDate", "title", "description"],
  insight: ["kind", "title", "content", "confidence"],
  habit: ["name", "active", "cue", "routine", "reward", "why", "identity", "timeOfDay"],
  // The profile is a free-form JSON blob, so it has no fixed field list. It is
  // guarded by shape instead: flat, few keys, scalar values only. See below.
  profile: [],
};

const GOAL_STATUSES = ["active", "achieved", "abandoned", "paused"] as const;
const CREATABLE_INSIGHT_KINDS = ["pattern", "preference", "milestone"] as const;
const HABIT_TIMES = ["morning", "afternoon", "evening", "any"] as const;

/** Hard ceiling on how much one note may propose. Five cards is already a lot to read. */
export const MAX_PROPOSALS = 5;

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
  // Deactivation carries no fields: the route knows what "deactivate" means for
  // each entity, so a payload could only be a way to smuggle in an extra write.
  if (action === "deactivate") return {};

  if (!isPlainObject(raw)) return null;

  if (entity === "profile") {
    const patch = sanitizeProfilePatch(raw);
    return Object.keys(patch).length > 0 ? patch : null;
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

  return Object.keys(out).length > 0 ? out : null;
}

/* ------------------------------------------------------------------ */
/*  Memory snapshot                                                    */
/* ------------------------------------------------------------------ */

interface MemorySnapshot {
  insights: { id: string; kind: string; title: string; content: string }[];
  goals: { id: string; title: string; status: string; targetDate: Date | null }[];
  habits: { id: string; name: string; active: boolean }[];
}

/** Ids and titles only. The model needs to recognise a row, not to re-read it. */
async function loadSnapshot(userId: string): Promise<MemorySnapshot> {
  const [insights, goals, habits] = await Promise.all([
    prisma.userInsight.findMany({
      where: { userId, active: true },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      select: { id: true, kind: true, title: true, content: true },
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
  ]);
  return { insights, goals, habits };
}

function snapshotToText(snapshot: MemorySnapshot): string {
  const lines: string[] = [];

  lines.push("AKTYWNE WNIOSKI (id | rodzaj | tytul | tresc):");
  if (snapshot.insights.length === 0) {
    lines.push("- brak");
  } else {
    for (const i of snapshot.insights) {
      const body = i.content.replace(/\s*\n+\s*/g, " ").slice(0, 160);
      lines.push(`- ${i.id} | ${i.kind} | ${i.title} | ${body}`);
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

  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/*  Prompt                                                             */
/* ------------------------------------------------------------------ */

const SYSTEM = `Jestes agentem pamieci aplikacji rozwojowej. Uzytkownik wlasnie zapisal notatke o sobie.
Twoje zadanie: sprawdzic, czy ta notatka zmienia cokolwiek w JEGO ZAPISANYCH DANYCH, i zaproponowac zmiany do akceptacji.

TWARDE ZASADY:
- NIGDY nie proponujesz twardego usuniecia danych. Wniosek, ktory przestal byc prawda, zglaszasz jako action "deactivate". Nawyk, ktorego uzytkownik juz nie prowadzi, tez "deactivate".
- Kazda propozycja MUSI miec pole "summary": JEDNO zdanie po polsku, ktore uzytkownik zrozumie bez zadnego kontekstu.
  Wzor: Cel "Egzamin karate" oznacze jako osiagniety, bo napisales, ze go zdales.
- Maksymalnie 5 propozycji. Lepiej 2 trafne niz 5 domyslow.
- Jesli notatka niczego nie zmienia w danych, zwroc pusta liste []. To jest POPRAWNA odpowiedz, nie porazka.
- Nie proponujesz zmiany "na wszelki wypadek". Zmieniasz tylko to, co z notatki wynika wprost.
- "id" musi byc DOKLADNYM identyfikatorem z list ponizej, przepisanym znak w znak. Nie wymyslasz id.

DOZWOLONE PARY entity + action (nic innego):
- goal + update      (id celu z listy)
- insight + create   (id: null)
- insight + deactivate (id wniosku z listy)
- habit + update     (id nawyku z listy)
- habit + deactivate (id nawyku z listy)
- profile + update   (id: null)

DOZWOLONE POLA W payload (plaski obiekt, tylko pola, ktore realnie zmieniasz):
- goal: status, outcome, progress, targetDate, title, description
  status: "active" | "achieved" | "abandoned" | "paused"; progress: liczba 0-100; targetDate: "RRRR-MM-DD"
- insight (create): kind ("pattern" | "preference" | "milestone"), title, content, confidence (0-1)
- habit: name, active, cue, routine, reward, why, identity, timeOfDay ("morning" | "afternoon" | "evening" | "any")
- profile: pola profilu, ktore notatka zmienia, plasko, wartosci proste
- przy action "deactivate" payload zostaw pusty: {}

JEZYK:
- Prosty polski, bez zargonu, bez emoji, bez myslnika (uzywaj przecinka, kropki albo dwukropka).

Odpowiedz TYLKO tablica JSON, bez komentarza i bez bloku kodu:
[{"entity":"goal","id":"abc123","action":"update","summary":"Cel \\"Egzamin karate\\" oznacze jako osiagniety, bo napisales, ze go zdales.","payload":{"status":"achieved","outcome":"zdany"}}]`;

/* ------------------------------------------------------------------ */
/*  Parsing                                                            */
/* ------------------------------------------------------------------ */

interface RawProposal {
  entity?: unknown;
  id?: unknown;
  entityId?: unknown;
  action?: unknown;
  summary?: unknown;
  payload?: unknown;
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
    snapshot = await loadSnapshot(userId);
  } catch {
    // No snapshot means no ids to reference, so any proposal would be a guess.
    return [];
  }

  const hasAnything =
    snapshot.insights.length > 0 || snapshot.goals.length > 0 || snapshot.habits.length > 0;

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
  };

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

    const rawId = item.id ?? item.entityId;
    let entityId: string | null = null;
    if (action === "create" || entity === "profile") {
      entityId = null;
    } else {
      if (typeof rawId !== "string" || !knownIds[entity].has(rawId)) continue;
      entityId = rawId;
    }

    const payload = sanitizePayload(entity, action, item.payload);
    if (payload === null) continue;

    // One card per (entity, id, action). A duplicate is always the same decision.
    const key = `${entity}:${entityId ?? "-"}:${action}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ entity, entityId, action, summary, payload });
  }

  // A brand new user has nothing to change yet, so "create an insight" is the only
  // honest proposal shape. Everything else was already filtered by the id check.
  if (!hasAnything) {
    return out.filter((p) => p.entity === "insight" || p.entity === "profile");
  }

  return out;
}
