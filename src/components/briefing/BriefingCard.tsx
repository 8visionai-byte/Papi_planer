"use client";

import { useRef, useState, useEffect } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BriefingData {
  id: string;
  content: string;
  audioUrl: string | null;
  phase: number | null;
  week: number | null;
  dayType: string | null;
}

interface BriefingCardProps {
  briefing: BriefingData | null;
  streamingText: string;
  isGenerating: boolean;
  onGenerate: () => void;
  onGenerateAudio?: (briefingId: string) => void;
  isGeneratingAudio?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Markdown renderer (simple)                                         */
/* ------------------------------------------------------------------ */

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Headers
    if (line.startsWith("### ")) {
      elements.push(
        <h3
          key={i}
          style={{
            fontSize: 15,
            fontWeight: 600,
            margin: "12px 0 4px",
            color: "var(--foreground)",
          }}
        >
          {formatInline(line.slice(4))}
        </h3>
      );
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h2
          key={i}
          style={{
            fontSize: 16,
            fontWeight: 700,
            margin: "14px 0 6px",
            color: "var(--foreground)",
          }}
        >
          {formatInline(line.slice(3))}
        </h2>
      );
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <h1
          key={i}
          style={{
            fontSize: 18,
            fontWeight: 700,
            margin: "16px 0 8px",
            color: "var(--foreground)",
          }}
        >
          {formatInline(line.slice(2))}
        </h1>
      );
      continue;
    }

    // List items
    if (/^[-*+]\s/.test(line)) {
      elements.push(
        <div
          key={i}
          style={{
            display: "flex",
            gap: 6,
            paddingLeft: 4,
            marginBottom: 2,
          }}
        >
          <span style={{ color: "var(--primary)", flexShrink: 0 }}>•</span>
          <span>{formatInline(line.replace(/^[-*+]\s/, ""))}</span>
        </div>
      );
      continue;
    }

    // Numbered lists
    if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.+)/);
      if (match) {
        elements.push(
          <div
            key={i}
            style={{
              display: "flex",
              gap: 6,
              paddingLeft: 4,
              marginBottom: 2,
            }}
          >
            <span
              style={{
                color: "var(--primary)",
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {match[1]}.
            </span>
            <span>{formatInline(match[2])}</span>
          </div>
        );
        continue;
      }
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: 6 }} />);
      continue;
    }

    // Regular text
    elements.push(
      <p key={i} style={{ margin: "2px 0" }}>
        {formatInline(line)}
      </p>
    );
  }

  return elements;
}

function formatInline(text: string): React.ReactNode {
  // Bold
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} style={{ fontWeight: 600 }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

/* ------------------------------------------------------------------ */
/*  Audio Player                                                       */
/* ------------------------------------------------------------------ */

function AudioPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      if (audio.duration) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
    };
    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
    };
    const onError = () => {
      const mediaErr = audio.error;
      const code = mediaErr?.code;
      // 1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED
      let msg = "Nie można załadować audio";
      if (code === 2) msg = "Błąd sieci przy ładowaniu audio";
      else if (code === 3) msg = "Plik audio uszkodzony";
      else if (code === 4) msg = "Brak pliku audio na serwerze";
      setError(msg);
      setPlaying(false);
      // eslint-disable-next-line no-console
      console.error("[AudioPlayer] error", { url, code, mediaErr });
    };
    const onLoadedData = () => setError(null);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("loadeddata", onLoadedData);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("loadeddata", onLoadedData);
    };
  }, [url]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      try {
        await audio.play();
        setPlaying(true);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[AudioPlayer] play() rejected", e);
        setError(
          e instanceof Error ? e.message : "Nie można odtworzyć audio"
        );
      }
    }
  };

  if (error) {
    return (
      <div
        style={{
          fontSize: 11,
          color: "var(--danger, #ef4444)",
          maxWidth: 220,
          textAlign: "right",
        }}
      >
        {error}
        <audio ref={audioRef} src={url} preload="metadata" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <audio ref={audioRef} src={url} preload="metadata" />
      <button
        onClick={toggle}
        aria-label={playing ? "Pauza" : "Odtwórz"}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 32,
          height: 32,
          borderRadius: 9999,
          background: "var(--primary)",
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {playing ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
      </button>
      <div
        style={{
          flex: 1,
          minWidth: 60,
          height: 4,
          borderRadius: 2,
          background: "var(--border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: "var(--primary)",
            borderRadius: 2,
            transition: "width 200ms linear",
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  BriefingCard                                                       */
/* ------------------------------------------------------------------ */

const cardStyle: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 16,
  padding: 16,
  boxShadow: "var(--card-shadow)",
};

export function BriefingCard({
  briefing,
  streamingText,
  isGenerating,
  onGenerate,
  onGenerateAudio,
  isGeneratingAudio,
}: BriefingCardProps) {
  const displayContent = isGenerating ? streamingText : briefing?.content;
  const audioUrl = briefing?.audioUrl ?? null;

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Briefing</h2>

        <div style={{ display: "flex", gap: 6 }}>
          {/* Audio controls */}
          {audioUrl && !isGenerating && (
            <AudioPlayer url={audioUrl} />
          )}

          {/* TTS generate button */}
          {briefing && !audioUrl && !isGenerating && onGenerateAudio && (
            <button
              onClick={() => onGenerateAudio(briefing.id)}
              disabled={isGeneratingAudio}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: "none",
                color: "var(--primary)",
                border: "1px solid var(--primary)",
                borderRadius: 9999,
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: 500,
                cursor: isGeneratingAudio ? "not-allowed" : "pointer",
                opacity: isGeneratingAudio ? 0.6 : 1,
              }}
            >
              {isGeneratingAudio ? (
                "Generuje..."
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
                  </svg>
                  Audio
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {displayContent ? (
        <div
          style={{
            marginTop: 10,
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--foreground)",
          }}
        >
          {renderMarkdown(displayContent)}
          {isGenerating && (
            <span
              style={{
                display: "inline-block",
                width: 6,
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
      ) : (
        <div style={{ marginTop: 10, textAlign: "center", padding: "12px 0" }}>
          <p
            style={{
              fontSize: 14,
              color: "var(--muted)",
              margin: "0 0 12px",
            }}
          >
            Brak briefingu na dzis
          </p>
          <button
            onClick={onGenerate}
            disabled={isGenerating}
            style={{
              background: "var(--primary)",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: isGenerating ? "not-allowed" : "pointer",
              opacity: isGenerating ? 0.7 : 1,
            }}
          >
            {isGenerating ? "Generuje..." : "Wygeneruj briefing"}
          </button>
        </div>
      )}
    </div>
  );
}
