"use client";

import { useState, useRef, useCallback } from "react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";

interface UniversalInputBarProps {
  onSubmit: (text: string) => void;
  isProcessing?: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function UniversalInputBar({
  onSubmit,
  isProcessing = false,
}: UniversalInputBarProps) {
  const [text, setText] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    isRecording,
    startRecording,
    stopRecording,
    audioBlob,
    error: voiceError,
    duration,
  } = useVoiceRecorder();

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isProcessing) return;
    onSubmit(trimmed);
    setText("");
    inputRef.current?.focus();
  }, [text, isProcessing, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Transcribe audio blob when recording stops
  const transcribeAudio = useCallback(
    async (blob: Blob) => {
      setIsTranscribing(true);
      try {
        const formData = new FormData();
        formData.append("audio", blob, "recording.webm");

        const res = await fetch("/api/voice/transcribe", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Transcription failed" }));
          throw new Error(err.error || "Transcription failed");
        }

        const { text: transcribed } = await res.json();
        if (transcribed) {
          setText((prev) => (prev ? `${prev} ${transcribed}` : transcribed));
          inputRef.current?.focus();
        }
      } catch (err) {
        console.error("Transcription error:", err);
      } finally {
        setIsTranscribing(false);
      }
    },
    []
  );

  // Watch for audioBlob changes (recording stopped)
  const lastBlobRef = useRef<Blob | null>(null);
  if (audioBlob && audioBlob !== lastBlobRef.current) {
    lastBlobRef.current = audioBlob;
    transcribeAudio(audioBlob);
  }

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const busy = isProcessing || isTranscribing;

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
          boxShadow: isRecording
            ? "0 0 0 2px var(--danger)"
            : "0 1px 4px rgba(0,0,0,0.06)",
          transition: "box-shadow 150ms ease",
        }}
      >
        {/* Mic button */}
        <button
          onClick={toggleRecording}
          disabled={busy}
          aria-label={isRecording ? "Stop recording" : "Start recording"}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "none",
            cursor: busy ? "not-allowed" : "pointer",
            flexShrink: 0,
            background: isRecording ? "var(--danger)" : "transparent",
            opacity: busy && !isRecording ? 0.5 : 1,
            transition: "background 150ms ease, opacity 150ms ease",
          }}
        >
          <span
            style={{
              fontSize: 18,
              filter: isRecording ? "brightness(0) invert(1)" : "none",
            }}
          >
            {isRecording ? "⏹️" : "🎙️"}
          </span>
        </button>

        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRecording}
          placeholder={
            isTranscribing
              ? "Transkrybuję..."
              : isProcessing
                ? "Przetwarzam..."
                : "Co słychać? Powiedz mi jak minął dzień..."
          }
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 15,
            color: "var(--foreground)",
            fontFamily: "inherit",
            opacity: isRecording ? 0.5 : 1,
          }}
        />

        {/* Submit button — visible when text entered */}
        {text.trim() && !isRecording && (
          <button
            onClick={handleSubmit}
            disabled={busy}
            aria-label="Send"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: busy ? "var(--muted)" : "var(--primary)",
              border: "none",
              cursor: busy ? "not-allowed" : "pointer",
              flexShrink: 0,
              transition: "transform 150ms ease, background 150ms ease",
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

      {/* Recording indicator with duration and waveform animation */}
      {isRecording && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
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
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatDuration(duration)}
          </span>
          {/* Simple waveform animation */}
          <div style={{ display: "flex", alignItems: "center", gap: 2, height: 16 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                style={{
                  display: "block",
                  width: 3,
                  borderRadius: 1.5,
                  background: "var(--danger)",
                  animation: `waveform 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
                  height: 6,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Transcribing indicator */}
      {isTranscribing && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            marginTop: 8,
            fontSize: 13,
            color: "var(--muted)",
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--primary)",
              animation: "pulse 1s ease-in-out infinite",
            }}
          />
          Transkrybuję nagranie...
        </div>
      )}

      {/* Voice error */}
      {voiceError && (
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color: "var(--danger)",
            textAlign: "center",
          }}
        >
          {voiceError}
        </div>
      )}

      {/* CSS animations via inline style tag */}
      <style>{`
        @keyframes waveform {
          from { height: 4px; }
          to { height: 16px; }
        }
      `}</style>
    </div>
  );
}
