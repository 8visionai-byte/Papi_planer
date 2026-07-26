"use client";

import { useState, useRef, useCallback, useEffect, memo } from "react";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { haptic } from "@/lib/haptics";

interface UniversalInputBarProps {
  onSubmit: (text: string) => void;
  isProcessing?: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Stroke icon, same geometry rule as the tab bar: 24px box, 1.9px line, round caps. */
function Glyph({ children, size = 20 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block" }}
    >
      {children}
    </svg>
  );
}

/**
 * Memoised at the export: this bar lives at the bottom of the dashboard, which
 * re-renders every minute (the clock), on every toast and on every habit tick.
 * Both props are stable (a useCallback and a boolean), so the recorder, the field
 * and the whole voice pipeline simply stop being re-rendered for other people's
 * state changes.
 */
function UniversalInputBarImpl({
  onSubmit,
  isProcessing = false,
}: UniversalInputBarProps) {
  const [text, setText] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionResult, setTranscriptionResult] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const transcriptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusScrollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      if (focusScrollRef.current) clearTimeout(focusScrollRef.current);
    };
  }, []);

  /**
   * Keeps the field above the soft keyboard.
   *
   * This bar sits at the very bottom of the dashboard's scrolling content, so on iOS
   * the keyboard lands right on top of it. `scrollMarginBottom` below reserves the
   * keyboard height (--kb, published by useKeyboardInsetVar), and this delayed
   * scrollIntoView runs AFTER the keyboard animation: scrolling while the keyboard is
   * still sliding in measures the old viewport and lands short.
   * On Android nothing is covered in the first place (interactiveWidget:
   * "resizes-content" shrinks the layout viewport) and this is a harmless no-op scroll.
   */
  const handleFocus = useCallback(() => {
    if (focusScrollRef.current) clearTimeout(focusScrollRef.current);
    focusScrollRef.current = setTimeout(() => {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 320);
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isProcessing) return;
    haptic.impact();
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

  /**
   * Start the transcription when the recorder hands over a new blob.
   *
   * This used to run DURING render (`if (audioBlob !== lastBlobRef.current) {...}`),
   * which fired a fetch and a setState from the render phase. React 19 is free to
   * render a component twice or throw a render away, so the upload could fire twice
   * or be lost, and the spinner state could end up out of sync with the request that
   * is actually in flight. An effect is the only place a side effect may live.
   */
  const lastBlobRef = useRef<Blob | null>(null);
  useEffect(() => {
    if (!audioBlob || audioBlob === lastBlobRef.current) return;
    lastBlobRef.current = audioBlob;
    transcribeAudio(audioBlob);
  }, [audioBlob, transcribeAudio]);

  const toggleRecording = () => {
    haptic.impact();
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const busy = isProcessing || isTranscribing;

  return (
    <div
      ref={rootRef}
      style={{
        padding: "8px 16px 12px",
        background: "var(--card)",
        borderRadius: 16,
        boxShadow: "var(--card-shadow)",
        // Room the browser must leave under this bar when it scrolls it into view.
        scrollMarginBottom: "calc(var(--kb, 0px) + 16px)",
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
            background: "var(--success-soft)",
            borderRadius: 10,
            fontSize: 14,
            animation: "transcriptionFadeIn 250ms ease-out",
          }}
        >
          <span
            style={{
              color: "var(--success-on-surface)",
              flexShrink: 0,
              marginTop: 1,
              display: "flex",
            }}
          >
            <Glyph size={16}>
              <polyline points="20 6 9 17 4 12" />
            </Glyph>
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                color: "var(--success-on-surface)",
                fontSize: 13,
                marginBottom: 2,
              }}
            >
              Transkrypcja gotowa
            </div>
            <div
              style={{
                color: "var(--text-2)",
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
            onClick={() => {
              haptic.tap();
              setTranscriptionResult(null);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              // 36px box pulled back by negative margins: the banner keeps its height,
              // the finger gets a real target instead of a 14px glyph.
              width: 44,
              height: 44,
              flexShrink: 0,
              margin: "-12px -12px -12px 0",
              background: "none",
              border: "none",
              borderRadius: "var(--r-sm)",
              cursor: "pointer",
              color: "var(--text-3)",
            }}
            aria-label="Zamknij"
          >
            <Glyph size={16}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </Glyph>
          </button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--background)",
          border: "1px solid var(--border)",
          borderRadius: 9999,
          padding: "8px 8px 8px 14px",
          boxShadow: isRecording
            ? "0 0 0 2px var(--danger)"
            : "var(--elev-1)",
          transition: "box-shadow 200ms var(--ease-out), border-color 200ms var(--ease-out)",
        }}
      >
        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          enterKeyHint="send"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
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
            // The row is ~60 px tall because of the 44 px button next to it, but the
            // field itself only claimed its 22 px of text. Tapping the empty band
            // above or below the caret did nothing. Costs no layout: the row is
            // already taller than this.
            minHeight: "var(--tap-min, 44px)",
            // 17px: below 16px iOS zooms the whole page the moment pinch-zoom is
            // re-enabled (ROADMAP P0-13). This field is now ready for that switch.
            fontSize: "var(--fs-body, 17px)",
            color: "var(--text)",
            fontFamily: "inherit",
            minWidth: 0,
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
              // 44px is the hard floor from --tap-min. It used to be 38px.
              width: "var(--tap-min, 44px)",
              height: "var(--tap-min, 44px)",
              borderRadius: "50%",
              background: busy ? "var(--surface-3)" : "var(--gradient-primary)",
              color: busy ? "var(--text-3)" : "var(--primary-text)",
              border: "none",
              cursor: busy ? "not-allowed" : "pointer",
              flexShrink: 0,
              transition: "background 200ms var(--ease-out), box-shadow 200ms var(--ease-out)",
              boxShadow: busy ? "none" : "var(--shadow-primary)",
            }}
          >
            <Glyph size={20}>
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </Glyph>
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
              width: "var(--tap-min, 44px)",
              height: "var(--tap-min, 44px)",
              borderRadius: "50%",
              border: "none",
              cursor: busy ? "not-allowed" : "pointer",
              flexShrink: 0,
              background: isRecording ? "var(--danger)" : "var(--gradient-primary)",
              // `filter: brightness(0) invert(1)` is gone: that hack existed only to
              // force an emoji white. A stroke icon simply inherits currentColor.
              color: isRecording ? "var(--text-inverse)" : "var(--primary-text)",
              opacity: busy && !isRecording ? 0.6 : 1,
              transition: "background 200ms var(--ease-out), opacity 200ms var(--ease-out)",
              animation: isRecording ? "uib-pulse 1.5s ease-in-out infinite" : undefined,
              boxShadow: !isRecording ? "var(--shadow-primary)" : "none",
            }}
          >
            {isRecording ? (
              <Glyph size={18}>
                <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
              </Glyph>
            ) : (
              <Glyph size={20}>
                <rect x="9" y="2.5" width="6" height="11.5" rx="3" />
                <path d="M5.5 11.2a6.5 6.5 0 0 0 13 0" />
                <path d="M12 17.7V21" />
              </Glyph>
            )}
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
            fontSize: 14,
            color: "var(--text-3)",
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
            marginTop: 8,
            fontSize: 14,
            lineHeight: 1.4,
            color: "var(--danger-on-surface)",
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

export const UniversalInputBar = memo(UniversalInputBarImpl);
