"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import {
  Button,
  Card,
  EmptyState,
  Pressable,
  Sheet,
  Skeleton,
  MOTION,
  T,
  TYPO,
} from "@/components/ui";
import { SegmentedTabs, SwipeDeck } from "@/components/motion";
import { haptic } from "@/lib/haptics";
import { useAuth } from "@/hooks/useAuth";

/* ------------------------------------------------------------------ */
/*  Types (mirror src/lib/roundtable/engine.ts)                        */
/* ------------------------------------------------------------------ */

/** One real disagreement between mentors, stated in a single line. */
interface Tension {
  point: string;
  sides: string;
}

/** The debate compressed to what the user actually reads. */
interface Essence {
  answer: string;
  agreements: string[];
  tensions: Tension[];
  steps: string[];
  closing: string;
}

/** Concrete proposal produced from the consensus (see lib/roundtable/engine.ts). */
interface PlanChange {
  kind: "activity" | "task";
  title: string;
  description?: string;
  type?: string;
  date?: string;
  time?: string;
  durationMin?: number;
  lifeAreaId?: string | null;
}

/**
 * One answer from GET /api/roundtable/status/[id].
 *
 * `events` is the raw `debateTranscript`: mentor_start, mentor_response,
 * consensus, essence and plan_changes entries, in the order the debate produced
 * them. It stays `unknown` on purpose, because a row written by an older
 * deployment has to render too; every reader below validates what it needs.
 * There is no `done` or `error` event any more: those live in `status`/`error`.
 */
interface DebateStatus {
  sessionId: string;
  status: string;
  error: string | null;
  inputText: string;
  events: unknown;
  consensus: string | null;
  essence: Essence | null;
  planChanges: unknown;
  appliedIndexes: unknown;
}

type Phase = "idle" | "submitting" | "debating" | "consensus" | "done" | "error";

/** Poll cadence. Slower when the tab is hidden, because nothing is being read. */
const POLL_VISIBLE_MS = 2000;
const POLL_HIDDEN_MS = 10000;

/** Per user, so two accounts on one phone never resume each other's debate. */
function storageKeyFor(userId: string): string {
  return `papi.roundtable.active.${userId}`;
}

/** One speech, normalised so live events and stored history render the same way. */
interface TranscriptTurn {
  mentorId: string;
  mentorName: string;
  mentorRole: string;
  avatarEmoji: string;
  model: string;
  round: number;
  content: string;
}

/** What a single avatar in the live row knows about itself. */
type LiveStatus = "waiting" | "thinking" | "done";

interface LiveMentor {
  id: string;
  name: string;
  avatarEmoji: string;
  /** highest round this mentor has been asked to speak in (0 = not yet) */
  started: number;
  /** highest round this mentor has answered in */
  done: number;
  order: number;
}

interface RoundtableHistoryItem {
  id: string;
  inputText: string;
  inputType: string;
  consensus: string | null;
  debateTranscript: unknown;
  planChanges: unknown;
  applied: boolean;
  createdAt: string;
  /** null for sessions recorded before the essence existed */
  essence: Essence | null;
  changeCount: number;
  appliedIndexes: number[];
}

interface MentorListItem {
  id: string;
  name: string;
  role: string;
  avatarEmoji: string | null;
}

type ViewTab = "debate" | "history";
const TABS: ViewTab[] = ["debate", "history"];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function modelLabel(model: string): string {
  if (model.includes("opus")) return "opus 4.6";
  if (model.includes("sonnet")) return "sonnet 4.6";
  if (model.includes("haiku")) return "haiku 4.5";
  return model;
}

/** Polish plural for "pozycja": 1 pozycję, 2-4 pozycje, 5+ pozycji. */
function plItems(n: number): string {
  if (n === 1) return "pozycję";
  const last = n % 10;
  const last2 = n % 100;
  if (last >= 2 && last <= 4 && !(last2 >= 12 && last2 <= 14)) return "pozycje";
  return "pozycji";
}

function statusWord(status: LiveStatus): string {
  if (status === "thinking") return "myśli";
  if (status === "done") return "gotowe";
  return "czeka";
}

function liveStatus(m: LiveMentor): LiveStatus {
  if (m.started === 0) return "waiting";
  return m.done >= m.started ? "done" : "thinking";
}

/**
 * Pull the speeches out of a stored `debateTranscript`.
 * Old rows used `mentorEmoji` where the engine now writes `avatarEmoji`, so both
 * keys are accepted: a session from before the rename must still render.
 */
function normalizeTranscript(raw: unknown): TranscriptTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: TranscriptTurn[] = [];
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") return;
    const e = entry as Record<string, unknown>;
    if (e.type !== "mentor_response") return;
    const content = typeof e.content === "string" ? e.content : "";
    if (!content.trim()) return;
    out.push({
      mentorId: typeof e.mentorId === "string" ? e.mentorId : `t${i}`,
      mentorName: typeof e.mentorName === "string" ? e.mentorName : "Mentor",
      mentorRole: typeof e.mentorRole === "string" ? e.mentorRole : "",
      avatarEmoji:
        (typeof e.avatarEmoji === "string" && e.avatarEmoji) ||
        (typeof e.mentorEmoji === "string" && e.mentorEmoji) ||
        "🧑‍🏫",
      model: typeof e.model === "string" ? e.model : "",
      round: typeof e.round === "number" ? e.round : 1,
      content,
    });
  });
  return out;
}

/**
 * Fold the stored events into the avatar row.
 *
 * `prev` is kept as the base on purpose: the row is seeded from the mentor picker
 * the moment the debate starts, and a poll that lands after only two of five
 * `mentor_start` events would otherwise shrink the row and make it jump.
 * Every field is merged with Math.max, so replaying the same events is a no-op.
 */
function mergeLiveMentors(prev: LiveMentor[], raw: unknown): LiveMentor[] {
  if (!Array.isArray(raw)) return prev;
  const next = prev.map((m) => ({ ...m }));
  const indexById = new Map(next.map((m, i) => [m.id, i]));

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (e.type !== "mentor_start" && e.type !== "mentor_response") continue;
    const id = typeof e.mentorId === "string" ? e.mentorId : "";
    if (!id) continue;

    const round = typeof e.round === "number" ? e.round : 1;
    const name = typeof e.mentorName === "string" ? e.mentorName : "Mentor";
    const emoji = typeof e.avatarEmoji === "string" ? e.avatarEmoji : "🧑‍🏫";

    let i = indexById.get(id);
    if (i === undefined) {
      i = next.length;
      indexById.set(id, i);
      next.push({ id, name, avatarEmoji: emoji, started: 0, done: 0, order: i });
    }

    const m = next[i];
    m.name = name;
    m.avatarEmoji = emoji;
    if (e.type === "mentor_start") m.started = Math.max(m.started, round);
    else m.done = Math.max(m.done, round);
  }

  return next;
}

/** Proposals stored inside `RoundTableSession.planChanges`. */
function parseStoredChanges(planChanges: unknown): PlanChange[] {
  if (!planChanges || typeof planChanges !== "object") return [];
  const changes = (planChanges as { changes?: unknown }).changes;
  if (!Array.isArray(changes)) return [];
  return changes.filter(
    (c): c is PlanChange =>
      Boolean(c) && typeof c === "object" && typeof (c as { title?: unknown }).title === "string"
  );
}

/** "07:00 · 45 min" — empty string when the proposal carries neither. */
function scheduleBadge(c: PlanChange): string {
  return [c.time, c.durationMin ? `${c.durationMin} min` : null].filter(Boolean).join(" · ");
}

/* ------------------------------------------------------------------ */
/*  Tiny shared pieces                                                 */
/* ------------------------------------------------------------------ */

function CheckGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * The model name. Deliberately small and grey: the user said the model label was
 * part of the noise, so it lives next to a name inside the transcript sheet only.
 */
function ModelBadge({ model }: { model: string }) {
  if (!model) return null;
  return (
    <span
      style={{
        ...TYPO.label,
        padding: "3px 8px",
        borderRadius: T.rFull,
        background: T.surface2,
        color: T.text3,
        border: `1px solid ${T.border}`,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {modelLabel(model)}
    </span>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ ...TYPO.label, color: T.text3, margin: `0 0 ${T.sp2}` }}>{children}</h3>
  );
}

/** One error look for the whole screen: composer, finished debate and history. */
function ErrorBanner({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div
      role="alert"
      style={{
        ...TYPO.callout,
        color: T.dangerOnSurface,
        background: T.dangerSoft,
        border: `1px solid ${T.danger}`,
        borderRadius: T.rMd,
        padding: `${T.sp3} ${T.sp4}`,
      }}
    >
      {text}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LIVE VIEW — only avatars, status and progress. No text at all.     */
/* ------------------------------------------------------------------ */

function ThinkingDots() {
  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-flex", gap: 4, height: 6, alignItems: "center" }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="rt-dot"
          style={{
            display: "inline-block",
            width: 5,
            height: 5,
            borderRadius: T.rFull,
            background: T.primaryOnSurface,
            animationDelay: `${i * 160}ms`,
          }}
        />
      ))}
    </span>
  );
}

function MentorChip({ mentor }: { mentor: LiveMentor }) {
  const status = liveStatus(mentor);
  const waiting = status === "waiting";
  const thinking = status === "thinking";
  const done = status === "done";

  return (
    <div
      role="listitem"
      aria-label={`${mentor.name}: ${statusWord(status)}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        width: 76,
        flexShrink: 0,
      }}
    >
      <span style={{ position: "relative", display: "block", width: 44, height: 44 }}>
        <span
          aria-hidden="true"
          className={thinking ? "rt-avatar-pulse" : undefined}
          style={{
            width: 44,
            height: 44,
            borderRadius: T.rFull,
            background: T.surface2,
            border: `2px solid ${done ? T.success : thinking ? T.primary : T.border}`,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            lineHeight: 1,
            // status must survive without colour: waiting is visibly faded
            opacity: waiting ? 0.45 : 1,
            transition: `opacity ${MOTION.base} ${MOTION.easeOut}, border-color ${MOTION.base} ${MOTION.easeOut}`,
          }}
        >
          {mentor.avatarEmoji}
        </span>

        {done ? (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              right: -3,
              bottom: -3,
              width: 18,
              height: 18,
              borderRadius: T.rFull,
              background: T.success,
              color: T.primaryText,
              border: `2px solid ${T.surface}`,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CheckGlyph size={9} />
          </span>
        ) : null}
      </span>

      <span
        aria-hidden="true"
        style={{
          ...TYPO.footnote,
          color: waiting ? T.text3 : T.text2,
          maxWidth: 76,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textAlign: "center",
        }}
      >
        {mentor.name}
      </span>

      {thinking ? <ThinkingDots /> : <span aria-hidden="true" style={{ height: 6 }} />}
    </div>
  );
}

function LiveDebate({
  mentors,
  stageLabel,
  percent,
}: {
  mentors: LiveMentor[];
  stageLabel: string;
  percent: number;
}) {
  return (
    <Card padding="lg">
      <div
        className="papi-scroll"
        role="list"
        aria-label="Mentorzy w debacie"
        style={{
          display: "flex",
          gap: T.sp3,
          overflowX: "auto",
          overscrollBehaviorX: "contain",
          paddingBottom: T.sp2,
          // a single mentor should sit in the middle, many should scroll from the left
          justifyContent: mentors.length > 3 ? "flex-start" : "center",
        }}
      >
        {mentors.map((m) => (
          <MentorChip key={m.id} mentor={m} />
        ))}
      </div>

      <div style={{ marginTop: T.sp4 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: T.sp2,
            marginBottom: T.sp2,
          }}
        >
          <span style={{ ...TYPO.label, color: T.text3 }}>{stageLabel}</span>
          <span style={{ ...TYPO.footnote, color: T.text3 }}>{percent}%</span>
        </div>
        <div
          role="progressbar"
          aria-label="Postęp debaty"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          style={{
            height: 6,
            borderRadius: T.rFull,
            background: T.surface2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${percent}%`,
              borderRadius: T.rFull,
              background: T.primary,
              transition: `width ${MOTION.slow} ${MOTION.easeOut}`,
            }}
          />
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  ESSENCE — the hero of the result screen                            */
/* ------------------------------------------------------------------ */

function EssenceView({
  essence,
  consensusFallback,
  showSteps,
}: {
  essence: Essence | null;
  consensusFallback: string | null;
  /** Steps are rendered only when there is no proposal list to carry them. */
  showSteps: boolean;
}) {
  // Defensive reading. A stored row or an event from an older deployment can carry
  // a half-filled essence, and `undefined.slice()` would take the whole screen down
  // (there is an error boundary in (app), but the user would lose the debate).
  const answer = typeof essence?.answer === "string" ? essence.answer.trim() : "";
  const rawAgreements = essence?.agreements;
  const agreements = (Array.isArray(rawAgreements) ? rawAgreements : [])
    .filter((a): a is string => typeof a === "string" && a.trim() !== "")
    .slice(0, 4);
  const rawTensions = essence?.tensions;
  const tensions = (Array.isArray(rawTensions) ? rawTensions : []).filter(
    (t) => Boolean(t) && (t.point || t.sides)
  );
  const rawSteps = essence?.steps;
  const steps = (Array.isArray(rawSteps) ? rawSteps : []).filter(
    (s): s is string => typeof s === "string" && s.trim() !== ""
  );

  // Backwards compatibility: a session recorded before the essence existed still
  // has to show something, and the consensus text is what it has. An essence
  // without an answer is treated the same way, because the answer IS the screen.
  if (!essence || !answer) {
    // A stored session must never render as a blank panel, so even the case of
    // "no essence and no consensus" says something out loud.
    if (!consensusFallback) {
      return (
        <Card variant="inset" padding="md">
          <p style={{ ...TYPO.callout, color: T.text2, margin: 0 }}>
            Ta debata nie ma zapisanego podsumowania. Pełny zapis rozmowy jest poniżej.
          </p>
        </Card>
      );
    }
    return (
      <Card variant="hero" padding="lg" style={{ backgroundImage: "var(--hero-wash)" }}>
        <div style={{ ...TYPO.label, color: T.successOnSurface, marginBottom: T.sp2 }}>
          Wspólne stanowisko
        </div>
        <div
          style={{ ...TYPO.callout, lineHeight: 1.7, color: T.text, whiteSpace: "pre-wrap" }}
        >
          {consensusFallback}
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp4 }}>
      {/* a) the answer, first thing on screen */}
      <Card variant="hero" padding="lg" style={{ backgroundImage: "var(--hero-wash)" }}>
        <div style={{ ...TYPO.label, color: T.primaryOnSurface, marginBottom: T.sp2 }}>
          Odpowiedź
        </div>
        <p style={{ ...TYPO.title3, lineHeight: 1.5, color: T.text, margin: 0 }}>{answer}</p>
      </Card>

      {/* b) what they agree on */}
      {agreements.length > 0 ? (
        <section>
          <SectionHeading>Na czym się zgadzają</SectionHeading>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: T.sp2,
            }}
          >
            {agreements.map((a, i) => (
              <li key={i} style={{ display: "flex", alignItems: "flex-start", gap: T.sp3 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: T.rFull,
                    background: T.successSoft,
                    color: T.successOnSurface,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  <CheckGlyph size={11} />
                </span>
                <span style={{ ...TYPO.callout, lineHeight: 1.5, color: T.text }}>{a}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* c) where they pull in different directions */}
      {tensions.length > 0 ? (
        <section>
          <SectionHeading>Sporne</SectionHeading>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: T.sp2,
            }}
          >
            {tensions.map((t, i) => (
              <li
                key={i}
                style={{
                  padding: `${T.sp3} 14px`,
                  borderRadius: T.rMd,
                  background: T.surface2,
                  borderLeft: `3px solid ${T.warning}`,
                }}
              >
                {t.point ? (
                  <div style={{ ...TYPO.callout, lineHeight: 1.5, color: T.text }}>{t.point}</div>
                ) : null}
                {t.sides ? (
                  <div style={{ ...TYPO.footnote, color: T.text2, marginTop: 4 }}>{t.sides}</div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* steps only when no proposal list exists to carry them */}
      {showSteps && steps.length > 0 ? (
        <section>
          <SectionHeading>Kroki</SectionHeading>
          <ol
            style={{
              margin: 0,
              paddingLeft: T.sp5,
              display: "flex",
              flexDirection: "column",
              gap: T.sp2,
            }}
          >
            {steps.map((s, i) => (
              <li key={i} style={{ ...TYPO.callout, lineHeight: 1.5, color: T.text }}>
                {s}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PROPOSALS — checkbox list, the user picks what lands in the plan   */
/* ------------------------------------------------------------------ */

function ProposalRow({
  change,
  checked,
  isApplied,
  onToggle,
}: {
  change: PlanChange;
  checked: boolean;
  isApplied: boolean;
  onToggle: () => void;
}) {
  const badge = scheduleBadge(change);
  const marked = isApplied || checked;

  return (
    <Pressable
      as="div"
      role="checkbox"
      ariaChecked={marked}
      disabled={isApplied}
      haptic={false}
      noMinSize
      press={isApplied ? "none" : "sm"}
      onPress={onToggle}
      style={{
        display: "flex",
        width: "100%",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        gap: T.sp3,
        // whole row is the touch target, never smaller than the 44 px floor
        minHeight: 44,
        padding: `${T.sp3} 14px`,
        borderRadius: T.rMd,
        background: T.surface2,
        border: `1px solid ${checked && !isApplied ? T.borderAccent : T.border}`,
        textAlign: "left",
        opacity: isApplied ? 0.55 : 1,
        transition: `border-color ${MOTION.fast} linear, opacity ${MOTION.fast} linear`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 24,
          height: 24,
          flexShrink: 0,
          marginTop: 2,
          borderRadius: T.rXs,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: isApplied ? T.success : checked ? T.primary : "transparent",
          border: `2px solid ${isApplied ? T.success : checked ? T.primary : T.borderStrong}`,
          color: T.primaryText,
          transition: `background-color ${MOTION.fast} linear, border-color ${MOTION.fast} linear`,
        }}
      >
        {marked ? <CheckGlyph size={13} /> : null}
      </span>

      <span style={{ flex: 1, minWidth: 0, display: "block" }}>
        <span style={{ display: "block", ...TYPO.bodyBold, color: T.text }}>{change.title}</span>

        {change.description ? (
          <span
            style={{ display: "block", ...TYPO.footnote, color: T.text2, marginTop: 3 }}
          >
            {change.description}
          </span>
        ) : null}

        {badge || isApplied ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: T.sp2,
              marginTop: 6,
              flexWrap: "wrap",
            }}
          >
            {badge ? (
              <span
                style={{
                  ...TYPO.footnote,
                  color: T.text3,
                  background: T.surface3,
                  border: `1px solid ${T.border}`,
                  borderRadius: T.rFull,
                  padding: "2px 10px",
                  whiteSpace: "nowrap",
                }}
              >
                {badge}
              </span>
            ) : null}
            {isApplied ? (
              <span style={{ ...TYPO.footnote, fontWeight: 700, color: T.successOnSurface }}>
                w planie
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </Pressable>
  );
}

function ProposalPicker({
  changes,
  appliedIndexes,
  selected,
  onToggle,
  onApply,
  applying,
  disabled,
  message,
  messageIsError,
}: {
  changes: PlanChange[];
  appliedIndexes: Set<number>;
  selected: Set<number>;
  onToggle: (index: number) => void;
  onApply: () => void;
  applying: boolean;
  /** true while the session id is still missing (debate not saved yet) */
  disabled?: boolean;
  message: string;
  /** a failed apply must not read like a confirmation */
  messageIsError?: boolean;
}) {
  const selectable = changes.length - appliedIndexes.size;
  const picked = selected.size;
  const allDone = selectable === 0;

  return (
    <section>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: T.sp2,
          marginBottom: T.sp2,
          flexWrap: "wrap",
        }}
      >
        <SectionHeading>Do wdrożenia</SectionHeading>
        <span style={{ ...TYPO.footnote, color: T.text3 }}>
          {allDone ? "wszystko w planie" : `${picked} z ${selectable}`}
        </span>
      </div>

      {!allDone ? (
        <p style={{ ...TYPO.footnote, color: T.text2, margin: `0 0 ${T.sp3}` }}>
          Zaznacz, co wdrażamy
        </p>
      ) : null}

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: T.sp2,
        }}
      >
        {changes.map((c, i) => (
          <li key={i}>
            <ProposalRow
              change={c}
              checked={selected.has(i)}
              isApplied={appliedIndexes.has(i)}
              onToggle={() => onToggle(i)}
            />
          </li>
        ))}
      </ul>

      {!allDone ? (
        <div style={{ marginTop: T.sp3 }}>
          <Button
            size="md"
            fullWidth
            disabled={picked === 0 || Boolean(disabled)}
            loading={applying}
            onPress={onApply}
          >
            {`Wdróż zaznaczone (${picked})`}
          </Button>
        </div>
      ) : null}

      {message ? (
        <div style={{ marginTop: T.sp3 }}>
          {messageIsError ? (
            <ErrorBanner text={message} />
          ) : (
            <div role="status" style={{ ...TYPO.footnote, color: T.text2 }}>
              {message}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  FULL TRANSCRIPT — hidden behind a button, grouped by round         */
/* ------------------------------------------------------------------ */

function TranscriptSheet({
  open,
  onClose,
  question,
  turns,
}: {
  open: boolean;
  onClose: () => void;
  question: string;
  turns: TranscriptTurn[];
}) {
  const rounds = useMemo(() => {
    const map = new Map<number, TranscriptTurn[]>();
    for (const t of turns) {
      const list = map.get(t.round);
      if (list) list.push(t);
      else map.set(t.round, [t]);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [turns]);

  return (
    <Sheet open={open} onClose={onClose} title="Cała rozmowa" size="full">
      {question ? (
        <div
          style={{
            padding: `${T.sp3} 14px`,
            borderRadius: T.rMd,
            background: T.surface2,
            marginBottom: T.sp4,
          }}
        >
          <div style={{ ...TYPO.label, color: T.text3, marginBottom: 4 }}>Pytanie</div>
          <div style={{ ...TYPO.callout, color: T.text, whiteSpace: "pre-wrap" }}>{question}</div>
        </div>
      ) : null}

      {rounds.length === 0 ? (
        <EmptyState
          icon="💬"
          title="Brak zapisu"
          body="Ta debata nie ma zapisanych wypowiedzi."
        />
      ) : (
        rounds.map(([round, list]) => (
          <section key={round} style={{ marginBottom: T.sp6 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: T.sp3,
                marginBottom: T.sp3,
              }}
            >
              <span style={{ ...TYPO.label, color: T.text3, whiteSpace: "nowrap" }}>
                Runda {round}
              </span>
              <span aria-hidden="true" style={{ flex: 1, height: 1, background: T.border }} />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: T.sp5 }}>
              {list.map((t, i) => (
                <article key={`${t.mentorId}-${round}-${i}`}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: T.sp2,
                      flexWrap: "wrap",
                      marginBottom: 6,
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>
                      {t.avatarEmoji}
                    </span>
                    <span style={{ ...TYPO.bodyBold, color: T.text }}>{t.mentorName}</span>
                    {t.mentorRole ? (
                      <span style={{ ...TYPO.footnote, color: T.text3 }}>· {t.mentorRole}</span>
                    ) : null}
                    <ModelBadge model={t.model} />
                  </div>
                  <p
                    style={{
                      ...TYPO.body,
                      lineHeight: 1.6,
                      color: T.text,
                      margin: 0,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {t.content}
                  </p>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function RoundTablePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [tab, setTab] = useState<ViewTab>("debate");
  /** Bumped every time Historia is opened; HistoryView re-reads on a new value. */
  const [historyToken, setHistoryToken] = useState(0);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");

  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [liveMentors, setLiveMentors] = useState<LiveMentor[]>([]);
  const [consensus, setConsensus] = useState<string | null>(null);
  const [essence, setEssence] = useState<Essence | null>(null);

  const [planChanges, setPlanChanges] = useState<PlanChange[]>([]);
  const [selectedChanges, setSelectedChanges] = useState<Set<number>>(new Set());
  const [appliedChanges, setAppliedChanges] = useState<Set<number>>(new Set());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");
  const [applyFailed, setApplyFailed] = useState(false);

  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [availableMentors, setAvailableMentors] = useState<MentorListItem[]>([]);
  const [selectedMentorIds, setSelectedMentorIds] = useState<Set<string>>(new Set());
  const [mentorsLoading, setMentorsLoading] = useState(true);
  /** true when the mentor list failed to load; an empty list then means nothing. */
  const [mentorsFailed, setMentorsFailed] = useState(false);

  const resultTopRef = useRef<HTMLDivElement>(null);
  // The question is rendered, so it is state, not a ref: a ref read during render
  // is a lint error here and, worse, a value React is not allowed to react to.
  const [submittedQuestion, setSubmittedQuestion] = useState("");
  // Two rapid taps can fire the same request twice before React re-renders the
  // disabled button. For apply that would create duplicate activities, because
  // the second request would leave before the first one has marked the indexes.
  const runningRef = useRef(false);
  const applyLockRef = useRef(false);

  /* ---------------- background debate ---------------- */

  // The debate this screen is currently following. Not the same thing as
  // `sessionId`: the id stays after polling stops, `watchId` goes back to null.
  const [watchId, setWatchId] = useState<string | null>(null);
  /** The proposal checkboxes are seeded once, so a poll cannot undo a tap. */
  const changesSeededRef = useRef(false);
  /** The success buzz belongs to the moment the answer lands, not every poll. */
  const essenceBuzzedRef = useRef(false);
  /** localStorage is read once per mount, after the session id is known. */
  const restoredRef = useRef(false);

  const storageKey = user?.id ? storageKeyFor(user.id) : null;

  const rememberSession = useCallback(
    (id: string | null) => {
      if (!storageKey || typeof window === "undefined") return;
      try {
        if (id) window.localStorage.setItem(storageKey, id);
        else window.localStorage.removeItem(storageKey);
      } catch {
        // Private mode or a full quota. Losing the resume point is survivable,
        // crashing the screen over it is not.
      }
    },
    [storageKey]
  );

  /* ---------------- mentors ---------------- */

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mentors")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: MentorListItem[]) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setAvailableMentors(list);
        setSelectedMentorIds(new Set(list.map((m) => m.id)));
        setMentorsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Without this flag a dropped connection looked exactly like "you have no
        // mentors yet" and sent the user to settings for nothing.
        setMentorsFailed(true);
        setMentorsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleMentor = useCallback((id: string) => {
    haptic.selection();
    setSelectedMentorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllMentors = useCallback(() => {
    haptic.tap();
    setSelectedMentorIds((prev) => {
      if (prev.size === availableMentors.length) return new Set();
      return new Set(availableMentors.map((m) => m.id));
    });
  }, [availableMentors]);

  /* ---------------- debate ---------------- */

  /**
   * Fold one status answer into the screen. Called on every poll, so it has to be
   * idempotent: replaying the same answer twice must change nothing.
   */
  const applyStatus = useCallback((data: DebateStatus) => {
    if (typeof data.inputText === "string" && data.inputText.trim()) {
      setSubmittedQuestion(data.inputText);
      // A debate resumed after a full reload has no text in the composer, so the
      // retry button would have nothing to send. Never overwrite live typing.
      setInput((prev) => (prev.trim() ? prev : data.inputText));
    }

    setLiveMentors((prev) => mergeLiveMentors(prev, data.events));
    setTurns(normalizeTranscript(data.events));

    if (typeof data.consensus === "string" && data.consensus) setConsensus(data.consensus);

    if (data.essence && typeof data.essence.answer === "string") {
      if (!essenceBuzzedRef.current) {
        essenceBuzzedRef.current = true;
        haptic.success();
      }
      setEssence(data.essence);
    }

    const list = Array.isArray(data.planChanges)
      ? (data.planChanges as PlanChange[]).filter(
          (c) => Boolean(c) && typeof c === "object" && typeof c.title === "string"
        )
      : [];
    if (list.length > 0) {
      setPlanChanges(list);
      if (!changesSeededRef.current) {
        changesSeededRef.current = true;
        // every proposal starts checked; unchecking is the deliberate act
        setSelectedChanges(new Set(list.map((_, i) => i)));
      }
    }

    // Only when something really landed in the plan. An empty list on every poll
    // would rebuild both sets twice a second for nothing.
    if (Array.isArray(data.appliedIndexes) && data.appliedIndexes.length > 0) {
      const already = new Set(
        (data.appliedIndexes as unknown[])
          .map((v) => Number(v))
          .filter((n) => Number.isInteger(n) && n >= 0)
      );
      setAppliedChanges(already);
      setSelectedChanges((prev) => new Set([...prev].filter((i) => !already.has(i))));
    }

    if (data.status === "error") {
      haptic.error();
      setErrorMsg(data.error || "Debata się nie udała. Spróbuj jeszcze raz.");
      setPhase("error");
    } else if (data.status === "done") {
      setPhase("done");
    } else {
      setPhase(data.consensus ? "consensus" : "debating");
    }
  }, []);

  /**
   * The whole point of this screen: the debate runs on the server, so locking the
   * phone or leaving the tab changes nothing except how often we ask about it.
   */
  useEffect(() => {
    if (!watchId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (cancelled) return;
      const hidden = document.visibilityState === "hidden";
      timer = setTimeout(tick, hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    };

    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/roundtable/status/${watchId}`, { cache: "no-store" });
        if (cancelled) return;

        if (res.status === 404) {
          // The stored id points at nothing (cleared account, wiped row).
          rememberSession(null);
          setWatchId(null);
          setErrorMsg("Nie znalazłem tej debaty. Zacznij nową.");
          setPhase("error");
          return;
        }
        if (!res.ok) {
          // A hiccup on the server is not a reason to declare the debate dead.
          schedule();
          return;
        }

        const data = (await res.json()) as DebateStatus;
        if (cancelled) return;
        applyStatus(data);

        if (data.status === "running") {
          schedule();
        } else {
          // Terminal. Stop asking, and let go of the resume point: the result is
          // on screen now and lives in Historia from here on.
          setSessionId(data.sessionId ?? watchId);
          rememberSession(null);
          setWatchId(null);
        }
      } catch {
        // Offline, radio asleep, tunnel. Keep trying. This is exactly the case
        // that used to kill the debate.
        if (!cancelled) schedule();
      }
    };

    const onVisibility = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      // Back on screen: ask right now instead of waiting out the slow interval.
      if (timer) clearTimeout(timer);
      void tick();
    };

    void tick();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [watchId, applyStatus, rememberSession]);

  /**
   * Coming back to the screen, including after the app was fully reloaded: pick
   * up the debate that was left running. Runs once, as soon as the user id (and
   * with it the storage key) is known.
   */
  useEffect(() => {
    if (restoredRef.current || !storageKey || typeof window === "undefined") return;
    restoredRef.current = true;

    let cancelled = false;
    // localStorage is an external store, and setting state straight from an
    // effect body cascades a render. The read is instant either way, so it goes
    // one microtask later, after the commit has finished.
    queueMicrotask(() => {
      if (cancelled) return;

      let saved: string | null = null;
      try {
        saved = window.localStorage.getItem(storageKey);
      } catch {
        return;
      }
      if (!saved) return;

      setSessionId(saved);
      setPhase("debating");
      setWatchId(saved);
    });

    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const startDebate = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (selectedMentorIds.size === 0) return;
    // The send button inside VoiceTextarea and the big CTA both land here.
    if (runningRef.current) return;
    runningRef.current = true;

    setSubmittedQuestion(trimmed);
    haptic.impact();
    setPhase("submitting");
    setTurns([]);
    setConsensus(null);
    setEssence(null);
    setPlanChanges([]);
    setSelectedChanges(new Set());
    setAppliedChanges(new Set());
    setSessionId(null);
    setWatchId(null);
    setApplyMsg("");
    setApplyFailed(false);
    setErrorMsg("");
    setTranscriptOpen(false);
    changesSeededRef.current = false;
    essenceBuzzedRef.current = false;

    // Seed the avatar row from the picker so the user sees who is at the table
    // before the first event arrives; the polls then only update the status.
    setLiveMentors(
      availableMentors
        .filter((m) => selectedMentorIds.has(m.id))
        .map((m, i) => ({
          id: m.id,
          name: m.name,
          avatarEmoji: m.avatarEmoji ?? "🧑‍🏫",
          started: 0,
          done: 0,
          order: i,
        }))
    );

    try {
      const res = await fetch("/api/roundtable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          mentorIds: Array.from(selectedMentorIds),
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || typeof json.sessionId !== "string") {
        haptic.error();
        setErrorMsg(json.error || `Błąd serwera (${res.status})`);
        setPhase("error");
        return;
      }

      // From here on the work belongs to the server. Write the id down BEFORE
      // anything else: if the phone dies one second later, this is what brings
      // the user back to their debate.
      rememberSession(json.sessionId);
      setSessionId(json.sessionId);
      setPhase("debating");
      setWatchId(json.sessionId);
    } catch (err) {
      haptic.error();
      setErrorMsg(err instanceof Error ? err.message : "Błąd połączenia");
      setPhase("error");
    } finally {
      runningRef.current = false;
    }
  }, [input, selectedMentorIds, availableMentors, rememberSession]);

  const reset = useCallback(() => {
    haptic.tap();
    setPhase("idle");
    setInput("");
    setTurns([]);
    setLiveMentors([]);
    setConsensus(null);
    setEssence(null);
    setPlanChanges([]);
    setSelectedChanges(new Set());
    setAppliedChanges(new Set());
    setSessionId(null);
    setWatchId(null);
    rememberSession(null);
    setApplyMsg("");
    setApplyFailed(false);
    setErrorMsg("");
    setTranscriptOpen(false);
    setSubmittedQuestion("");
    changesSeededRef.current = false;
    essenceBuzzedRef.current = false;
  }, [rememberSession]);

  /* ---------------- apply ---------------- */

  const toggleChange = useCallback((index: number) => {
    haptic.selection();
    setSelectedChanges((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const applySelected = useCallback(async () => {
    if (!sessionId || applying || applyLockRef.current) return;
    const indexes = Array.from(selectedChanges).sort((a, b) => a - b);
    if (indexes.length === 0) return;

    applyLockRef.current = true;
    haptic.impact();
    setApplying(true);
    setApplyMsg("");
    setApplyFailed(false);
    try {
      const res = await fetch("/api/roundtable/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, indexes }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        haptic.error();
        setApplyFailed(true);
        setApplyMsg(json.error || "Nie udało się wdrożyć ustaleń.");
        return;
      }

      haptic.success();
      const nowApplied: Set<number> = Array.isArray(json.appliedIndexes)
        ? new Set(json.appliedIndexes as number[])
        : new Set([...appliedChanges, ...indexes]);
      setAppliedChanges(nowApplied);
      // items that landed in the plan can no longer be picked
      setSelectedChanges((prev) => new Set([...prev].filter((i) => !nowApplied.has(i))));
      setApplyMsg(
        json.alreadyApplied
          ? "To już jest w planie."
          : `Dodano do planu: ${json.created} ${plItems(Number(json.created) || 0)}.`
      );
    } catch (e) {
      haptic.error();
      setApplyFailed(true);
      setApplyMsg(e instanceof Error ? e.message : "Błąd połączenia");
    } finally {
      applyLockRef.current = false;
      setApplying(false);
    }
  }, [sessionId, applying, selectedChanges, appliedChanges]);

  /* ---------------- derived ---------------- */

  const isActive = phase === "debating" || phase === "submitting" || phase === "consensus";
  // The result screen appears with the essence, not with the consensus: between
  // those two events one more model call runs, and flashing the raw consensus
  // wall of text for a few seconds is exactly what the user asked us to remove.
  const resultReady = essence !== null || phase === "done";
  // An error that lands AFTER the essence (saving the session failed, stream cut
  // on the last event) must not wipe a debate the user waited a minute for: keep
  // the answer on screen and show the error next to it instead.
  const showComposer = phase === "idle" || (phase === "error" && !resultReady);

  const orderedMentors = useMemo(
    () => [...liveMentors].sort((a, b) => a.order - b.order),
    [liveMentors]
  );

  const stageLabel = useMemo(() => {
    if (consensus || phase === "consensus" || phase === "done") return "Podsumowanie";
    const round = orderedMentors.reduce((max, m) => Math.max(max, m.started), 0);
    if (round >= 2) return "Runda 2 z 2";
    if (round >= 1) return "Runda 1 z 2";
    return "Zbieram mentorów";
  }, [consensus, phase, orderedMentors]);

  const percent = useMemo(() => {
    const total = Math.max(1, orderedMentors.length * 2 + 1);
    const done = turns.length + (consensus ? 1 : 0);
    return Math.min(100, Math.max(6, Math.round((done / total) * 100)));
  }, [orderedMentors.length, turns.length, consensus]);

  // Bring the answer into view once, when it first appears.
  useEffect(() => {
    if (!resultReady) return;
    const reduce =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    resultTopRef.current?.scrollIntoView({
      block: "start",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [resultReady]);

  const tabIndex = TABS.indexOf(tab);
  const changeTab = (next: ViewTab) => {
    if (next === tab) return;
    haptic.selection();
    setTab(next);
    // Opening Historia re-reads the list. Both panels live inside the SwipeDeck and
    // mount with the screen, so without this the debate that just finished is
    // missing from the very place the debate panel sends the user to.
    if (next === "history") setHistoryToken((n) => n + 1);
  };

  const noMentors = selectedMentorIds.size === 0;
  const canSubmit = Boolean(input.trim()) && !isActive && !noMentors;

  /* ---------------- DEBATE PANEL ---------------- */

  const composer = (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp5 }}>
      <VoiceTextarea
        value={input}
        onChange={setInput}
        placeholder="Opisz problem lub pytanie... np. 'Jak pogodzić trening z pracą zdalną?'"
        minHeight={120}
        disabled={isActive}
        onSubmit={startDebate}
      />

      {mentorsLoading ? (
        <div style={{ display: "flex", gap: T.sp2, flexWrap: "wrap" }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="line" width={120} height={44} radius={999} />
          ))}
        </div>
      ) : availableMentors.length > 0 ? (
        <section>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: T.sp2,
              marginBottom: T.sp3,
              flexWrap: "wrap",
            }}
          >
            <div style={{ ...TYPO.label, color: T.text3 }}>
              Mentorzy w debacie · {selectedMentorIds.size}/{availableMentors.length}
            </div>
            <Button variant="ghost" size="sm" onPress={toggleAllMentors}>
              {selectedMentorIds.size === availableMentors.length
                ? "Odznacz wszystkich"
                : "Zaznacz wszystkich"}
            </Button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: T.sp2 }}>
            {availableMentors.map((m) => {
              const selected = selectedMentorIds.has(m.id);
              return (
                <Pressable
                  key={m.id}
                  role="checkbox"
                  ariaChecked={selected}
                  haptic={false}
                  noMinSize
                  onPress={() => toggleMentor(m.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: T.sp2,
                    minHeight: T.tapMin,
                    padding: `0 ${T.sp4}`,
                    borderRadius: T.rFull,
                    ...TYPO.footnote,
                    fontWeight: 700,
                    background: selected ? T.primarySoft : T.surface2,
                    color: selected ? T.primaryOnSurface : T.text3,
                    border: `1.5px solid ${selected ? T.borderAccent : T.border}`,
                    boxShadow: selected ? T.glowAccentSoft : "none",
                    transition: "background-color 140ms linear, color 140ms linear",
                  }}
                >
                  <span style={{ fontSize: 18, lineHeight: 1 }}>{m.avatarEmoji ?? "🧑‍🏫"}</span>
                  <span>{m.name}</span>
                </Pressable>
              );
            })}
          </div>
        </section>
      ) : (
        <Card>
          <EmptyState
            icon={mentorsFailed ? "📡" : "🧑‍🏫"}
            title={mentorsFailed ? "Nie wczytałem mentorów" : "Brak mentorów"}
            body={
              mentorsFailed
                ? "Sprawdź połączenie i spróbuj jeszcze raz."
                : "Dodaj mentorów w ustawieniach, a potem wróć tutaj po debatę."
            }
            action={
              mentorsFailed
                ? { label: "Odśwież", onPress: () => window.location.reload() }
                : { label: "Dodaj mentorów", onPress: () => router.push("/mentors") }
            }
          />
        </Card>
      )}

      <ErrorBanner text={errorMsg} />

      <Button
        size="lg"
        fullWidth
        disabled={!canSubmit}
        loading={isActive}
        haptic="impact"
        onPress={startDebate}
      >
        {noMentors
          ? "Wybierz co najmniej jednego mentora"
          : phase === "error"
            ? "Spróbuj ponownie"
            : "Rozpocznij debatę"}
      </Button>
    </div>
  );

  const runningOrResult = (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp4 }}>
      {/* The question stays visible the whole time. Empty for the split second
          between restoring a debate from localStorage and the first status
          answer, and an empty labelled box reads like a bug. */}
      {submittedQuestion ? (
        <div
          style={{
            padding: T.sp4,
            borderRadius: T.rLg,
            background: T.surface2,
            border: `1px solid ${T.border}`,
          }}
        >
          <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp2 }}>Twoje pytanie</div>
          <div style={{ ...TYPO.callout, color: T.text, whiteSpace: "pre-wrap" }}>
            {submittedQuestion}
          </div>
        </div>
      ) : null}

      <div ref={resultTopRef} />

      {!resultReady ? (
        <>
          <LiveDebate mentors={orderedMentors} stageLabel={stageLabel} percent={percent} />
          {/* The promise the whole rewrite exists for. */}
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              gap: T.sp2,
              ...TYPO.footnote,
              color: T.text2,
            }}
          >
            <span aria-hidden="true">🔒</span>
            Debata liczy się w tle, możesz zamknąć aplikację
          </div>
        </>
      ) : (
        <>
          {/* only reachable when the debate finished and the failure came later */}
          <ErrorBanner text={errorMsg} />

          <EssenceView
            essence={essence}
            consensusFallback={consensus}
            showSteps={planChanges.length === 0}
          />

          {planChanges.length > 0 ? (
            <ProposalPicker
              changes={planChanges}
              appliedIndexes={appliedChanges}
              selected={selectedChanges}
              onToggle={toggleChange}
              onApply={applySelected}
              applying={applying}
              disabled={!sessionId}
              message={applyMsg}
              messageIsError={applyFailed}
            />
          ) : phase !== "done" && phase !== "error" ? (
            // Only while the stream is still running. After an error there is nothing
            // more coming, and "Szykuję propozycje" would sit there for good.
            // A sentence the user reads takes the readable grey, not the quiet one.
            <div style={{ ...TYPO.footnote, color: T.text2 }}>Szykuję propozycje do planu…</div>
          ) : null}

          {typeof essence?.closing === "string" && essence.closing.trim() ? (
            <p style={{ ...TYPO.callout, lineHeight: 1.5, color: T.text2, margin: 0 }}>
              {essence.closing}
            </p>
          ) : null}

          <Button
            variant="secondary"
            size="md"
            fullWidth
            onPress={() => {
              haptic.tap();
              setTranscriptOpen(true);
            }}
          >
            Zobacz całą rozmowę
          </Button>

          <Button size="lg" fullWidth variant="secondary" onPress={reset}>
            Nowa debata
          </Button>
        </>
      )}

      <TranscriptSheet
        open={transcriptOpen}
        onClose={() => setTranscriptOpen(false)}
        question={submittedQuestion}
        turns={turns}
      />
    </div>
  );

  /* ---------------- RENDER ---------------- */

  return (
    <div style={{ padding: `${T.sp6} ${T.gutter} ${T.sp6}` }}>
      <header className="anim-in" style={{ marginBottom: T.sp5 }}>
        <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Mentorzy razem</div>
        <h1
          style={{
            ...TYPO.title1,
            color: T.text,
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: T.sp2,
          }}
        >
          <span style={{ fontSize: 30, lineHeight: 1 }}>🏛️</span>
          Okrągły Stół
        </h1>
        <p style={{ ...TYPO.callout, color: T.text2, margin: `${T.sp1} 0 0` }}>
          Twoi mentorzy debatują w dwóch rundach, a Ty dostajesz samo sedno
        </p>
      </header>

      <SegmentedTabs
        tabs={[
          { key: "debate", label: "Debata" },
          { key: "history", label: "Historia" },
        ]}
        active={tab}
        onChange={(k) => changeTab(k as ViewTab)}
        ariaLabel="Widok okrągłego stołu"
        style={{ marginBottom: T.sp4 }}
      />

      <SwipeDeck
        index={tabIndex}
        onChange={(i) => changeTab(TABS[i])}
        labels={["Debata", "Historia"]}
        ariaLabel="Panele okrągłego stołu"
        // Swiping stays on during a debate now. The work is on the server, so
        // leaving this panel costs nothing, and blocking it would contradict the
        // whole point of running in the background.
        enabled
      >
        {showComposer ? composer : runningOrResult}
        <HistoryView reloadToken={historyToken} />
      </SwipeDeck>

      {/* One definition for the whole screen. The reduced-motion block below is
          explicit on purpose: an animation set through a class can be switched
          off there, an inline `animation` could not. */}
      <style>{`
        @keyframes typingDot {
          0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
          40%           { opacity: 1;    transform: translateY(-3px); }
        }
        @keyframes rtAvatarPulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--primary-soft); }
          50%      { box-shadow: 0 0 0 7px var(--primary-soft); }
        }
        .rt-dot {
          animation: typingDot 1.2s var(--ease-standard) infinite;
        }
        .rt-avatar-pulse {
          animation: rtAvatarPulse 1.8s var(--ease-standard) infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .rt-dot, .rt-avatar-pulse { animation: none !important; }
          .rt-dot { opacity: 0.55; }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  History                                                            */
/* ------------------------------------------------------------------ */

/**
 * `reloadToken` is bumped by the page every time the Historia tab is opened.
 *
 * Both panels live inside the SwipeDeck, so this component mounts once with the
 * screen and used to fetch exactly once. A debate finished after that never
 * appeared here until a full reload, which is the opposite of what the debate
 * panel promises when it stops polling ("od teraz wynik jest w Historii").
 */
function HistoryView({ reloadToken }: { reloadToken: number }) {
  const [sessions, setSessions] = useState<RoundtableHistoryItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/roundtable/history", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setSessions(Array.isArray(data) ? data : []);
        setErr("");
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : "Błąd ładowania historii");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
        <Skeleton variant="block" height={92} radius={20} />
        <Skeleton variant="block" height={92} radius={20} />
        <Skeleton variant="block" height={92} radius={20} />
      </div>
    );
  }

  // A failed RELOAD must not swallow the debates already on screen, so the banner
  // only takes over the panel when there is nothing else to show.
  if (err && sessions.length === 0) return <ErrorBanner text={err} />;

  if (sessions.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="🏛️"
          title="Brak debat"
          body="Zadaj pierwsze pytanie na zakładce Debata, a mentorzy wypracują wspólne stanowisko."
        />
      </Card>
    );
  }

  return (
    <div className="anim-stagger" style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
      {err ? <ErrorBanner text={err} /> : null}
      {sessions.map((s) => (
        <HistoryCard
          key={s.id}
          session={s}
          open={expandedId === s.id}
          onToggle={() => {
            haptic.tap();
            setExpandedId(expandedId === s.id ? null : s.id);
          }}
        />
      ))}
    </div>
  );
}

function HistoryCard({
  session,
  open,
  onToggle,
}: {
  session: RoundtableHistoryItem;
  open: boolean;
  onToggle: () => void;
}) {
  const changes = useMemo(() => parseStoredChanges(session.planChanges), [session.planChanges]);
  const turns = useMemo(
    () => normalizeTranscript(session.debateTranscript),
    [session.debateTranscript]
  );

  const [appliedIdx, setAppliedIdx] = useState<Set<number>>(
    () => new Set(Array.isArray(session.appliedIndexes) ? session.appliedIndexes : [])
  );
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(() => {
    const already = new Set(Array.isArray(session.appliedIndexes) ? session.appliedIndexes : []);
    return new Set(changes.map((_, i) => i).filter((i) => !already.has(i)));
  });
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");
  const [applyFailed, setApplyFailed] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  // Same reason as on the live screen: two taps must not send two apply requests,
  // or the second one leaves before the first has marked its indexes as done.
  const applyLockRef = useRef(false);

  const toggle = useCallback((index: number) => {
    haptic.selection();
    setSelectedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const apply = useCallback(async () => {
    if (applying || applyLockRef.current) return;
    const indexes = Array.from(selectedIdx).sort((a, b) => a - b);
    if (indexes.length === 0) return;

    applyLockRef.current = true;
    haptic.impact();
    setApplying(true);
    setApplyMsg("");
    setApplyFailed(false);
    try {
      const res = await fetch("/api/roundtable/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, indexes }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        haptic.error();
        setApplyFailed(true);
        setApplyMsg(json.error || "Nie udało się wdrożyć ustaleń.");
        return;
      }

      haptic.success();
      const nowApplied: Set<number> = Array.isArray(json.appliedIndexes)
        ? new Set(json.appliedIndexes as number[])
        : new Set([...appliedIdx, ...indexes]);
      setAppliedIdx(nowApplied);
      setSelectedIdx((prev) => new Set([...prev].filter((i) => !nowApplied.has(i))));
      setApplyMsg(
        json.alreadyApplied
          ? "To już jest w planie."
          : `Dodano do planu: ${json.created} ${plItems(Number(json.created) || 0)}.`
      );
    } catch (e) {
      haptic.error();
      setApplyFailed(true);
      setApplyMsg(e instanceof Error ? e.message : "Błąd połączenia");
    } finally {
      applyLockRef.current = false;
      setApplying(false);
    }
  }, [applying, selectedIdx, appliedIdx, session.id]);

  const truncated = session.inputText.length > 120;
  const preview = truncated ? `${session.inputText.slice(0, 120)}...` : session.inputText;

  return (
    <Card padding="none">
      <Pressable
        as="div"
        press="lg"
        onPress={onToggle}
        ariaExpanded={open}
        noMinSize
        style={{ display: "block", width: "100%", padding: T.sp4, textAlign: "left" }}
      >
        <span
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: T.sp3,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, display: "block" }}>
            <span style={{ display: "block", ...TYPO.label, color: T.text3, marginBottom: 6 }}>
              {new Date(session.createdAt).toLocaleString("pl")} ·{" "}
              {session.inputType === "voice" ? "głos" : "tekst"}
            </span>
            <span style={{ display: "block", ...TYPO.title3, color: T.text }}>{preview}</span>
          </span>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{
              flexShrink: 0,
              color: T.text3,
              marginTop: 2,
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: `transform ${MOTION.base} ${MOTION.easeOut}`,
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </Pressable>

      {open ? (
        <div
          className="reveal"
          style={{
            padding: `${T.sp4} ${T.sp4} ${T.sp4}`,
            borderTop: `1px solid ${T.border}`,
            display: "flex",
            flexDirection: "column",
            gap: T.sp4,
          }}
        >
          {/* The header only shows the first 120 characters. The old screen let the
              user read the whole question here, and a session without a transcript
              has no other place that carries it. */}
          {truncated ? (
            <section>
              <SectionHeading>Pytanie</SectionHeading>
              <p style={{ ...TYPO.callout, color: T.text, whiteSpace: "pre-wrap", margin: 0 }}>
                {session.inputText}
              </p>
            </section>
          ) : null}

          <EssenceView
            essence={session.essence}
            consensusFallback={session.consensus}
            showSteps={changes.length === 0}
          />

          {changes.length > 0 ? (
            <ProposalPicker
              changes={changes}
              appliedIndexes={appliedIdx}
              selected={selectedIdx}
              onToggle={toggle}
              onApply={apply}
              applying={applying}
              message={applyMsg}
              messageIsError={applyFailed}
            />
          ) : null}

          {typeof session.essence?.closing === "string" && session.essence.closing.trim() ? (
            <p style={{ ...TYPO.callout, lineHeight: 1.5, color: T.text2, margin: 0 }}>
              {session.essence.closing}
            </p>
          ) : null}

          {turns.length > 0 ? (
            <Button
              variant="secondary"
              size="md"
              fullWidth
              onPress={() => {
                haptic.tap();
                setTranscriptOpen(true);
              }}
            >
              Zobacz całą rozmowę
            </Button>
          ) : null}

          <TranscriptSheet
            open={transcriptOpen}
            onClose={() => setTranscriptOpen(false)}
            question={session.inputText}
            turns={turns}
          />
        </div>
      ) : null}
    </Card>
  );
}
