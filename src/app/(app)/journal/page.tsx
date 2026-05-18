"use client";

import { useCallback, useEffect, useState } from "react";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import BigTabs from "@/components/ui/BigTabs";

interface JournalEntry {
  id: string;
  rawText: string;
  redactedText: string | null;
  category: string | null;
  topic: string | null;
  createdAt: string;
}

interface JournalResponse {
  entries: JournalEntry[];
  markdown: string;
}

type TabKey = "dziennik" | "historia";

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "dziennik", label: "Dziennik" },
  { key: "historia", label: "Historia" },
];

const CATEGORY_COLORS: Record<string, { bg: string; fg: string }> = {
  "Myśl": { bg: "rgba(59, 130, 246, 0.15)", fg: "#2563eb" },
  "Refleksja": { bg: "rgba(168, 85, 247, 0.15)", fg: "#9333ea" },
  "Wniosek": { bg: "rgba(34, 197, 94, 0.15)", fg: "#16a34a" },
  "Doświadczenie": { bg: "rgba(245, 158, 11, 0.15)", fg: "#d97706" },
};

const TOPIC_COLORS: Record<string, { bg: string; fg: string }> = {
  zdrowie: { bg: "rgba(239, 68, 68, 0.12)", fg: "#dc2626" },
  dzieci: { bg: "rgba(236, 72, 153, 0.12)", fg: "#db2777" },
  dziewczyna: { bg: "rgba(244, 114, 182, 0.12)", fg: "#be185d" },
  biznes: { bg: "rgba(14, 165, 233, 0.12)", fg: "#0284c7" },
  inne: { bg: "rgba(100, 116, 139, 0.12)", fg: "#475569" },
};

const cardStyle: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 16,
  padding: 16,
  boxShadow: "var(--card-shadow)",
};

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function entryToMarkdown(e: JournalEntry): string {
  const ts = formatTs(e.createdAt);
  const cat = e.category ?? "—";
  const topic = e.topic ?? "—";
  const body = (e.redactedText ?? e.rawText).trim();
  return `## ${ts} — [${cat} | ${topic}]\n\n${body}\n`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

function Badge({ label, palette }: { label: string; palette: { bg: string; fg: string } | undefined }) {
  const p = palette ?? { bg: "var(--border)", fg: "var(--muted)" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 9999,
        background: p.bg,
        color: p.fg,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.2,
      }}
    >
      {label}
    </span>
  );
}

interface JournalEntryCardProps {
  entry: JournalEntry;
  expanded: boolean;
  onToggleExpand: (id: string) => void;
  onDelete: (id: string) => void;
  onExportOne: (entry: JournalEntry) => void;
}

function JournalEntryCard({
  entry,
  expanded,
  onToggleExpand,
  onDelete,
  onExportOne,
}: JournalEntryCardProps) {
  const display = (entry.redactedText ?? entry.rawText).trim();
  return (
    <div style={cardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>
          {formatTs(entry.createdAt)}
        </span>
        {entry.category && (
          <Badge label={entry.category} palette={CATEGORY_COLORS[entry.category]} />
        )}
        {entry.topic && (
          <Badge label={entry.topic} palette={TOPIC_COLORS[entry.topic]} />
        )}
        {!entry.redactedText && (
          <Badge
            label="surowy"
            palette={{ bg: "rgba(100, 116, 139, 0.12)", fg: "#64748b" }}
          />
        )}
      </div>
      <div
        style={{
          fontSize: 14,
          lineHeight: 1.55,
          color: "var(--foreground)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {display}
      </div>
      {expanded && entry.redactedText && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 10,
            background: "var(--background)",
            border: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 6,
            }}
          >
            Oryginał
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--muted)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              lineHeight: 1.5,
            }}
          >
            {entry.rawText}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {entry.redactedText && (
          <button
            onClick={() => onToggleExpand(entry.id)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--muted)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {expanded ? "Ukryj oryginał" : "Pokaż oryginał"}
          </button>
        )}
        <button
          onClick={() => onExportOne(entry)}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--muted)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          📋 Eksport MD
        </button>
        <button
          onClick={() => onDelete(entry.id)}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            border: "1px solid var(--danger)",
            background: "transparent",
            color: "var(--danger)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Usuń
        </button>
      </div>
    </div>
  );
}

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [markdown, setMarkdown] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingMessage, setSavingMessage] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("dziennik");

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/journal");
      if (res.ok) {
        const json: JournalResponse = await res.json();
        setEntries(json.entries);
        setMarkdown(json.markdown);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const saveEntry = async () => {
    const text = newText.trim();
    if (!text || saving) return;
    setSaving(true);
    setSavingMessage("AI redaguje...");
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: text, autoRedact: true }),
      });
      if (res.ok) {
        setNewText("");
        await fetchEntries();
        showToast("Wpis dodany");
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || "Błąd zapisu");
      }
    } catch {
      showToast("Błąd zapisu");
    } finally {
      setSaving(false);
      setSavingMessage(null);
    }
  };

  const deleteEntry = async (id: string) => {
    if (!confirm("Usunąć ten wpis na zawsze?")) return;
    try {
      const res = await fetch("/api/journal", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        // Rebuild markdown after delete (just refetch for correctness)
        fetchEntries();
        showToast("Usunięto");
      } else {
        showToast("Błąd usuwania");
      }
    } catch {
      showToast("Błąd usuwania");
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyAllMarkdown = async () => {
    if (!markdown.trim()) {
      showToast("Brak wpisów do eksportu");
      return;
    }
    const ok = await copyToClipboard(markdown);
    showToast(ok ? "Markdown skopiowany do schowka" : "Nie udało się skopiować");
  };

  const copyOneEntry = async (entry: JournalEntry) => {
    const md = entryToMarkdown(entry);
    const ok = await copyToClipboard(md);
    showToast(ok ? "Skopiowano wpis do schowka" : "Nie udało się skopiować");
  };

  const latestEntry = entries.length > 0 ? entries[0] : null;

  return (
    <div style={{ padding: "20px 16px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--foreground)", margin: 0 }}>
          📔 Dziennik
        </h1>
        <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 0" }}>
          Twoje myśli. AI strukturyzuje. Mentorzy używają.
        </p>
      </div>

      {/* Tabs */}
      <BigTabs<TabKey> tabs={TABS} active={activeTab} onChange={setActiveTab} style={{ marginBottom: 0 }} />

      {activeTab === "dziennik" && (
        <>
          {/* New entry form */}
          <div style={cardStyle}>
            <label
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--muted)",
                marginBottom: 6,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Nowy wpis
            </label>
            <VoiceTextarea
              value={newText}
              onChange={setNewText}
              placeholder="Co masz w głowie? Pisz lub nagrywaj — AI zredaguje i pokategoryzuje..."
              minHeight={120}
              disabled={saving}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <button
                onClick={saveEntry}
                disabled={!newText.trim() || saving}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: "var(--primary)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: !newText.trim() || saving ? 0.5 : 1,
                }}
              >
                {saving ? "Zapisuję..." : "Zapisz"}
              </button>
              {savingMessage && (
                <span style={{ fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "var(--primary)",
                      animation: "j-pulse 1s ease-in-out infinite",
                    }}
                  />
                  {savingMessage}
                </span>
              )}
            </div>
          </div>

          {/* Loading skeleton */}
          {loading && (
            <div style={cardStyle}>
              <div style={{ height: 14, width: "55%", borderRadius: 7, background: "var(--border)", marginBottom: 10, animation: "j-pulse 1.5s ease-in-out infinite" }} />
              <div style={{ height: 14, width: "85%", borderRadius: 7, background: "var(--border)", marginBottom: 10, animation: "j-pulse 1.5s ease-in-out infinite" }} />
              <div style={{ height: 14, width: "70%", borderRadius: 7, background: "var(--border)", animation: "j-pulse 1.5s ease-in-out infinite" }} />
            </div>
          )}

          {/* Latest entry section */}
          {!loading && latestEntry && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  paddingLeft: 4,
                }}
              >
                Ostatni wpis
              </div>
              <JournalEntryCard
                entry={latestEntry}
                expanded={expandedIds.has(latestEntry.id)}
                onToggleExpand={toggleExpanded}
                onDelete={deleteEntry}
                onExportOne={copyOneEntry}
              />
              {entries.length > 1 && (
                <button
                  onClick={() => setActiveTab("historia")}
                  style={{
                    alignSelf: "flex-start",
                    padding: "8px 14px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--foreground)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Zobacz historię ({entries.length})
                </button>
              )}
            </div>
          )}

          {/* Empty state */}
          {!loading && entries.length === 0 && (
            <div style={{ ...cardStyle, textAlign: "center", padding: "32px 16px" }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>📔</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--foreground)", marginBottom: 6 }}>
                Twój pierwszy wpis
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, maxWidth: 320, margin: "0 auto" }}>
                Po co dziennik? Zachowuje Twoje myśli, AI je strukturyzuje, mentorzy mają lepszy kontekst.
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === "historia" && (
        <>
          {/* History header with export-all */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {loading
                ? "Wczytuję..."
                : entries.length === 0
                  ? "Brak wpisów"
                  : `Wszystkich wpisów: ${entries.length}`}
            </div>
            <button
              onClick={copyAllMarkdown}
              disabled={loading || entries.length === 0}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--foreground)",
                fontSize: 12,
                fontWeight: 600,
                cursor: loading || entries.length === 0 ? "not-allowed" : "pointer",
                opacity: loading || entries.length === 0 ? 0.5 : 1,
                whiteSpace: "nowrap",
              }}
            >
              📋 Eksport wszystkich
            </button>
          </div>

          {/* Loading skeleton */}
          {loading && (
            <div style={cardStyle}>
              <div style={{ height: 14, width: "55%", borderRadius: 7, background: "var(--border)", marginBottom: 10, animation: "j-pulse 1.5s ease-in-out infinite" }} />
              <div style={{ height: 14, width: "85%", borderRadius: 7, background: "var(--border)", marginBottom: 10, animation: "j-pulse 1.5s ease-in-out infinite" }} />
              <div style={{ height: 14, width: "70%", borderRadius: 7, background: "var(--border)", animation: "j-pulse 1.5s ease-in-out infinite" }} />
            </div>
          )}

          {/* Empty state */}
          {!loading && entries.length === 0 && (
            <div style={{ ...cardStyle, textAlign: "center", padding: "32px 16px" }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>🗂️</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--foreground)", marginBottom: 6 }}>
                Pusto w historii
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, maxWidth: 320, margin: "0 auto" }}>
                Wróć do zakładki Dziennik i dodaj swój pierwszy wpis.
              </div>
            </div>
          )}

          {/* Scrollable entries list */}
          {!loading && entries.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                maxHeight: "calc(100vh - 280px)",
                overflowY: "auto",
                paddingRight: 4,
              }}
            >
              {entries.map((e) => (
                <JournalEntryCard
                  key={e.id}
                  entry={e}
                  expanded={expandedIds.has(e.id)}
                  onToggleExpand={toggleExpanded}
                  onDelete={deleteEntry}
                  onExportOne={copyOneEntry}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 80,
            transform: "translateX(-50%)",
            padding: "10px 16px",
            borderRadius: 10,
            background: "var(--foreground)",
            color: "var(--background)",
            fontSize: 13,
            fontWeight: 500,
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
            zIndex: 1000,
            maxWidth: "90vw",
            textAlign: "center",
          }}
        >
          {toast}
        </div>
      )}

      <style>{`
        @keyframes j-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
