"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";

interface VoiceInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  autoFocus?: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VoiceInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  style,
  autoFocus = false,
}: VoiceInputProps) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastBlobRef = useRef<Blob | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const {
    isRecording,
    startRecording,
    stopRecording,
    audioBlob,
    error: voiceError,
    duration,
  } = useVoiceRecorder();

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (voiceError) {
      setLocalError(voiceError);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setLocalError(null), 5000);
    }
  }, [voiceError]);

  const scheduleErrorClear = useCallback((msg: string) => {
    setLocalError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setLocalError(null), 5000);
  }, []);

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
          const err = await res
            .json()
            .catch(() => ({ error: "Transkrypcja nie powiodla sie" }));
          throw new Error(err.error || "Transkrypcja nie powiodla sie");
        }

        const { text: transcribed } = await res.json();
        if (transcribed) {
          const current = valueRef.current;
          onChange(current + (current ? " " : "") + transcribed);
          inputRef.current?.focus();
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Transkrypcja nie powiodla sie";
        scheduleErrorClear(msg);
      } finally {
        setIsTranscribing(false);
      }
    },
    [onChange, scheduleErrorClear]
  );

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

  const busy = disabled || isTranscribing;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            isTranscribing
              ? "Transkrybuje..."
              : isRecording
                ? "Nagrywam mowe..."
                : placeholder
          }
          disabled={busy || isRecording}
          style={{
            width: "100%",
            padding: "10px 44px 10px 14px",
            borderRadius: 12,
            border: `1px solid ${isRecording ? "var(--danger)" : "var(--border)"}`,
            background: "var(--background)",
            color: "var(--foreground)",
            fontSize: 14,
            fontFamily: "inherit",
            lineHeight: 1.4,
            outline: "none",
            transition: "border-color 150ms ease, box-shadow 150ms ease",
            boxShadow: isRecording ? "0 0 0 2px rgba(239, 68, 68, 0.15)" : "none",
            opacity: busy ? 0.7 : 1,
            ...style,
          }}
        />

        {/* Floating mic button (smaller for single-line) */}
        <button
          type="button"
          onClick={toggleRecording}
          disabled={busy}
          aria-label={isRecording ? "Zatrzymaj nagrywanie" : "Nagraj glos"}
          title={isRecording ? "Zatrzymaj nagrywanie" : "Nagraj glos"}
          style={{
            position: "absolute",
            top: "50%",
            right: 6,
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "none",
            cursor: busy ? "not-allowed" : "pointer",
            background: isRecording
              ? "var(--danger)"
              : isTranscribing
                ? "var(--muted)"
                : "var(--border)",
            opacity: busy && !isRecording && !isTranscribing ? 0.5 : 1,
            transition: "background 150ms ease, opacity 150ms ease",
            animation: isRecording ? "pulse 1.5s ease-in-out infinite" : undefined,
          }}
        >
          {isTranscribing ? (
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                border: "2px solid var(--background)",
                borderTopColor: "transparent",
                animation: "vi-spin 0.8s linear infinite",
              }}
            />
          ) : (
            <span
              style={{
                fontSize: 14,
                filter: isRecording ? "brightness(0) invert(1)" : "none",
                lineHeight: 1,
              }}
            >
              {isRecording ? "⏹️" : "🎙️"}
            </span>
          )}
        </button>
      </div>

      {/* Recording indicator */}
      {isRecording && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 6,
            fontSize: 12,
            color: "var(--danger)",
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--danger)",
              animation: "pulse 1.5s ease-in-out infinite",
            }}
          />
          Nagrywam...
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatDuration(duration)}
          </span>
        </div>
      )}

      {/* Transcribing indicator */}
      {isTranscribing && !isRecording && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 6,
            fontSize: 12,
            color: "var(--muted)",
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--primary)",
              animation: "pulse 1s ease-in-out infinite",
            }}
          />
          Transkrybuje nagranie...
        </div>
      )}

      {/* Error display */}
      {localError && (
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color: "var(--danger)",
          }}
        >
          {localError}
        </div>
      )}

      <style>{`
        @keyframes vi-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
