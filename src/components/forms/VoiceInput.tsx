"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";

const DEVICE_STORAGE_KEY = "papicoach.audioInputDeviceId";

interface VoiceInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  style?: React.CSSProperties;
  autoFocus?: boolean;
  onSubmit?: () => void;
  submitOnEnter?: boolean;
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
  onSubmit,
  submitOnEnter = true,
}: VoiceInputProps) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [transcriptionResult, setTranscriptionResult] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [lowLevelWarning, setLowLevelWarning] = useState(false);
  const lowLevelStartRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load saved device on mount (set globally in admin/Ustawienia)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (saved) setDeviceId(saved);
  }, []);
  const lastBlobRef = useRef<Blob | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    currentLevel,
  } = useVoiceRecorder();

  useEffect(() => {
    if (!isRecording) {
      lowLevelStartRef.current = null;
      setLowLevelWarning(false);
      return;
    }
    if (currentLevel > 0.02) {
      lowLevelStartRef.current = null;
      setLowLevelWarning(false);
    } else if (lowLevelStartRef.current === null) {
      lowLevelStartRef.current = Date.now();
    } else if (Date.now() - lowLevelStartRef.current > 2000) {
      setLowLevelWarning(true);
    }
  }, [currentLevel, isRecording]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      if (transcriptionTimerRef.current) clearTimeout(transcriptionTimerRef.current);
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
      setTranscriptionResult(null);
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
        const cleaned = (transcribed ?? "").trim();
        console.log(`[VoiceInput] transcription received: "${cleaned}" (${cleaned.length} chars)`);
        if (!cleaned) {
          scheduleErrorClear("Whisper zwrócił pustą transkrypcję. Sprawdź F12 console.");
        } else {
          const current = valueRef.current;
          onChange(current + (current ? " " : "") + cleaned);
          setTranscriptionResult(cleaned);
          if (transcriptionTimerRef.current) clearTimeout(transcriptionTimerRef.current);
          transcriptionTimerRef.current = setTimeout(() => setTranscriptionResult(null), 6000);
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
      startRecording(deviceId ?? undefined);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    if (transcriptionResult) {
      setTranscriptionResult(null);
      if (transcriptionTimerRef.current) clearTimeout(transcriptionTimerRef.current);
    }
  };

  const handleSubmit = () => {
    if (!onSubmit) return;
    if (!value.trim() || busy || isRecording) return;
    setTranscriptionResult(null);
    if (transcriptionTimerRef.current) clearTimeout(transcriptionTimerRef.current);
    onSubmit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (submitOnEnter && onSubmit && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const busy = disabled || isTranscribing;
  const hasText = value.trim().length > 0;
  const showSendButton = !!onSubmit && hasText && !isRecording;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {/* Transcription preview banner */}
      {transcriptionResult && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginBottom: 8,
            padding: "8px 12px",
            background: "rgba(34, 197, 94, 0.08)",
            border: "1px solid rgba(34, 197, 94, 0.25)",
            borderRadius: 10,
            fontSize: 13,
            animation: "viFadeIn 220ms ease-out",
          }}
        >
          <span style={{ color: "var(--success, #22c55e)", flexShrink: 0, marginTop: 1 }}>✓</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, color: "var(--success, #22c55e)", fontSize: 12, marginBottom: 2 }}>
              Transkrypcja gotowa
            </div>
            <div
              style={{
                color: "var(--foreground)",
                opacity: 0.85,
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
            type="button"
            onClick={() => {
              setTranscriptionResult(null);
              if (transcriptionTimerRef.current) clearTimeout(transcriptionTimerRef.current);
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 2,
              color: "var(--muted)",
              fontSize: 16,
              flexShrink: 0,
              lineHeight: 1,
            }}
            aria-label="Zamknij"
          >
            ×
          </button>
        </div>
      )}

      <div style={{ position: "relative" }}>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
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
            padding: "10px 50px 10px 14px",
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

        {/* WhatsApp-style toggle: mic OR send button on right */}
        <button
          type="button"
          onClick={showSendButton ? handleSubmit : toggleRecording}
          disabled={busy}
          aria-label={
            showSendButton
              ? "Wyslij"
              : isRecording
                ? "Zatrzymaj nagrywanie"
                : "Nagraj glos"
          }
          title={
            showSendButton
              ? "Wyslij"
              : isRecording
                ? "Zatrzymaj nagrywanie"
                : "Nagraj glos"
          }
          style={{
            position: "absolute",
            top: "50%",
            right: 6,
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "none",
            cursor: busy ? "not-allowed" : "pointer",
            background: isRecording
              ? "var(--danger)"
              : isTranscribing
                ? "var(--muted)"
                : "var(--primary)",
            color: "#fff",
            opacity: busy && !isRecording && !isTranscribing ? 0.6 : 1,
            transition: "background 200ms ease, opacity 200ms ease, transform 200ms ease",
            animation: isRecording ? "vi-pulse 1.5s ease-in-out infinite" : undefined,
            boxShadow: !isRecording && !isTranscribing ? "0 1px 3px rgba(0,0,0,0.18)" : "none",
          }}
        >
          {isTranscribing ? (
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                border: "2px solid #fff",
                borderTopColor: "transparent",
                animation: "vi-spin 0.8s linear infinite",
              }}
            />
          ) : showSendButton ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          ) : (
            <span
              style={{
                fontSize: 16,
                filter: "brightness(0) invert(1)",
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
              animation: "vi-pulse 1.5s ease-in-out infinite",
            }}
          />
          Nagrywam...
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatDuration(duration)}
          </span>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 16 }} title={`Poziom: ${Math.round(currentLevel * 100)}%`}>
            {[0, 1, 2, 3, 4].map((i) => {
              const threshold = (i + 1) / 5;
              const active = currentLevel >= threshold * 0.9;
              return (
                <span
                  key={i}
                  style={{
                    display: "block",
                    width: 4,
                    borderRadius: 1.5,
                    background: active ? "var(--success, #22c55e)" : "var(--border)",
                    height: `${4 + i * 3}px`,
                    transition: "background 80ms ease",
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {lowLevelWarning && isRecording && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 10px",
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--danger)",
            fontWeight: 500,
          }}
        >
          ⚠️ Mikrofon nie wykrywa dźwięku. Sprawdź wybór urządzenia (⚙).
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
              animation: "vi-pulse 1s ease-in-out infinite",
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
        @keyframes vi-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
        @keyframes vi-wave {
          from { height: 4px; }
          to { height: 14px; }
        }
        @keyframes viFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
