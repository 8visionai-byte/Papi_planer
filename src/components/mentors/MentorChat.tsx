"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import { haptic } from "@/lib/haptics";
import { Button, EmptyState, Pressable, Skeleton, T, TYPO } from "@/components/ui";

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

/** Stagger for the three typing dots. */
const MOTION_DELAYS = ["0ms", "160ms", "320ms"];

/* ---------- interface icons: SVG, stroke 1.75, round caps ---------- */

function Icon({ children, size = 22 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  );
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
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
    haptic.tap();
    setActiveConvId(null);
    setMessages([]);
    setShowHistory(false);
    setError(null);
  };

  const openConversation = (id: string) => {
    haptic.selection();
    setActiveConvId(id);
    setShowHistory(false);
    setError(null);
  };

  const deleteConversation = async (id: string) => {
    setConfirmDeleteId(null);
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
      haptic.success();
      await refreshConversations();
    } catch (err) {
      const m = err instanceof Error ? err.message : "Błąd usuwania";
      haptic.error();
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
    // Confirm the send the moment the user taps, not when the mentor answers.
    haptic.tap();

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
      haptic.error();
      setError(m);
      // Rollback optimistic
      setMessages((prev) => prev.filter((msg) => msg.id !== optimisticUser.id));
      setDraft(text);
    } finally {
      setSending(false);
    }
  };

  const canSend = Boolean(draft.trim()) && !sending;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: T.overlay,
          zIndex: 999,
          animation: "fadeIn 200ms linear",
        }}
        onClick={onClose}
      />

      {/* Full-screen panel */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          background: T.bg,
          animation: "sheet-up var(--dur-slow) var(--ease-ios)",
        }}
      >
        {/* ---- Header ---- */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: T.sp2,
            padding: `${T.sp2} ${T.sp3}`,
            paddingTop: `calc(${T.sp2} + ${T.safeT})`,
            borderBottom: `1px solid ${T.border}`,
            background: T.bgElevated,
            flexShrink: 0,
          }}
        >
          <Pressable onPress={onClose} ariaLabel="Zamknij czat" style={{ color: T.text }}>
            <Icon size={24}>
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </Icon>
          </Pressable>

          <div
            className="glow-soft"
            style={{
              width: 44,
              height: 44,
              borderRadius: T.rFull,
              background: T.primarySoft,
              border: `1px solid ${T.borderAccent}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            {mentor.avatarEmoji || "🧑‍🏫"}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                ...TYPO.title3,
                color: T.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {mentor.name}
            </div>
            <div
              style={{
                ...TYPO.footnote,
                color: T.text3,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {mentor.role}
            </div>
          </div>

          <Pressable onPress={startNewChat} ariaLabel="Nowy czat" title="Nowy czat" style={{ color: T.text2 }}>
            <Icon>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
            </Icon>
          </Pressable>

          <Pressable
            onPress={() => {
              haptic.tap();
              setShowHistory((v) => !v);
            }}
            ariaLabel="Historia czatów"
            ariaExpanded={showHistory}
            title="Historia czatów"
            style={{
              color: showHistory ? T.primaryOnSurface : T.text2,
              background: showHistory ? T.primarySoft : "transparent",
              borderRadius: T.rMd,
            }}
          >
            <Icon>
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15.5 14" />
            </Icon>
          </Pressable>
        </div>

        {/* ---- History drawer ---- */}
        {showHistory && (
          <div
            className="reveal"
            style={{
              maxHeight: "44vh",
              overflowY: "auto",
              overscrollBehavior: "contain",
              borderBottom: `1px solid ${T.border}`,
              background: T.surface,
              padding: `${T.sp2} ${T.sp3}`,
              flexShrink: 0,
            }}
          >
            {loadingConvs && (
              <div style={{ display: "flex", flexDirection: "column", gap: T.sp2, padding: T.sp2 }}>
                <Skeleton variant="line" width="70%" height={16} />
                <Skeleton variant="line" width="50%" height={14} />
              </div>
            )}

            {!loadingConvs && conversations.length === 0 && (
              <div style={{ ...TYPO.callout, color: T.text3, padding: T.sp3 }}>
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
                    gap: T.sp2,
                    borderRadius: T.rMd,
                    marginBottom: T.sp1,
                    background: c.id === activeConvId ? T.primarySoft : "transparent",
                  }}
                >
                  <Pressable
                    onPress={() => openConversation(c.id)}
                    noMinSize
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: "block",
                      textAlign: "left",
                      minHeight: T.tapMin,
                      padding: `${T.sp2} ${T.sp3}`,
                      borderRadius: T.rMd,
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        ...TYPO.footnote,
                        fontWeight: 700,
                        color: c.id === activeConvId ? T.primaryOnSurface : T.text,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.title || "Bez tytułu"}
                    </span>
                    <span
                      style={{ display: "block", fontSize: 12, color: T.text3, marginTop: 2 }}
                    >
                      {formatDate(c.updatedAt)} · {c.messageCount} wiad.
                    </span>
                  </Pressable>

                  {confirmDeleteId === c.id ? (
                    <div style={{ display: "flex", gap: T.sp1, flexShrink: 0, paddingRight: T.sp1 }}>
                      <Pressable
                        onPress={() => deleteConversation(c.id)}
                        ariaLabel="Potwierdź usunięcie"
                        haptic="warning"
                        style={{
                          minWidth: T.tapMin,
                          height: T.tapMin,
                          borderRadius: T.rMd,
                          background: T.dangerSoft,
                          color: T.dangerOnSurface,
                          border: `1px solid ${T.danger}`,
                          ...TYPO.footnote,
                          fontWeight: 700,
                          padding: `0 ${T.sp2}`,
                        }}
                      >
                        Usuń
                      </Pressable>
                      <Pressable
                        onPress={() => setConfirmDeleteId(null)}
                        ariaLabel="Anuluj usuwanie"
                        style={{ color: T.text3 }}
                      >
                        <Icon size={18}>
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </Icon>
                      </Pressable>
                    </div>
                  ) : (
                    <Pressable
                      onPress={() => {
                        haptic.warning();
                        setConfirmDeleteId(c.id);
                      }}
                      ariaLabel="Usuń rozmowę"
                      style={{ color: T.text3, flexShrink: 0 }}
                    >
                      <Icon size={18}>
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </Icon>
                    </Pressable>
                  )}
                </div>
              ))}
          </div>
        )}

        {/* ---- Messages ---- */}
        <div
          ref={scrollRef}
          className="papi-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            padding: `${T.sp4} ${T.gutter}`,
            display: "flex",
            flexDirection: "column",
            gap: T.sp3,
          }}
        >
          {loadingMessages && (
            <div style={{ display: "flex", flexDirection: "column", gap: T.sp3, marginTop: T.sp4 }}>
              <Skeleton variant="line" width="60%" height={44} radius={18} />
              <Skeleton variant="line" width="80%" height={64} radius={18} />
            </div>
          )}

          {!loadingMessages && messages.length === 0 && !sending && (
            <EmptyState
              icon={mentor.avatarEmoji || "🧑‍🏫"}
              title={mentor.name}
              body={`Zapytaj o cokolwiek z zakresu: ${mentor.role}`}
              style={{ marginTop: T.sp8 }}
            />
          )}

          {messages.map((msg) => {
            const isUser = msg.role === "user";
            return (
              <div
                key={msg.id}
                className="anim-in-fast"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isUser ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  alignSelf: isUser ? "flex-end" : "flex-start",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-end", gap: T.sp2 }}>
                  {!isUser && (
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: T.rFull,
                        background: T.primarySoft,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 16,
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      {mentor.avatarEmoji || "🧑‍🏫"}
                    </div>
                  )}

                  <div
                    style={{
                      padding: `${T.sp3} ${T.sp4}`,
                      borderRadius: isUser ? "20px 20px 6px 20px" : "20px 20px 20px 6px",
                      background: isUser ? T.primary : T.surface,
                      color: isUser ? T.primaryText : T.text,
                      ...TYPO.callout,
                      lineHeight: 1.55,
                      boxShadow: isUser ? T.glowAccentSoft : T.elev1,
                      border: isUser ? "none" : `1px solid ${T.border}`,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: T.text3,
                    marginTop: T.sp1,
                    paddingLeft: !isUser ? 38 : 0,
                    fontVariantNumeric: "tabular-nums",
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
              className="anim-in-fast"
              style={{
                display: "flex",
                alignItems: "center",
                gap: T.sp2,
                alignSelf: "flex-start",
                maxWidth: "88%",
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: T.rFull,
                  background: T.primarySoft,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                {mentor.avatarEmoji || "🧑‍🏫"}
              </div>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: `${T.sp3} ${T.sp4}`,
                  borderRadius: "20px 20px 20px 6px",
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  boxShadow: T.elev1,
                }}
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{
                      display: "inline-block",
                      width: 7,
                      height: 7,
                      borderRadius: T.rFull,
                      background: T.primaryOnSurface,
                      animation: `typingDot 1.2s ${MOTION_DELAYS[i]} var(--ease-standard) infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              style={{
                ...TYPO.footnote,
                textAlign: "center",
                color: T.dangerOnSurface,
                background: T.dangerSoft,
                border: `1px solid ${T.danger}`,
                padding: `${T.sp2} ${T.sp3}`,
                borderRadius: T.rMd,
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* ---- Composer ---- */}
        <div
          style={{
            padding: `${T.sp3} ${T.sp3}`,
            // Android shrinks the layout viewport for the keyboard (interactiveWidget:
            // "resizes-content"), so this panel is already above it and --kb stays 0.
            // iOS does not: --kb then carries the keyboard height and lifts the
            // composer by exactly that much. max() so the home indicator still wins
            // when no keyboard is open. See src/hooks/useKeyboardInset.ts.
            paddingBottom: `calc(${T.sp3} + max(${T.safeB}, var(--kb, 0px)))`,
            borderTop: `1px solid ${T.border}`,
            background: T.bgElevated,
            display: "flex",
            alignItems: "flex-end",
            gap: T.sp2,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
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
          <Button
            size="sm"
            variant={canSend ? "primary" : "secondary"}
            disabled={!canSend}
            haptic="impact"
            onPress={sendMessage}
            ariaLabel="Wyślij"
            style={{
              width: T.tapMin,
              minWidth: T.tapMin,
              padding: 0,
              borderRadius: T.rFull,
              flexShrink: 0,
            }}
          >
            <Icon size={20}>
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </Icon>
          </Button>
        </div>
      </div>

      <style>{`
        @keyframes typingDot {
          0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
          40%           { opacity: 1;    transform: translateY(-4px); }
        }
      `}</style>
    </>
  );
}
