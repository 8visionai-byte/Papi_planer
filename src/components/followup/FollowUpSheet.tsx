"use client";

import { useState } from "react";
import VoiceInput from "@/components/forms/VoiceInput";

export interface FollowUpData {
  mentorId: string;
  mentorName: string;
  mentorEmoji: string | null;
  activityName: string;
  prompt: string;
}

interface FollowUpSheetProps {
  data: FollowUpData;
  onSubmit: (mentorId: string, message: string) => void;
  onDismiss: () => void;
}

export function FollowUpSheet({ data, onSubmit, onDismiss }: FollowUpSheetProps) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    onSubmit(data.mentorId, text.trim());
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
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--foreground)" }}>
              {data.mentorName}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Follow-up</div>
          </div>
          <button
            onClick={onDismiss}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 18,
              color: "var(--muted)",
              padding: 4,
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
            background: "var(--background)",
            fontSize: 14,
            color: "var(--foreground)",
            lineHeight: 1.5,
            marginBottom: 12,
          }}
        >
          {data.prompt}
        </div>

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
              padding: "10px 18px",
              borderRadius: 9999,
              border: "none",
              background: text.trim() && !sending ? "var(--primary)" : "var(--border)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: text.trim() && !sending ? "pointer" : "not-allowed",
              transition: "background 150ms ease",
            }}
          >
            {sending ? "..." : "Wyslij"}
          </button>
        </div>
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
