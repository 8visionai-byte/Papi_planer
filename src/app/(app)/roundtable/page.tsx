"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import { Button, Card, EmptyState, Pressable, Skeleton, T, TYPO } from "@/components/ui";
import { SegmentedTabs, SwipeDeck } from "@/components/motion";
import { haptic } from "@/lib/haptics";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type RoundTableEvent =
  | {
      type: "mentor_start";
      mentorId: string;
      mentorName: string;
      mentorRole: string;
      avatarEmoji: string;
      model: string;
      round: number;
    }
  | {
      type: "mentor_response";
      mentorId: string;
      mentorName: string;
      mentorRole: string;
      avatarEmoji: string;
      model: string;
      round: number;
      content: string;
    }
  | { type: "consensus"; content: string; model: string }
  | { type: "plan_changes"; changes: PlanChange[] }
  | { type: "done"; sessionId: string }
  | { type: "error"; error: string };

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

type Phase = "idle" | "submitting" | "debating" | "consensus" | "done" | "error";

interface ThinkingMentor {
  mentorId: string;
  mentorName: string;
  mentorRole: string;
  avatarEmoji: string;
  model: string;
  round: number;
}

interface MentorResponse {
  type: "mentor_response";
  mentorId: string;
  mentorName: string;
  mentorRole: string;
  avatarEmoji: string;
  model: string;
  round: number;
  content: string;
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

/** Round identity. Cyan = round 1, secondary blue = round 2. Never two fills. */
function roundTint(round: number): { fg: string; soft: string; label: string } {
  if (round === 1) {
    return {
      fg: T.primaryOnSurface,
      soft: T.primarySoft,
      label: "Runda 1 · pierwsze stanowiska",
    };
  }
  return {
    fg: T.accentOnSurface,
    soft: T.accentSoft,
    label: "Runda 2 · reakcje i kompromis",
  };
}

/** Small muted chip carrying the model name. */
function ModelChip({ model }: { model: string }) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1.3,
        padding: "4px 10px",
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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function RoundTablePage() {
  const [tab, setTab] = useState<ViewTab>("debate");
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [responses, setResponses] = useState<MentorResponse[]>([]);
  const [consensus, setConsensus] = useState<{ content: string; model: string } | null>(null);
  const [planChanges, setPlanChanges] = useState<PlanChange[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [applyMsg, setApplyMsg] = useState("");
  const [thinkingMentors, setThinkingMentors] = useState<ThinkingMentor[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [availableMentors, setAvailableMentors] = useState<MentorListItem[]>([]);
  const [selectedMentorIds, setSelectedMentorIds] = useState<Set<string>>(new Set());
  const [mentorsLoading, setMentorsLoading] = useState(true);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const submittedQuestionRef = useRef<string>("");

  // Keep the newest response in view. The page scrolls with the document now
  // (same shell as every other screen), so we anchor instead of setting
  // scrollTop on a private scroller.
  useEffect(() => {
    if (phase === "idle" || phase === "error") return;
    feedEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [responses, thinkingMentors, consensus, phase]);

  // Fetch active mentors on mount
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

  const startDebate = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (selectedMentorIds.size === 0) return;
    submittedQuestionRef.current = trimmed;
    haptic.impact();
    setPhase("submitting");
    setResponses([]);
    setConsensus(null);
    setPlanChanges([]);
    setSessionId(null);
    setApplied(false);
    setApplyMsg("");
    setThinkingMentors([]);
    setErrorMsg("");

    try {
      const res = await fetch("/api/roundtable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          mentorIds: Array.from(selectedMentorIds),
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setErrorMsg(errBody.error || `Błąd serwera (${res.status})`);
        setPhase("error");
        return;
      }

      setPhase("debating");
      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event: RoundTableEvent = JSON.parse(line.slice(6));

            if (event.type === "mentor_start") {
              setThinkingMentors((prev) => [
                ...prev.filter(
                  (m) => !(m.mentorId === event.mentorId && m.round === event.round)
                ),
                {
                  mentorId: event.mentorId,
                  mentorName: event.mentorName,
                  mentorRole: event.mentorRole,
                  avatarEmoji: event.avatarEmoji,
                  model: event.model,
                  round: event.round,
                },
              ]);
            } else if (event.type === "mentor_response") {
              setThinkingMentors((prev) =>
                prev.filter(
                  (m) => !(m.mentorId === event.mentorId && m.round === event.round)
                )
              );
              setResponses((prev) => [...prev, event]);
            } else if (event.type === "consensus") {
              haptic.success();
              setPhase("consensus");
              setConsensus({ content: event.content, model: event.model });
            } else if (event.type === "plan_changes") {
              setPlanChanges(Array.isArray(event.changes) ? event.changes : []);
            } else if (event.type === "done") {
              setSessionId(event.sessionId);
              setPhase("done");
            } else if (event.type === "error") {
              haptic.error();
              setErrorMsg(event.error);
              setPhase("error");
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } catch (err) {
      haptic.error();
      setErrorMsg(err instanceof Error ? err.message : "Błąd połączenia");
      setPhase("error");
    }
  }, [input, selectedMentorIds]);

  const reset = () => {
    haptic.tap();
    setPhase("idle");
    setInput("");
    setResponses([]);
    setConsensus(null);
    setPlanChanges([]);
    setSessionId(null);
    setApplied(false);
    setApplyMsg("");
    setThinkingMentors([]);
    setErrorMsg("");
    submittedQuestionRef.current = "";
  };

  /** Write the debate's proposals into the plan as real activities. */
  const applyChanges = useCallback(async () => {
    if (!sessionId || applying || applied) return;
    haptic.impact();
    setApplying(true);
    setApplyMsg("");
    try {
      const res = await fetch("/api/roundtable/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        haptic.error();
        setApplyMsg(json.error || "Nie udało się wdrożyć ustaleń.");
        return;
      }
      haptic.success();
      setApplied(true);
      setApplyMsg(
        json.alreadyApplied
          ? "Te ustalenia były już wdrożone."
          : `Dodano do planu: ${json.created} ${json.created === 1 ? "pozycję" : "pozycje"}.`
      );
    } catch (e) {
      haptic.error();
      setApplyMsg(e instanceof Error ? e.message : "Błąd połączenia");
    } finally {
      setApplying(false);
    }
  }, [sessionId, applying, applied]);

  const isActive = phase === "debating" || phase === "submitting";
  const showComposer = phase === "idle" || phase === "error";

  // Group responses by round
  const round1Responses = responses.filter((r) => r.round === 1);
  const round2Responses = responses.filter((r) => r.round === 2);
  const round1Thinking = thinkingMentors.filter((m) => m.round === 1);
  const round2Thinking = thinkingMentors.filter((m) => m.round === 2);

  const tabIndex = TABS.indexOf(tab);
  const changeTab = (next: ViewTab) => {
    if (next === tab) return;
    haptic.selection();
    setTab(next);
  };

  const noMentors = selectedMentorIds.size === 0;
  const canSubmit = Boolean(input.trim()) && !isActive && !noMentors;

  /* ---------------- DEBATE PANEL ---------------- */

  const debatePanel = showComposer ? (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp5 }}>
      <VoiceTextarea
        value={input}
        onChange={setInput}
        placeholder="Opisz problem lub pytanie... np. 'Jak pogodzić trening z pracą zdalną?'"
        minHeight={120}
        disabled={isActive}
        onSubmit={startDebate}
      />

      {/* Mentor selection */}
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
      ) : null}

      {errorMsg && (
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
          {errorMsg}
        </div>
      )}

      <Button
        size="lg"
        fullWidth
        disabled={!canSubmit}
        loading={isActive}
        haptic="impact"
        onPress={startDebate}
      >
        {noMentors ? "Wybierz co najmniej jednego mentora" : "Rozpocznij debatę"}
      </Button>
    </div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp4 }}>
      {/* User question */}
      <div
        style={{
          padding: `${T.sp4}`,
          borderRadius: T.rLg,
          background: T.surface2,
          border: `1px solid ${T.border}`,
        }}
      >
        <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp2 }}>Twoje pytanie</div>
        <div style={{ ...TYPO.callout, color: T.text, whiteSpace: "pre-wrap" }}>
          {submittedQuestionRef.current}
        </div>
      </div>

      {(round1Responses.length > 0 || round1Thinking.length > 0) && (
        <RoundSection round={1} responses={round1Responses} thinking={round1Thinking} />
      )}

      {(round2Responses.length > 0 || round2Thinking.length > 0) && (
        <RoundSection round={2} responses={round2Responses} thinking={round2Thinking} />
      )}

      {consensus && (
        <div
          className="anim-in"
          style={{
            marginTop: T.sp2,
            padding: `${T.sp5} ${T.sp4}`,
            borderRadius: T.rXl,
            background: T.surface,
            backgroundImage: "var(--hero-wash)",
            border: `1px solid ${T.borderAccent}`,
            boxShadow: T.elev3,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: T.sp2,
              marginBottom: T.sp3,
              flexWrap: "wrap",
            }}
          >
            <div style={{ ...TYPO.label, color: T.successOnSurface }}>
              Konsensus Okrągłego Stołu
            </div>
            <ModelChip model={consensus.model} />
          </div>
          <div style={{ ...TYPO.callout, lineHeight: 1.7, color: T.text, whiteSpace: "pre-wrap" }}>
            {consensus.content}
          </div>

          {planChanges.length > 0 && (
            <div style={{ marginTop: T.sp5 }}>
              <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp2 }}>
                Do wdrożenia w planie · {planChanges.length}
              </div>
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
                {planChanges.map((c, i) => (
                  <li
                    key={i}
                    style={{
                      padding: `${T.sp3} 14px`,
                      borderRadius: T.rMd,
                      background: T.surface2,
                      border: `1px solid ${T.border}`,
                    }}
                  >
                    <div style={{ ...TYPO.footnote, fontWeight: 700, color: T.text }}>
                      {c.title}
                    </div>
                    <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>
                      {[
                        c.time ? `godz. ${c.time}` : "zadanie bez pory dnia",
                        c.durationMin ? `${c.durationMin} min` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {c.description && (
                      <div style={{ ...TYPO.footnote, color: T.text2, marginTop: 4 }}>
                        {c.description}
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              <div style={{ marginTop: T.sp3 }}>
                <Button
                  size="md"
                  fullWidth
                  disabled={!sessionId || applied}
                  loading={applying}
                  onPress={applyChanges}
                >
                  {applied ? "Wdrożone w planie" : "Wdróż ustalenia"}
                </Button>
              </div>

              {applyMsg && (
                <div
                  role="status"
                  style={{ ...TYPO.footnote, color: T.text3, marginTop: T.sp2 }}
                >
                  {applyMsg}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isActive && thinkingMentors.length === 0 && phase === "debating" && (
        <div
          style={{
            textAlign: "center",
            padding: T.sp4,
            color: T.text3,
            ...TYPO.callout,
            animation: "pulse 1.6s var(--ease-standard) infinite",
          }}
        >
          Mentorzy dyskutują…
        </div>
      )}

      {(phase === "done" || phase === "consensus") && (
        <Button size="lg" fullWidth variant="secondary" onPress={reset}>
          Nowa debata
        </Button>
      )}

      <div ref={feedEndRef} />
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
          Twoi mentorzy debatują w dwóch rundach i wypracowują wspólne stanowisko
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
        enabled={!isActive}
      >
        {debatePanel}
        <HistoryView />
      </SwipeDeck>

      {/* one definition for the whole screen; the reduced-motion block in
          globals.css turns every `animation` off, this one included */}
      <style>{`
        @keyframes typingDot {
          0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
          40%           { opacity: 1;    transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Round section — the round label works as a separator               */
/* ------------------------------------------------------------------ */

function RoundSection({
  round,
  responses,
  thinking,
}: {
  round: number;
  responses: MentorResponse[];
  thinking: ThinkingMentor[];
}) {
  const tint = roundTint(round);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
      {/* separator: label + hairline, no tinted box */}
      <div style={{ display: "flex", alignItems: "center", gap: T.sp3, marginTop: T.sp2 }}>
        <span
          aria-hidden="true"
          style={{
            width: 28,
            height: 28,
            borderRadius: T.rFull,
            background: tint.soft,
            color: tint.fg,
            fontWeight: 800,
            fontSize: 13,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          {round}
        </span>
        <span style={{ ...TYPO.label, color: tint.fg, whiteSpace: "nowrap" }}>{tint.label}</span>
        <span style={{ flex: 1, height: 1, background: T.border, minWidth: 8 }} />
      </div>

      <div className="anim-stagger" style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
        {responses.map((r, idx) => (
          <MentorResponseCard key={`${r.mentorId}-r${r.round}-${idx}`} response={r} />
        ))}
        {thinking.map((m) => (
          <ThinkingCard key={`thinking-${m.mentorId}-r${m.round}`} mentor={m} />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Mentor response card                                               */
/* ------------------------------------------------------------------ */

function MentorResponseCard({ response }: { response: MentorResponse }) {
  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: T.sp3,
          marginBottom: T.sp3,
        }}
      >
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: T.rFull,
            background: T.surface2,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {response.avatarEmoji}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...TYPO.title3, fontWeight: 700, color: T.text, overflowWrap: "anywhere" }}>
            {response.mentorName}
          </div>
          <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>
            {response.mentorRole}
          </div>
        </div>
        <ModelChip model={response.model} />
      </div>

      <div style={{ ...TYPO.callout, lineHeight: 1.65, color: T.text2, whiteSpace: "pre-wrap" }}>
        {response.content}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Thinking indicator card                                            */
/* ------------------------------------------------------------------ */

function ThinkingCard({ mentor }: { mentor: ThinkingMentor }) {
  return (
    <Card style={{ opacity: 0.88 }}>
      <div style={{ display: "flex", alignItems: "center", gap: T.sp3 }}>
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: T.rFull,
            background: T.surface2,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {mentor.avatarEmoji}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...TYPO.title3, fontWeight: 700, color: T.text, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {mentor.mentorName}
            </span>
            <span style={{ display: "inline-flex", gap: 4, flexShrink: 0 }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    width: 6,
                    height: 6,
                    borderRadius: T.rFull,
                    background: T.primaryOnSurface,
                    animation: `typingDot 1.2s ${i * 160}ms var(--ease-standard) infinite`,
                  }}
                />
              ))}
            </span>
          </div>
          <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>{mentor.mentorRole}</div>
        </div>
        <ModelChip model={mentor.model} />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  History                                                            */
/* ------------------------------------------------------------------ */

/** How many concrete proposals a stored session carries. */
function historyChangeCount(planChanges: unknown): number {
  if (!planChanges || typeof planChanges !== "object") return 0;
  const changes = (planChanges as { changes?: unknown }).changes;
  return Array.isArray(changes) ? changes.length : 0;
}

function HistoryView() {
  const [sessions, setSessions] = useState<RoundtableHistoryItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState("");
  const [applyErrorId, setApplyErrorId] = useState<string | null>(null);

  const applyFromHistory = useCallback(async (id: string) => {
    haptic.impact();
    setApplyingId(id);
    setApplyError("");
    setApplyErrorId(null);
    try {
      const res = await fetch("/api/roundtable/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        haptic.error();
        setApplyError(json.error || "Nie udało się wdrożyć ustaleń.");
        setApplyErrorId(id);
        return;
      }
      haptic.success();
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, applied: true } : s)));
    } catch (e) {
      haptic.error();
      setApplyError(e instanceof Error ? e.message : "Błąd połączenia");
      setApplyErrorId(id);
    } finally {
      setApplyingId(null);
    }
  }, []);

  useEffect(() => {
    fetch("/api/roundtable/history")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setSessions(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : "Błąd ładowania historii");
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
        <Skeleton variant="block" height={92} radius={20} />
        <Skeleton variant="block" height={92} radius={20} />
        <Skeleton variant="block" height={92} radius={20} />
      </div>
    );
  }

  if (err) {
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
        {err}
      </div>
    );
  }

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
      {sessions.map((s) => {
        const transcript = Array.isArray(s.debateTranscript) ? s.debateTranscript : [];
        const isOpen = expandedId === s.id;
        const preview =
          s.inputText.length > 120 ? s.inputText.slice(0, 120) + "..." : s.inputText;

        return (
          <Card key={s.id} padding="none">
            <Pressable
              as="div"
              press="lg"
              onPress={() => {
                haptic.tap();
                setExpandedId(isOpen ? null : s.id);
              }}
              ariaExpanded={isOpen}
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
                  <span
                    style={{ display: "block", ...TYPO.label, color: T.text3, marginBottom: 6 }}
                  >
                    {new Date(s.createdAt).toLocaleString("pl")} ·{" "}
                    {s.inputType === "voice" ? "głos" : "tekst"}
                  </span>
                  <span style={{ display: "block", ...TYPO.title3, color: T.text }}>
                    {preview}
                  </span>
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
                    transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 220ms var(--ease-out)",
                  }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </span>
            </Pressable>

            {isOpen && (
              <div
                className="reveal"
                style={{
                  padding: `0 ${T.sp4} ${T.sp4}`,
                  borderTop: `1px solid ${T.border}`,
                  marginTop: 0,
                  paddingTop: T.sp4,
                }}
              >
                <div style={{ marginBottom: T.sp5 }}>
                  <h4 style={{ ...TYPO.label, color: T.text3, margin: `0 0 ${T.sp2}` }}>Pytanie</h4>
                  <p style={{ ...TYPO.callout, color: T.text, whiteSpace: "pre-wrap", margin: 0 }}>
                    {s.inputText}
                  </p>
                </div>

                {transcript.length > 0 && (
                  <div style={{ marginBottom: T.sp5 }}>
                    <h4 style={{ ...TYPO.label, color: T.text3, margin: `0 0 ${T.sp2}` }}>
                      Dyskusja · {transcript.length} wypowiedzi
                    </h4>
                    <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
                      {transcript.map((entry, i) => {
                        const e = entry as {
                          mentorName?: string;
                          mentorEmoji?: string;
                          avatarEmoji?: string;
                          model?: string;
                          content?: string;
                          round?: number;
                        };
                        const emoji = e.mentorEmoji || e.avatarEmoji || "🧑‍🏫";
                        return (
                          <div
                            key={i}
                            style={{
                              padding: `${T.sp3} 14px`,
                              background: T.surface2,
                              borderRadius: T.rMd,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: T.sp2,
                                marginBottom: T.sp2,
                                flexWrap: "wrap",
                              }}
                            >
                              <span style={{ ...TYPO.footnote, fontWeight: 700, color: T.text }}>
                                <span style={{ marginRight: 4 }}>{emoji}</span>
                                {e.mentorName || "Mentor"}
                              </span>
                              {e.round !== undefined && (
                                <span style={{ fontSize: 12, color: T.text3 }}>
                                  runda {e.round}
                                </span>
                              )}
                              {e.model && <ModelChip model={e.model} />}
                            </div>
                            <p
                              style={{
                                ...TYPO.footnote,
                                lineHeight: 1.55,
                                color: T.text2,
                                margin: 0,
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {e.content || ""}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {s.consensus && (
                  <div style={{ marginBottom: T.sp3 }}>
                    <h4 style={{ ...TYPO.label, color: T.successOnSurface, margin: `0 0 ${T.sp2}` }}>
                      Konsensus
                    </h4>
                    <p
                      style={{
                        ...TYPO.callout,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        margin: 0,
                        padding: `${T.sp3} 14px`,
                        borderRadius: T.rMd,
                        background: T.successSoft,
                        border: `1px solid ${T.success}`,
                        color: T.text,
                      }}
                    >
                      {s.consensus}
                    </p>
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: T.sp3,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ ...TYPO.footnote, color: T.text3 }}>
                    {s.applied ? "Wdrożone w planie" : "Nie wdrożone"}
                  </div>
                  {!s.applied && historyChangeCount(s.planChanges) > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={applyingId === s.id}
                      disabled={applyingId !== null}
                      onPress={() => applyFromHistory(s.id)}
                    >
                      Wdróż ustalenia ({historyChangeCount(s.planChanges)})
                    </Button>
                  )}
                </div>
                {applyErrorId === s.id && applyError && (
                  <div
                    role="alert"
                    style={{ ...TYPO.footnote, color: T.dangerOnSurface, marginTop: T.sp2 }}
                  >
                    {applyError}
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
