"use client";

import { useEffect, useRef, useCallback } from "react";
import { useStreamingChat } from "@/hooks/useStreamingChat";
import type { MentorData } from "./MentorCard";

interface MentorChatProps {
  mentor: MentorData;
  onClose: () => void;
}

export function MentorChat({ mentor, onClose }: MentorChatProps) {
  const { messages, sendMessage, isStreaming, error, clearMessages, stopStreaming } =
    useStreamingChat();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset messages when mentor changes
  useEffect(() => {
    clearMessages();
  }, [mentor.id, clearMessages]);

  // Auto-scroll to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      sendMessage("/api/chat", { mentorId: mentor.id, message: trimmed });
    },
    [isStreaming, mentor.id, sendMessage]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e.currentTarget.value);
      e.currentTarget.value = "";
    }
  };

  const handleSendClick = () => {
    const input = inputRef.current;
    if (!input) return;
    handleSend(input.value);
    input.value = "";
  };

  const formatTime = () => {
    const now = new Date();
    return now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
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

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          top: 0,
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
            gap: 12,
            padding: "12px 16px",
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
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--foreground)" }}>
              {mentor.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{mentor.role}</div>
          </div>
        </div>

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
          {messages.length === 0 && (
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
              <div style={{ fontWeight: 500 }}>{mentor.name}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                Zapytaj mnie o cokolwiek z zakresu: {mentor.role}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
                {msg.role === "assistant" && (
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
                    borderRadius: msg.role === "user" ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background: msg.role === "user" ? "var(--primary)" : "var(--card)",
                    color: msg.role === "user" ? "#fff" : "var(--foreground)",
                    fontSize: 14,
                    lineHeight: 1.5,
                    boxShadow: msg.role === "assistant" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                    border: msg.role === "assistant" ? "1px solid var(--border)" : "none",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.content}
                  {/* Streaming cursor */}
                  {msg.role === "assistant" && i === messages.length - 1 && isStreaming && (
                    <span
                      style={{
                        display: "inline-block",
                        width: 5,
                        height: 14,
                        background: "var(--primary)",
                        borderRadius: 1,
                        animation: "pulse 1s ease-in-out infinite",
                        marginLeft: 2,
                        verticalAlign: "text-bottom",
                      }}
                    />
                  )}
                </div>
              </div>

              <div
                style={{
                  fontSize: 10,
                  color: "var(--muted)",
                  marginTop: 2,
                  paddingLeft: msg.role === "assistant" ? 34 : 0,
                  paddingRight: msg.role === "user" ? 0 : 0,
                }}
              >
                {formatTime()}
              </div>
            </div>
          ))}

          {/* Error */}
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
            padding: "10px 16px",
            paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
            borderTop: "1px solid var(--border)",
            background: "var(--card)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <input
            ref={inputRef}
            type="text"
            placeholder="Napisz wiadomość..."
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 20,
              border: "1px solid var(--border)",
              background: "var(--background)",
              fontSize: 14,
              color: "var(--foreground)",
              outline: "none",
            }}
          />

          {isStreaming ? (
            <button
              onClick={stopStreaming}
              style={{
                width: 36,
                height: 36,
                borderRadius: 9999,
                background: "#ef4444",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
              aria-label="Zatrzymaj"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSendClick}
              style={{
                width: 36,
                height: 36,
                borderRadius: 9999,
                background: "var(--primary)",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
              aria-label="Wyślij"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Animations */}
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
