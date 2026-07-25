"use client";

import { useState } from "react";
import VoiceInput from "@/components/forms/VoiceInput";
import { haptic } from "@/lib/haptics";

export interface FollowUpData {
  /** Activity the answer belongs to — required to save it. */
  activityId?: string;
  mentorId: string;
  mentorName: string;
  mentorEmoji: string | null;
  activityName: string;
  prompt: string;
}

export interface FollowUpResult {
  reply: string | null;
  error?: string | null;
  savedTrainingLog?: boolean;
}

interface FollowUpSheetProps {
  data: FollowUpData;
  /** Resolves with the mentor's answer, which stays on screen. */
  onSubmit: (mentorId: string, message: string) => Promise<FollowUpResult>;
  onDismiss: () => void;
}

export function FollowUpSheet({ data, onSubmit, onDismiss }: FollowUpSheetProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<FollowUpResult | null>(null);
  const [sentText, setSentText] = useState("");

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    haptic.impact();
    setSending(true);
    try {
      const res = await onSubmit(data.mentorId, trimmed);
      setSentText(trimmed);
      setResult(res);
    } catch {
      setSentText(trimmed);
      setResult({ reply: null, error: "Nie udało się wysłać. Spróbuj ponownie." });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 200,
        animation: "slideUp 300ms cubic-bezier(0.25, 1, 0.5, 1)",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onDismiss}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.3)",
          zIndex: -1,
        }}
      />

      <div
        style={{
          maxWidth: 430,
          margin: "0 auto",
          background: "var(--card)",
          borderRadius: "20px 20px 0 0",
          padding: "20px 16px",
          paddingBottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
          boxShadow: "0 -4px 20px rgba(0,0,0,0.1)",
        }}
      >
        {/* Handle */}
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: "var(--border)",
            margin: "0 auto 16px",
          }}
        />

        {/* Mentor header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 28 }}>{data.mentorEmoji ?? "\u{1F9D1}\u{200D}\u{1F3EB}"}</span>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, color: "var(--text)" }}>
              {data.mentorName}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>Follow-up</div>
          </div>
          <button
            onClick={() => {
              haptic.tap();
              onDismiss();
            }}
            aria-label="Zamknij"
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              flexShrink: 0,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 24,
              lineHeight: 1,
              color: "var(--text-3)",
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Prompt message */}
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 14,
            background: "var(--surface-2)",
            fontSize: 15,
            color: "var(--text)",
            lineHeight: 1.5,
            marginBottom: 12,
          }}
        >
          {data.prompt}
        </div>

        {result === null ? (
          <>
            {/* Input */}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <VoiceInput
                  value={text}
                  onChange={setText}
                  placeholder="Opisz jak poszlo..."
                  autoFocus
                />
              </div>
              <button
                onClick={handleSend}
                disabled={!text.trim() || sending}
                style={{
                  padding: "0 18px",
                  minHeight: 48,
                  flexShrink: 0,
                  borderRadius: 9999,
                  border: "none",
                  background: text.trim() && !sending ? "var(--primary)" : "var(--border)",
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: text.trim() && !sending ? "pointer" : "not-allowed",
                  transition: "background 150ms ease",
                }}
              >
                {sending ? "..." : "Wyslij"}
              </button>
            </div>
            {sending && (
              <div style={{ marginTop: 10, fontSize: 14, color: "var(--text-3)" }}>
                {data.mentorName} czyta i odpowiada…
              </div>
            )}
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* What the user sent */}
            <div
              style={{
                alignSelf: "flex-end",
                maxWidth: "85%",
                padding: "10px 14px",
                borderRadius: 14,
                background: "var(--primary)",
                color: "#fff",
                fontSize: 15,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {sentText}
            </div>

            {/* Mentor answer — used to be discarded */}
            {result.reply ? (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "var(--surface-2)",
                  fontSize: 15,
                  color: "var(--text)",
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  maxHeight: 260,
                  overflowY: "auto",
                }}
              >
                {result.reply}
              </div>
            ) : (
              <div style={{ fontSize: 14, color: "var(--text-3)", lineHeight: 1.5 }}>
                {result.error ??
                  "Mentor nie odpowiedział, ale Twój opis został zapisany w historii treningów."}
              </div>
            )}

            {result.savedTrainingLog && (
              <div style={{ fontSize: 13, color: "var(--text-3)" }}>
                Zapisano w historii treningów.
              </div>
            )}

            <button
              onClick={() => {
                haptic.tap();
                onDismiss();
              }}
              style={{
                padding: "0 18px",
                minHeight: 48,
                borderRadius: 9999,
                border: "none",
                background: "var(--primary)",
                color: "#fff",
                fontSize: 15,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Zamknij
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
