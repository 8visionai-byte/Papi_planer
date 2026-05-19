"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import VoiceTextarea from "@/components/forms/VoiceTextarea";

export interface MentorForChat {
  id: string;
  name: string;
  role: string;
  avatarEmoji: string | null;
}

interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

interface MentorChatProps {
  mentor: MentorForChat;
  onClose: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pl-PL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

export function MentorChat({ mentor, onClose }: MentorChatProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  // Load conversation list on mount
  const refreshConversations = useCallback(async () => {
    setLoadingConvs(true);
    try {
      const res = await fetch(
        `/api/mentor-chat/conversations?mentorId=${encodeURIComponent(mentor.id)}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setConversations(data);
    } catch (err) {
      const m = err instanceof Error ? err.message : "Błąd ładowania historii";
      setError(m);
    } finally {
      setLoadingConvs(false);
    }
  }, [mentor.id]);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // Load messages for active conversation
  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    fetch(`/api/mentor-chat/conversations/${activeConvId}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setMessages(data.messages || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Błąd ładowania rozmowy");
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeConvId]);

  const startNewChat = () => {
    setActiveConvId(null);
    setMessages([]);
    setShowHistory(false);
    setError(null);
  };

  const openConversation = (id: string) => {
    setActiveConvId(id);
    setShowHistory(false);
    setError(null);
  };

  const deleteConversation = async (id: string) => {
    if (!confirm("Usunąć tę rozmowę?")) return;
    try {
      const res = await fetch(`/api/mentor-chat/conversations/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      if (activeConvId === id) {
        setActiveConvId(null);
        setMessages([]);
      }
      await refreshConversations();
    } catch (err) {
      const m = err instanceof Error ? err.message : "Błąd usuwania";
      setError(m);
    }
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);

    // Optimistic user message
    const optimisticUser: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setDraft("");

    try {
      if (!activeConvId) {
        // Create new conversation
        const res = await fetch("/api/mentor-chat/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mentorId: mentor.id, firstMessage: text }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setActiveConvId(data.conversation.id);
        setMessages(data.messages || []);
        await refreshConversations();
      } else {
        // Append to existing
        const res = await fetch(
          `/api/mentor-chat/conversations/${activeConvId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: text }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setMessages((prev) => {
          // Replace optimistic with real, append assistant
          const filtered = prev.filter((m) => m.id !== optimisticUser.id);
          return [...filtered, data.userMessage, data.assistantMessage];
        });
        await refreshConversations();
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : "Błąd wysyłania";
      setError(m);
      // Rollback optimistic
      setMessages((prev) => prev.filter((msg) => msg.id !== optimisticUser.id));
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 999,
          animation: "fadeIn 200ms ease",
        }}
        onClick={onClose}
      />

      {/* Modal panel */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          background: "var(--background)",
          animation: "slideUp 300ms cubic-bezier(0.32,0.72,0,1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 14px",
            paddingTop: "calc(12px + env(safe-area-inset-top, 0px))",
            borderBottom: "1px solid var(--border)",
            background: "var(--card)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--foreground)",
            }}
            aria-label="Zamknij"
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
          </button>

          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 9999,
              background: "var(--primary-light, rgba(59,130,246,0.1))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            {mentor.avatarEmoji || "🧑‍🏫"}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--foreground)",
                lineHeight: 1.2,
              }}
            >
              {mentor.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.3 }}>
              {mentor.role}
            </div>
          </div>

          <button
            onClick={startNewChat}
            title="Nowy czat"
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1.5px solid var(--border)",
              background: "var(--background)",
              color: "var(--foreground)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ＋ Nowy
          </button>

          <button
            onClick={() => setShowHistory((v) => !v)}
            title="Historia czatów"
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1.5px solid var(--border)",
              background: showHistory ? "var(--primary)" : "var(--background)",
              color: showHistory ? "#fff" : "var(--foreground)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            🕓 Historia
          </button>
        </div>

        {/* History dropdown */}
        {showHistory && (
          <div
            style={{
              maxHeight: "40vh",
              overflowY: "auto",
              borderBottom: "1px solid var(--border)",
              background: "var(--card)",
              padding: "8px 12px",
            }}
          >
            {loadingConvs && (
              <div style={{ color: "var(--muted)", fontSize: 13, padding: 8 }}>
                Ładuję historię…
              </div>
            )}
            {!loadingConvs && conversations.length === 0 && (
              <div style={{ color: "var(--muted)", fontSize: 13, padding: 8 }}>
                Brak poprzednich rozmów.
              </div>
            )}
            {!loadingConvs &&
              conversations.map((c) => (
                <div
                  key={c.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    marginBottom: 4,
                    background:
                      c.id === activeConvId
                        ? "var(--primary-light, rgba(59,130,246,0.10))"
                        : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <div
                    onClick={() => openConversation(c.id)}
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: "var(--foreground)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.title || "Bez tytułu"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {formatDate(c.updatedAt)} · {c.messageCount} wiad.
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(c.id);
                    }}
                    aria-label="Usuń rozmowę"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--danger)",
                      cursor: "pointer",
                      fontSize: 14,
                      padding: 4,
                    }}
                  >
                    🗑
                  </button>
                </div>
              ))}
          </div>
        )}

        {/* Messages area */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {loadingMessages && (
            <div
              style={{
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 13,
                marginTop: 24,
              }}
            >
              Ładuję rozmowę…
            </div>
          )}

          {!loadingMessages && messages.length === 0 && !sending && (
            <div
              style={{
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 14,
                marginTop: 40,
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 12 }}>
                {mentor.avatarEmoji || "🧑‍🏫"}
              </div>
              <div style={{ fontWeight: 500, color: "var(--foreground)" }}>
                {mentor.name}
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                Zapytaj mnie o cokolwiek z zakresu: {mentor.role}
              </div>
            </div>
          )}

          {messages.map((msg) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={msg.id}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isUser ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  alignSelf: isUser ? "flex-end" : "flex-start",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
                  {!isUser && (
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 9999,
                        background: "var(--primary-light, rgba(59,130,246,0.1))",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        flexShrink: 0,
                      }}
                    >
                      {mentor.avatarEmoji || "🧑‍🏫"}
                    </div>
                  )}

                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: isUser
                        ? "16px 16px 4px 16px"
                        : "16px 16px 16px 4px",
                      background: isUser ? "var(--primary)" : "var(--card)",
                      color: isUser ? "#fff" : "var(--foreground)",
                      fontSize: 14,
                      lineHeight: 1.5,
                      boxShadow: !isUser ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                      border: !isUser ? "1px solid var(--border)" : "none",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--muted)",
                    marginTop: 2,
                    paddingLeft: !isUser ? 34 : 0,
                  }}
                >
                  {formatTime(msg.createdAt)}
                </div>
              </div>
            );
          })}

          {/* Typing indicator */}
          {sending && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                alignSelf: "flex-start",
                color: "var(--muted)",
                fontSize: 13,
                padding: "4px 0 4px 34px",
              }}
            >
              <span>{mentor.name} pisze</span>
              <span
                style={{
                  display: "inline-block",
                  width: 4,
                  height: 4,
                  borderRadius: 9999,
                  background: "var(--muted)",
                  animation: "pulse 1s ease-in-out infinite",
                }}
              />
              <span
                style={{
                  display: "inline-block",
                  width: 4,
                  height: 4,
                  borderRadius: 9999,
                  background: "var(--muted)",
                  animation: "pulse 1s ease-in-out 0.2s infinite",
                }}
              />
              <span
                style={{
                  display: "inline-block",
                  width: 4,
                  height: 4,
                  borderRadius: 9999,
                  background: "var(--muted)",
                  animation: "pulse 1s ease-in-out 0.4s infinite",
                }}
              />
            </div>
          )}

          {error && (
            <div
              style={{
                textAlign: "center",
                color: "#ef4444",
                fontSize: 13,
                padding: "8px 12px",
                background: "rgba(239,68,68,0.08)",
                borderRadius: 8,
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Input area */}
        <div
          style={{
            padding: "10px 14px",
            paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
            borderTop: "1px solid var(--border)",
            background: "var(--card)",
            display: "flex",
            alignItems: "flex-end",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1 }}>
            <VoiceTextarea
              value={draft}
              onChange={setDraft}
              placeholder="Napisz wiadomość lub nagraj głos…"
              minHeight={44}
              disabled={sending}
              onSubmit={sendMessage}
              submitOnEnter
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={sending || !draft.trim()}
            style={{
              width: 44,
              height: 44,
              borderRadius: 9999,
              background:
                sending || !draft.trim() ? "var(--border)" : "var(--primary)",
              border: "none",
              cursor: sending || !draft.trim() ? "default" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            aria-label="Wyślij"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0.8; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </>
  );
}
