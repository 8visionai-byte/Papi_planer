"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { haptic } from "@/lib/haptics";

const DEVICE_STORAGE_KEY = "papicoach.audioInputDeviceId";

interface VoiceTextareaProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minHeight?: number;
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

export default function VoiceTextarea({
  value,
  onChange,
  placeholder,
  minHeight = 100,
  disabled = false,
  style,
  autoFocus = false,
  onSubmit,
  submitOnEnter = false,
}: VoiceTextareaProps) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [transcriptionResult, setTranscriptionResult] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [lowLevelWarning, setLowLevelWarning] = useState(false);

  // Load saved device on mount (set globally in admin/Ustawienia)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (saved) setDeviceId(saved);
  }, []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastBlobRef = useRef<Blob | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);

  // Keep ref synced with latest value so transcribe callback uses fresh value
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

  // Detect persistent silence (level stuck at 0 for 2+ seconds during recording)
  const lowLevelStartRef = useRef<number | null>(null);
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
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      if (transcriptionTimerRef.current) clearTimeout(transcriptionTimerRef.current);
    };
  }, []);

  // Surface voice errors with 5s auto-clear
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
        console.log(`[VoiceTextarea] transcription received: "${cleaned}" (${cleaned.length} chars)`);
        if (!cleaned) {
          scheduleErrorClear("Whisper zwrócił pustą transkrypcję. Sprawdź F12 console.");
        } else {
          const current = valueRef.current;
          onChange(current + (current ? " " : "") + cleaned);
          setTranscriptionResult(cleaned);
          if (transcriptionTimerRef.current) clearTimeout(transcriptionTimerRef.current);
          transcriptionTimerRef.current = setTimeout(() => setTranscriptionResult(null), 6000);
          textareaRef.current?.focus();
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

  // Trigger transcription when a new blob arrives - after commit, never during
  // render. Mutating the ref and calling setState mid-render lets React 19 throw
  // the render away: the blob is already marked as handled while the
  // transcription never ran, silently eating a recording. The ref guard keeps
  // the "once per blob" behaviour even though transcribeAudio changes identity
  // whenever the parent passes a new onChange.
  useEffect(() => {
    if (!audioBlob || audioBlob === lastBlobRef.current) return;
    lastBlobRef.current = audioBlob;
    transcribeAudio(audioBlob);
  }, [audioBlob, transcribeAudio]);

  const toggleRecording = () => {
    // Firmer buzz - starting/stopping a recording is a committing action.
    haptic.impact();
    if (isRecording) {
      stopRecording();
    } else {
      startRecording(deviceId ?? undefined);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (submitOnEnter && onSubmit && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const busy = disabled || isTranscribing;
  const showRecordingIndicator = isRecording;
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
            background: "var(--success-soft)",
            border: "1px solid var(--success-soft)",
            borderRadius: 10,
            fontSize: 14,
            animation: "vtFadeIn 220ms ease-out",
          }}
        >
          <span style={{ color: "var(--success-on-surface)", flexShrink: 0, marginTop: 1 }}>✓</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, color: "var(--success-on-surface)", fontSize: 13, marginBottom: 2 }}>
              Transkrypcja gotowa
            </div>
            <div
              style={{
                color: "var(--text-2)",
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 3,
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
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              margin: "-12px -12px -12px 0",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              color: "var(--text-3)",
              fontSize: 22,
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
        <textarea
          ref={textareaRef}
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
            minHeight,
            // right padding clears the 44 px record button (44 + 8 right + 10 gap)
            padding: "12px 62px 12px 14px",
            borderRadius: 12,
            border: `1.5px solid ${isRecording ? "var(--danger)" : "var(--border)"}`,
            // form field sits one surface step above the page, never on --bg
            background: "var(--surface-2)",
            color: "var(--text)",
            fontSize: 16,
            fontFamily: "inherit",
            lineHeight: 1.5,
            outline: "none",
            resize: "vertical",
            transition: "border-color 150ms ease, box-shadow 150ms ease",
            boxShadow: isRecording ? "0 0 0 2px var(--danger-soft)" : "none",
            opacity: busy ? 0.7 : 1,
            ...style,
          }}
        />

        {/* WhatsApp-style toggle: mic OR send button, top-right corner */}
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
          className="pressable"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // touch floor: 44 px, never the old 36 px
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: "none",
            cursor: busy ? "not-allowed" : "pointer",
            background: isRecording
              ? "var(--danger)"
              : isTranscribing
                ? "var(--surface-3)"
                : "var(--primary)",
            // label ON the accent fill - white on cyan is 2.14:1 and is not allowed
            color: isTranscribing ? "var(--text-2)" : "var(--primary-text)",
            opacity: busy && !isRecording && !isTranscribing ? 0.6 : 1,
            transition: "background 200ms ease, opacity 200ms ease, transform 200ms ease",
            animation: isRecording ? "vt-pulse 1.5s ease-in-out infinite" : undefined,
            boxShadow: !isRecording && !isTranscribing ? "0 1px 3px rgba(0,0,0,0.18)" : "none",
          }}
        >
          {isTranscribing ? (
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: "2px solid currentColor",
                borderTopColor: "transparent",
                animation: "vt-spin 0.8s linear infinite",
              }}
            />
          ) : showSendButton ? (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          ) : isRecording ? (
            /* stop square - an interface glyph, so SVG and not an emoji */
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="2" />
            </svg>
          ) : (
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <line x1="12" y1="18" x2="12" y2="21" />
            </svg>
          )}
        </button>
      </div>

      {/* Recording indicator below textarea */}
      {showRecordingIndicator && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
            fontSize: 14,
            color: "var(--danger-on-surface)",
            fontWeight: 600,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--danger)",
              animation: "vt-pulse 1.5s ease-in-out infinite",
            }}
          />
          Nagrywam...
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatDuration(duration)}
          </span>
          {/* Live level meter: 5 bars filling based on currentLevel */}
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
                    background: active ? "var(--success)" : "var(--border)",
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
            marginTop: 8,
            padding: "8px 12px",
            background: "var(--danger-soft)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            fontSize: 14,
            lineHeight: 1.4,
            color: "var(--danger-on-surface)",
            fontWeight: 600,
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
            marginTop: 8,
            fontSize: 14,
            color: "var(--text-3)",
            fontWeight: 500,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--primary)",
              animation: "vt-pulse 1s ease-in-out infinite",
            }}
          />
          Transkrybuje nagranie...
        </div>
      )}

      {/* Error display */}
      {localError && (
        <div
          style={{
            marginTop: 8,
            fontSize: 14,
            lineHeight: 1.4,
            color: "var(--danger-on-surface)",
          }}
        >
          {localError}
        </div>
      )}

      <style>{`
        @keyframes vt-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes vt-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
        @keyframes vt-wave {
          from { height: 4px; }
          to { height: 14px; }
        }
        @keyframes vtFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
