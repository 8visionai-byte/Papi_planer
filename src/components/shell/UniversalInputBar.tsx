"use client";

import { useState, useRef } from "react";

interface UniversalInputBarProps {
  onSubmit: (text: string) => void;
  onVoiceStart?: () => void;
  onVoiceStop?: () => void;
  isRecording?: boolean;
}

export function UniversalInputBar({
  onSubmit,
  onVoiceStart,
  onVoiceStop,
  isRecording = false,
}: UniversalInputBarProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      onVoiceStop?.();
    } else {
      onVoiceStart?.();
    }
  };

  return (
    <div
      style={{
        padding: "8px 16px 12px",
        background: "var(--card)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--background)",
          borderRadius: 9999,
          padding: "8px 12px",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          transition: "box-shadow 150ms ease",
        }}
      >
        {/* Mic button */}
        <button
          onClick={toggleRecording}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "none",
            cursor: "pointer",
            flexShrink: 0,
            background: isRecording ? "var(--danger)" : "transparent",
            transition: "background 150ms ease",
          }}
        >
          <span
            style={{
              fontSize: 18,
              filter: isRecording ? "brightness(0) invert(1)" : "none",
            }}
          >
            🎙️
          </span>
        </button>

        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Co słychać? Powiedz mi jak minął dzień..."
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 15,
            color: "var(--foreground)",
            fontFamily: "inherit",
          }}
        />

        {/* Submit button — visible when text entered */}
        {text.trim() && (
          <button
            onClick={handleSubmit}
            aria-label="Send"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "var(--primary)",
              border: "none",
              cursor: "pointer",
              flexShrink: 0,
              transition: "transform 150ms ease",
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        )}
      </div>

      {/* Recording indicator */}
      {isRecording && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            marginTop: 8,
            fontSize: 13,
            color: "var(--danger)",
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--danger)",
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
          Nagrywam...
        </div>
      )}
    </div>
  );
}
