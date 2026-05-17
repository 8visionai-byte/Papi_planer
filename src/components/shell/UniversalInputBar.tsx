"use client";

import { useState, useRef, useCallback, useEffect } from "react";
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
  const [transcriptionResult, setTranscriptionResult] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const transcriptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    isRecording,
    startRecording,
    stopRecording,
    audioBlob,
    error: voiceError,
    duration,
  } = useVoiceRecorder();

  useEffect(() => {
    return () => {
      if (transcriptionTimerRef.current) clearTimeout(transcriptionTimerRef.current);
    };
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isProcessing) return;
    onSubmit(trimmed);
    setText("");
    setTranscriptionResult(null);
    if (transcriptionTimerRef.current) {
      clearTimeout(transcriptionTimerRef.current);
      transcriptionTimerRef.current = null;
    }
    inputRef.current?.focus();
  }, [text, isProcessing, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const transcribeAudio = useCallback(async (blob: Blob) => {
    setIsTranscribing(true);
    setTranscriptionResult(null);
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
        setTranscriptionResult(transcribed);
        if (transcriptionTimerRef.current) clearTimeout(transcriptionTimerRef.current);
        transcriptionTimerRef.current = setTimeout(() => setTranscriptionResult(null), 8000);
        inputRef.current?.focus();
      }
    } catch (err) {
      console.error("Transcription error:", err);
    } finally {
      setIsTranscribing(false);
    }
  }, []);

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
        borderRadius: 16,
        boxShadow: "var(--card-shadow)",
      }}
    >
      {/* Transcription result banner */}
      {transcriptionResult && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginBottom: 8,
            padding: "8px 12px",
            background: "rgba(34, 197, 94, 0.08)",
            borderRadius: 10,
            fontSize: 13,
            animation: "transcriptionFadeIn 250ms ease-out",
          }}
        >
          <span style={{ color: "var(--success, #22c55e)", flexShrink: 0, marginTop: 1 }}>✓</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: "var(--success, #22c55e)", fontSize: 12, marginBottom: 2 }}>
              Transkrypcja gotowa
            </div>
            <div
              style={{
                color: "var(--foreground)",
                opacity: 0.8,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                lineHeight: 1.4,
              }}
            >
              {transcriptionResult}
            </div>
          </div>
          <button
            onClick={() => setTranscriptionResult(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 2,
              color: "var(--muted)",
              fontSize: 14,
              flexShrink: 0,
              lineHeight: 1,
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--background)",
          borderRadius: 9999,
          padding: "8px 8px 8px 14px",
          boxShadow: isRecording ? "0 0 0 2px var(--danger)" : "0 1px 4px rgba(0,0,0,0.06)",
          transition: "box-shadow 150ms ease",
        }}
      >
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
              ? "Transkrybuje..."
              : isProcessing
                ? "Przetwarzam..."
                : "Co slychac? Powiedz mi jak minal dzien..."
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

        {/* WhatsApp-style toggle: send button when text, mic otherwise — always right side */}
        {text.trim() && !isRecording ? (
          <button
            onClick={handleSubmit}
            disabled={busy}
            aria-label="Wyslij"
            title="Wyslij"
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
              transition: "transform 200ms ease, background 200ms ease",
              boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
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
              aria-hidden="true"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        ) : (
          <button
            onClick={toggleRecording}
            disabled={busy}
            aria-label={isRecording ? "Zatrzymaj nagrywanie" : "Nagraj glos"}
            title={isRecording ? "Zatrzymaj nagrywanie" : "Nagraj glos"}
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
              background: isRecording ? "var(--danger)" : "var(--primary)",
              color: "#fff",
              opacity: busy && !isRecording ? 0.6 : 1,
              transition: "background 200ms ease, opacity 200ms ease, transform 200ms ease",
              animation: isRecording ? "uib-pulse 1.5s ease-in-out infinite" : undefined,
              boxShadow: !isRecording ? "0 1px 3px rgba(0,0,0,0.18)" : "none",
            }}
          >
            <span
              style={{
                fontSize: 18,
                filter: "brightness(0) invert(1)",
                lineHeight: 1,
              }}
            >
              {isRecording ? "⏹️" : "🎙️"}
            </span>
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
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatDuration(duration)}</span>
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
          Transkrybuje nagranie...
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

      <style>{`
        @keyframes waveform {
          from { height: 4px; }
          to { height: 16px; }
        }
        @keyframes transcriptionFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes uib-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
      `}</style>
    </div>
  );
}
