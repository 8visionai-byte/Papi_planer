"use client";

import { useState, useRef, useEffect, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type RoundTableEvent =
  | { type: "mentor_start"; mentorId: string; mentorName: string; avatarEmoji: string }
  | { type: "mentor_response"; mentorId: string; mentorName: string; avatarEmoji: string; content: string }
  | { type: "cross_comment"; mentorId: string; mentorName: string; avatarEmoji: string; content: string; replyingTo: string }
  | { type: "consensus"; content: string }
  | { type: "done"; sessionId: string }
  | { type: "error"; error: string };

type Phase = "idle" | "submitting" | "debating" | "consensus" | "done" | "error";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function RoundTablePage() {
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [events, setEvents] = useState<RoundTableEvent[]>([]);
  const [thinkingMentors, setThinkingMentors] = useState<
    { mentorId: string; mentorName: string; avatarEmoji: string }[]
  >([]);
  const [errorMsg, setErrorMsg] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events, thinkingMentors]);

  const startDebate = useCallback(async () => {
    if (!input.trim()) return;
    setPhase("submitting");
    setEvents([]);
    setThinkingMentors([]);
    setErrorMsg("");

    try {
      const res = await fetch("/api/roundtable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: input.trim() }),
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
                ...prev,
                { mentorId: event.mentorId, mentorName: event.mentorName, avatarEmoji: event.avatarEmoji },
              ]);
            } else if (event.type === "mentor_response") {
              setThinkingMentors((prev) => prev.filter((m) => m.mentorId !== event.mentorId));
              setEvents((prev) => [...prev, event]);
            } else if (event.type === "cross_comment") {
              setEvents((prev) => [...prev, event]);
            } else if (event.type === "consensus") {
              setPhase("consensus");
              setEvents((prev) => [...prev, event]);
            } else if (event.type === "done") {
              setPhase("done");
              setEvents((prev) => [...prev, event]);
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
    setEvents([]);
    setThinkingMentors([]);
    setErrorMsg("");
  };

  const isActive = phase === "debating" || phase === "submitting";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", maxWidth: 600, margin: "0 auto" }}>
      {/* Header */}
      <header style={{ padding: "16px 20px 12px", borderBottom: "1px solid var(--border)" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 28 }}>🏛️</span>
          Okrągły Stół
        </h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
          Twoi mentorzy debatują nad Twoim pytaniem
        </p>
      </header>

      {/* Input section */}
      {(phase === "idle" || phase === "error") && (
        <div style={{ padding: 20 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Opisz swój problem lub pytanie... np. 'Jak pogodzić trening z pracą zdalną?'"
            rows={4}
            style={{
              width: "100%",
              padding: 14,
              fontSize: 15,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--card)",
              resize: "vertical",
              fontFamily: "inherit",
              lineHeight: 1.5,
              outline: "none",
              boxSizing: "border-box",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--primary)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          />
          {errorMsg && (
            <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "#fef2f2", color: "var(--danger)", fontSize: 13 }}>
              {errorMsg}
            </div>
          )}
          <button
            onClick={startDebate}
            disabled={!input.trim()}
            style={{
              marginTop: 12,
              width: "100%",
              padding: "14px 0",
              fontSize: 16,
              fontWeight: 600,
              borderRadius: 12,
              border: "none",
              cursor: input.trim() ? "pointer" : "not-allowed",
              background: input.trim() ? "var(--primary)" : "var(--border)",
              color: input.trim() ? "#fff" : "var(--muted)",
              transition: "background 150ms ease",
            }}
          >
            Rozpocznij debatę
          </button>
        </div>
      )}

      {/* Debate feed */}
      {phase !== "idle" && phase !== "error" && (
        <div
          ref={feedRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 16px 120px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* User question card */}
          <div style={{
            padding: 14,
            borderRadius: 12,
            background: "var(--primary)",
            color: "#fff",
            fontSize: 14,
            lineHeight: 1.5,
          }}>
            <div style={{ fontSize: 11, opacity: 0.8, marginBottom: 4, fontWeight: 600 }}>Twoje pytanie</div>
            {input}
          </div>

          {/* Mentor responses */}
          {events.map((event, idx) => {
            if (event.type === "mentor_response") {
              return (
                <div
                  key={idx}
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    background: "var(--card)",
                    boxShadow: "var(--card-shadow)",
                    animation: "fadeInUp 300ms ease both",
                    animationDelay: `${idx * 50}ms`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 28 }}>{event.avatarEmoji}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{event.mentorName}</div>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--foreground)" }}>
                    {event.content}
                  </p>
                </div>
              );
            }

            if (event.type === "cross_comment") {
              return (
                <div
                  key={idx}
                  style={{
                    marginLeft: 24,
                    padding: 12,
                    borderRadius: 12,
                    background: "var(--card)",
                    boxShadow: "var(--card-shadow)",
                    borderLeft: "3px solid var(--primary)",
                    animation: "fadeInUp 300ms ease both",
                    animationDelay: `${idx * 50}ms`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 24 }}>{event.avatarEmoji}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{event.mentorName}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        odpowiada na {event.replyingTo}
                      </div>
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--foreground)" }}>
                    {event.content}
                  </p>
                </div>
              );
            }

            if (event.type === "consensus") {
              return (
                <div
                  key={idx}
                  style={{
                    marginTop: 8,
                    padding: 16,
                    borderRadius: 14,
                    background: "linear-gradient(135deg, #fefce8, #fef9c3)",
                    border: "2px solid #f59e0b",
                    animation: "fadeInUp 400ms ease both",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 24 }}>⭐</span>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#92400e" }}>
                      Konsensus Okrągłego Stołu
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "#78350f", whiteSpace: "pre-wrap" }}>
                    {event.content}
                  </p>
                </div>
              );
            }

            if (event.type === "done") {
              return null;
            }

            return null;
          })}

          {/* Thinking indicators */}
          {thinkingMentors.map((m) => (
            <div
              key={`thinking-${m.mentorId}`}
              style={{
                padding: 14,
                borderRadius: 12,
                background: "var(--card)",
                boxShadow: "var(--card-shadow)",
                opacity: 0.7,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 28 }}>{m.avatarEmoji}</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{m.mentorName}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    <span style={{ animation: "pulse 1.4s ease-in-out infinite" }}>myśli</span>
                    <span style={{ animation: "pulse 1.4s ease-in-out 0.2s infinite" }}>.</span>
                    <span style={{ animation: "pulse 1.4s ease-in-out 0.4s infinite" }}>.</span>
                    <span style={{ animation: "pulse 1.4s ease-in-out 0.6s infinite" }}>.</span>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Active debate indicator */}
          {isActive && thinkingMentors.length === 0 && phase === "debating" && (
            <div style={{ textAlign: "center", padding: 12, color: "var(--muted)", fontSize: 13 }}>
              <span style={{ animation: "pulse 1.4s ease-in-out infinite" }}>Mentorzy dyskutują...</span>
            </div>
          )}
        </div>
      )}

      {/* Bottom bar for done state */}
      {(phase === "done" || phase === "consensus") && (
        <div style={{
          position: "fixed",
          bottom: 80,
          left: 0,
          right: 0,
          padding: "12px 20px",
          display: "flex",
          justifyContent: "center",
        }}>
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

      {/* CSS animation */}
      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
