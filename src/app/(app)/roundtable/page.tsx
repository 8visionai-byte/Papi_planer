"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import VoiceTextarea from "@/components/forms/VoiceTextarea";

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
  | { type: "done"; sessionId: string }
  | { type: "error"; error: string };

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

type ViewTab = "debate" | "history";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function modelLabel(model: string): string {
  if (model.includes("opus")) return "opus 4.6";
  if (model.includes("sonnet")) return "sonnet 4.6";
  if (model.includes("haiku")) return "haiku 4.5";
  return model;
}

function roundTint(round: number): { bg: string; accent: string; label: string } {
  if (round === 1) {
    return {
      bg: "linear-gradient(180deg, rgba(59,130,246,0.06), rgba(59,130,246,0.02))",
      accent: "#3b82f6",
      label: "Runda 1 — pierwsze stanowiska",
    };
  }
  return {
    bg: "linear-gradient(180deg, rgba(168,85,247,0.06), rgba(168,85,247,0.02))",
    accent: "#a855f7",
    label: "Runda 2 — reakcje i kompromis",
  };
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
  const [thinkingMentors, setThinkingMentors] = useState<ThinkingMentor[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const submittedQuestionRef = useRef<string>("");

  // Auto-scroll
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [responses, thinkingMentors, consensus]);

  const startDebate = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    submittedQuestionRef.current = trimmed;
    setPhase("submitting");
    setResponses([]);
    setConsensus(null);
    setThinkingMentors([]);
    setErrorMsg("");

    try {
      const res = await fetch("/api/roundtable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
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
              setPhase("consensus");
              setConsensus({ content: event.content, model: event.model });
            } else if (event.type === "done") {
              setPhase("done");
            } else if (event.type === "error") {
              setErrorMsg(event.error);
              setPhase("error");
            }
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Błąd połączenia");
      setPhase("error");
    }
  }, [input]);

  const reset = () => {
    setPhase("idle");
    setInput("");
    setResponses([]);
    setConsensus(null);
    setThinkingMentors([]);
    setErrorMsg("");
    submittedQuestionRef.current = "";
  };

  const isActive = phase === "debating" || phase === "submitting";

  // Group responses by round
  const round1Responses = responses.filter((r) => r.round === 1);
  const round2Responses = responses.filter((r) => r.round === 2);
  const round1Thinking = thinkingMentors.filter((m) => m.round === 1);
  const round2Thinking = thinkingMentors.filter((m) => m.round === 2);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: "16px 20px 12px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 28 }}>🏛️</span>
          Okrągły Stół
        </h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
          Twoi mentorzy debatują w 2 rundach i wypracowują wspólne stanowisko
        </p>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
          {(["debate", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: "8px 16px",
                borderRadius: 9999,
                border: "none",
                background: tab === t ? "var(--primary)" : "transparent",
                color: tab === t ? "#fff" : "var(--muted)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 200ms ease",
              }}
            >
              {t === "debate" ? "Debata" : "Historia debat"}
            </button>
          ))}
        </div>
      </header>

      {/* History tab */}
      {tab === "history" && <HistoryView />}

      {/* Input section */}
      {tab === "debate" && (phase === "idle" || phase === "error") && (
        <div style={{ padding: 20 }}>
          <VoiceTextarea
            value={input}
            onChange={setInput}
            placeholder="Opisz problem lub pytanie... np. 'Jak pogodzić trening z pracą zdalną?'"
            minHeight={120}
            disabled={isActive}
            onSubmit={startDebate}
          />

          {errorMsg && (
            <div
              style={{
                marginTop: 8,
                padding: 10,
                borderRadius: 8,
                background: "#fef2f2",
                color: "var(--danger)",
                fontSize: 13,
              }}
            >
              {errorMsg}
            </div>
          )}

          <button
            onClick={startDebate}
            disabled={!input.trim() || isActive}
            style={{
              marginTop: 12,
              width: "100%",
              padding: "14px 0",
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 12,
              border: "none",
              cursor: input.trim() && !isActive ? "pointer" : "not-allowed",
              background:
                input.trim() && !isActive ? "var(--primary)" : "var(--border)",
              color: input.trim() && !isActive ? "#fff" : "var(--muted)",
              transition: "background 150ms ease",
            }}
          >
            Rozpocznij debatę
          </button>
        </div>
      )}

      {/* Debate feed */}
      {tab === "debate" && phase !== "idle" && phase !== "error" && (
        <div
          ref={feedRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 16px 140px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* User question card */}
          <div
            style={{
              padding: 14,
              borderRadius: 12,
              background: "var(--primary)",
              color: "#fff",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <div
              style={{
                fontSize: 11,
                opacity: 0.8,
                marginBottom: 4,
                fontWeight: 600,
                letterSpacing: 0.3,
                textTransform: "uppercase",
              }}
            >
              Twoje pytanie
            </div>
            {submittedQuestionRef.current}
          </div>

          {/* Round 1 section */}
          {(round1Responses.length > 0 || round1Thinking.length > 0) && (
            <RoundSection
              round={1}
              responses={round1Responses}
              thinking={round1Thinking}
            />
          )}

          {/* Round 2 section */}
          {(round2Responses.length > 0 || round2Thinking.length > 0) && (
            <RoundSection
              round={2}
              responses={round2Responses}
              thinking={round2Thinking}
            />
          )}

          {/* Consensus */}
          {consensus && (
            <div
              style={{
                marginTop: 8,
                padding: 18,
                borderRadius: 16,
                background: "linear-gradient(135deg, #ecfdf5, #d1fae5)",
                border: "2px solid #10b981",
                animation: "fadeInUp 400ms ease both",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 12,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 24 }}>✅</span>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#065f46" }}>
                  Konsensus Okrągłego Stołu
                </div>
                <span
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    borderRadius: 999,
                    background: "rgba(16,185,129,0.18)",
                    color: "#065f46",
                    fontWeight: 600,
                  }}
                >
                  🧠 {modelLabel(consensus.model)}
                </span>
              </div>
              <div
                style={{
                  margin: 0,
                  fontSize: 14,
                  lineHeight: 1.7,
                  color: "#064e3b",
                  whiteSpace: "pre-wrap",
                }}
              >
                {consensus.content}
              </div>
            </div>
          )}

          {/* Active hint */}
          {isActive && thinkingMentors.length === 0 && phase === "debating" && (
            <div
              style={{
                textAlign: "center",
                padding: 12,
                color: "var(--muted)",
                fontSize: 13,
              }}
            >
              <span style={{ animation: "pulse 1.4s ease-in-out infinite" }}>
                Mentorzy dyskutują…
              </span>
            </div>
          )}
        </div>
      )}

      {/* New debate button */}
      {tab === "debate" && (phase === "done" || phase === "consensus") && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: 0,
            right: 0,
            padding: "12px 20px",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <button
            onClick={reset}
            style={{
              padding: "12px 32px",
              fontSize: 15,
              fontWeight: 600,
              borderRadius: 12,
              border: "none",
              cursor: "pointer",
              background: "var(--primary)",
              color: "#fff",
              boxShadow: "0 4px 12px rgba(29, 78, 216, 0.3)",
            }}
          >
            Nowa debata
          </button>
        </div>
      )}

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes typingDot {
          0%, 80%, 100% { opacity: 0.2; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Round section component                                            */
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
    <div
      style={{
        padding: "12px 12px 14px",
        borderRadius: 14,
        background: tint.bg,
        border: `1px solid ${tint.accent}33`,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 2,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: tint.accent,
            color: "#fff",
            fontWeight: 700,
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {round}
        </div>
        <div style={{ fontWeight: 600, fontSize: 13, color: tint.accent }}>
          {tint.label}
        </div>
      </div>

      {responses.map((r, idx) => (
        <MentorCard key={`${r.mentorId}-r${r.round}-${idx}`} response={r} />
      ))}

      {thinking.map((m) => (
        <ThinkingCard key={`thinking-${m.mentorId}-r${m.round}`} mentor={m} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mentor response card                                               */
/* ------------------------------------------------------------------ */

function MentorCard({ response }: { response: MentorResponse }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        background: "var(--card)",
        boxShadow: "var(--card-shadow)",
        animation: "fadeInUp 300ms ease both",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 30 }}>{response.avatarEmoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>
            {response.mentorName}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted)",
              marginTop: 2,
            }}
          >
            {response.mentorRole}
          </div>
        </div>
        <span
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 999,
            background: "rgba(99,102,241,0.12)",
            color: "#4f46e5",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          🧠 {modelLabel(response.model)}
        </span>
      </div>
      <div
        style={{
          margin: 0,
          fontSize: 14,
          lineHeight: 1.65,
          color: "var(--foreground)",
          whiteSpace: "pre-wrap",
        }}
      >
        {response.content}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Thinking indicator card                                            */
/* ------------------------------------------------------------------ */

function HistoryView() {
  const [sessions, setSessions] = useState<RoundtableHistoryItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

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
      <div style={{ padding: 20, color: "var(--muted)", fontSize: 14 }}>
        Ładowanie historii debat...
      </div>
    );
  }

  if (err) {
    return (
      <div
        style={{
          margin: 20,
          padding: 12,
          borderRadius: 10,
          background: "#fef2f2",
          color: "var(--danger)",
          fontSize: 13,
        }}
      >
        {err}
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div style={{ padding: 20 }}>
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            background: "var(--card)",
            boxShadow: "var(--card-shadow)",
            color: "var(--muted)",
            fontSize: 14,
          }}
        >
          Brak debat. Przejdź na zakładkę „Debata" i rozpocznij pierwszą.
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "16px 16px 120px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 4px" }}>
        Historia okrągłych stołów ({sessions.length})
      </p>
      {sessions.map((s) => {
        const transcript = Array.isArray(s.debateTranscript) ? s.debateTranscript : [];
        const isOpen = expandedId === s.id;
        const preview =
          s.inputText.length > 120 ? s.inputText.slice(0, 120) + "..." : s.inputText;
        return (
          <div
            key={s.id}
            style={{
              padding: 14,
              borderRadius: 12,
              background: "var(--card)",
              boxShadow: "var(--card-shadow)",
            }}
          >
            <div
              style={{ cursor: "pointer", userSelect: "none" }}
              onClick={() => setExpandedId(isOpen ? null : s.id)}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      marginBottom: 4,
                    }}
                  >
                    {new Date(s.createdAt).toLocaleString("pl")} ·{" "}
                    {s.inputType === "voice" ? "🎤 voice" : "💬 tekst"}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--foreground)",
                    }}
                  >
                    {preview}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 18,
                    color: "var(--muted)",
                    flexShrink: 0,
                  }}
                >
                  {isOpen ? "▼" : "▶"}
                </span>
              </div>
            </div>

            {isOpen && (
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 16,
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div style={{ marginBottom: 16 }}>
                  <h4
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--muted)",
                      margin: "0 0 6px",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    Pytanie
                  </h4>
                  <p
                    style={{
                      fontSize: 14,
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                      margin: 0,
                    }}
                  >
                    {s.inputText}
                  </p>
                </div>

                {transcript.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <h4
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--muted)",
                        margin: "0 0 6px",
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      Dyskusja ({transcript.length} wypowiedzi)
                    </h4>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
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
                              padding: "10px 12px",
                              background: "var(--background)",
                              borderRadius: 10,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                marginBottom: 4,
                                flexWrap: "wrap",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color: "var(--primary)",
                                }}
                              >
                                {emoji} {e.mentorName || "Mentor"}
                              </span>
                              {e.round !== undefined && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: "var(--muted)",
                                  }}
                                >
                                  · runda {e.round}
                                </span>
                              )}
                              {e.model && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    padding: "2px 6px",
                                    borderRadius: 999,
                                    background: "rgba(99,102,241,0.12)",
                                    color: "#4f46e5",
                                    fontWeight: 600,
                                  }}
                                >
                                  🧠 {modelLabel(e.model)}
                                </span>
                              )}
                            </div>
                            <p
                              style={{
                                fontSize: 13,
                                lineHeight: 1.5,
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
                  <div style={{ marginBottom: 12 }}>
                    <h4
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#10b981",
                        margin: "0 0 6px",
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      ✅ Konsensus
                    </h4>
                    <p
                      style={{
                        fontSize: 14,
                        lineHeight: 1.6,
                        whiteSpace: "pre-wrap",
                        margin: 0,
                        padding: 12,
                        borderRadius: 10,
                        background: "linear-gradient(135deg, #ecfdf5, #d1fae5)",
                        color: "#064e3b",
                      }}
                    >
                      {s.consensus}
                    </p>
                  </div>
                )}

                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {s.applied ? "✅ Wdrożone w planie" : "⏳ Nie wdrożone"}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ThinkingCard({ mentor }: { mentor: ThinkingMentor }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 12,
        background: "var(--card)",
        boxShadow: "var(--card-shadow)",
        opacity: 0.85,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 28 }}>{mentor.avatarEmoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {mentor.mentorName} pisze
            <span style={{ display: "inline-flex", marginLeft: 4 }}>
              <span style={{ animation: "typingDot 1.4s ease-in-out infinite" }}>.</span>
              <span style={{ animation: "typingDot 1.4s ease-in-out 0.2s infinite" }}>.</span>
              <span style={{ animation: "typingDot 1.4s ease-in-out 0.4s infinite" }}>.</span>
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {mentor.mentorRole}
          </div>
        </div>
        <span
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 999,
            background: "rgba(99,102,241,0.12)",
            color: "#4f46e5",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          🧠 {modelLabel(mentor.model)}
        </span>
      </div>
    </div>
  );
}
