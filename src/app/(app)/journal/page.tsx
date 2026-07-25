"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import {
  Button,
  Card,
  EmptyState,
  Pressable,
  Skeleton,
  T,
  TYPO,
} from "@/components/ui";
import { Reveal, SegmentedTabs, SwipeDeck } from "@/components/motion";
import { haptic } from "@/lib/haptics";

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

const TAB_KEYS: readonly TabKey[] = ["dziennik", "historia"] as const;
const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: "dziennik", label: "Dziennik" },
  { key: "historia", label: "Historia" },
];

/**
 * Badge palettes. Every value is a token, so both themes work and nothing
 * renders a hardcoded hex on a dark surface.
 */
interface Palette {
  bg: string;
  fg: string;
}

const NEUTRAL_PALETTE: Palette = { bg: "var(--surface-2)", fg: "var(--text-3)" };

const CATEGORY_COLORS: Record<string, Palette> = {
  "Myśl": { bg: "var(--primary-soft)", fg: "var(--accent-text)" },
  "Refleksja": { bg: "var(--accent-soft)", fg: "var(--accent-on-surface)" },
  "Wniosek": { bg: "var(--success-soft)", fg: "var(--success-on-surface)" },
  "Doświadczenie": { bg: "var(--highlight-soft)", fg: "var(--highlight-on-surface)" },
};

const TOPIC_COLORS: Record<string, Palette> = {
  zdrowie: { bg: "var(--success-soft)", fg: "var(--success-on-surface)" },
  dzieci: { bg: "var(--highlight-soft)", fg: "var(--highlight-on-surface)" },
  dziewczyna: { bg: "var(--danger-soft)", fg: "var(--danger-on-surface)" },
  biznes: { bg: "var(--accent-soft)", fg: "var(--accent-on-surface)" },
  inne: NEUTRAL_PALETTE,
};

/* ------------------------------------------------------------------ */
/*  Icons - SVG for interface glyphs (stroke 1.75, round caps)         */
/* ------------------------------------------------------------------ */

function Icon({ children, size = 20 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0 }}
    >
      {children}
    </svg>
  );
}

const TrashIcon = ({ size = 20 }: { size?: number }) => (
  <Icon size={size}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </Icon>
);

const CopyIcon = ({ size = 18 }: { size?: number }) => (
  <Icon size={size}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </Icon>
);

const NoteIcon = ({ size = 26 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <polyline points="14 3 14 8 19 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </Icon>
);

const ArchiveIcon = ({ size = 26 }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3" y="4" width="18" height="5" rx="1.5" />
    <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
    <line x1="10" y1="13" x2="14" y2="13" />
  </Icon>
);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Human date for the card header: "25 lipca, 14:30". */
function formatHuman(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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

/* ------------------------------------------------------------------ */
/*  Pieces                                                             */
/* ------------------------------------------------------------------ */

/**
 * `position: fixed` has to leave the page tree: the shell keeps
 * `transform: translateY(0)` on <main> after `.page-enter`, and a transformed
 * ancestor turns `fixed` into `absolute` (the toast would land at the bottom of
 * the document instead of above the tab bar).
 */
function BodyPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function Badge({ label, palette }: { label: string; palette: Palette | undefined }) {
  const p = palette ?? NEUTRAL_PALETTE;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: T.rFull,
        background: p.bg,
        color: p.fg,
        border: `1px solid ${p.bg}`,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
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
    <Card>
      {/* Header: quiet date on the left, delete on the right (44 px) */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ ...TYPO.footnote, color: T.text3 }}>{formatHuman(entry.createdAt)}</div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginTop: 8,
            }}
          >
            {entry.category && (
              <Badge label={entry.category} palette={CATEGORY_COLORS[entry.category]} />
            )}
            {entry.topic && <Badge label={entry.topic} palette={TOPIC_COLORS[entry.topic]} />}
            {!entry.redactedText && <Badge label="surowy" palette={NEUTRAL_PALETTE} />}
          </div>
        </div>

        <Pressable
          onPress={() => onDelete(entry.id)}
          haptic="warning"
          ariaLabel="Usuń wpis"
          style={{ width: 44, height: 44, borderRadius: T.rFull, color: T.text3, flexShrink: 0 }}
        >
          <TrashIcon />
        </Pressable>
      </div>

      {/* The entry itself - this is the content, so it gets the readable size */}
      <div
        style={{
          ...TYPO.callout,
          fontSize: 16,
          lineHeight: 1.55,
          color: T.text,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {display}
      </div>

      {expanded && entry.redactedText && (
        <div
          className="reveal"
          style={{
            marginTop: 14,
            padding: `${T.sp3} 14px`,
            borderRadius: T.rMd,
            background: T.surface2,
          }}
        >
          <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Oryginał</div>
          <div
            style={{
              ...TYPO.footnote,
              color: T.text2,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              lineHeight: 1.5,
            }}
          >
            {entry.rawText}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        {entry.redactedText && (
          <Button variant="secondary" size="sm" onPress={() => onToggleExpand(entry.id)}>
            {expanded ? "Ukryj oryginał" : "Pokaż oryginał"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<CopyIcon />}
          onPress={() => onExportOne(entry)}
        >
          Kopiuj MD
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

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
    haptic.impact();
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
        haptic.success();
        showToast("Wpis dodany");
      } else {
        const err = await res.json().catch(() => ({}));
        haptic.error();
        showToast(err.error || "Błąd zapisu");
      }
    } catch {
      haptic.error();
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
    haptic.tap();
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
  const tabIndex = Math.max(0, TAB_KEYS.indexOf(activeTab));

  const PAGE_STYLE: React.CSSProperties = {
    padding: "20px var(--gutter) 24px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
  };

  /* ---------------- panels ---------------- */

  const journalPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* New entry - the hero action of this screen */}
      <Reveal index={0}>
        <Card variant="hero" padding="lg">
          <div style={{ ...TYPO.label, color: T.text3, marginBottom: 10 }}>Nowy wpis</div>
          <VoiceTextarea
            value={newText}
            onChange={setNewText}
            placeholder="Co masz w głowie? Pisz albo nagrywaj — AI zredaguje i pokategoryzuje."
            minHeight={150}
            disabled={saving}
            style={{ fontSize: 17, lineHeight: 1.5, borderRadius: 14 }}
          />
          <div style={{ marginTop: 14 }}>
            <Button
              size="lg"
              fullWidth
              loading={saving}
              disabled={!newText.trim()}
              onPress={saveEntry}
            >
              Zapisz wpis
            </Button>
          </div>
          {savingMessage && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginTop: 10,
                ...TYPO.footnote,
                color: T.text3,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--accent-fill)",
                  animation: "pulse 1s ease-in-out infinite",
                }}
              />
              {savingMessage}
            </div>
          )}
        </Card>
      </Reveal>

      {loading && (
        <>
          <Skeleton variant="card" count={3} />
          <Skeleton variant="card" count={2} />
        </>
      )}

      {!loading && latestEntry && (
        <Reveal index={1}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ ...TYPO.label, color: T.text3, padding: "4px 4px 0" }}>Ostatni wpis</div>
            <JournalEntryCard
              entry={latestEntry}
              expanded={expandedIds.has(latestEntry.id)}
              onToggleExpand={toggleExpanded}
              onDelete={deleteEntry}
              onExportOne={copyOneEntry}
            />
            {entries.length > 1 && (
              <Button
                variant="ghost"
                size="md"
                fullWidth
                onPress={() => setActiveTab("historia")}
              >
                Zobacz historię ({entries.length})
              </Button>
            )}
          </div>
        </Reveal>
      )}

      {!loading && entries.length === 0 && (
        <Reveal index={1}>
          <Card>
            <EmptyState
              icon={<NoteIcon />}
              title="Twój pierwszy wpis"
              body="Dziennik zachowuje Twoje myśli, AI je porządkuje, a mentorzy mają lepszy kontekst."
            />
          </Card>
        </Reveal>
      )}
    </div>
  );

  const historyPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          minHeight: 44,
        }}
      >
        <div style={{ ...TYPO.footnote, color: T.text3 }}>
          {loading
            ? "Wczytuję..."
            : entries.length === 0
              ? "Brak wpisów"
              : `Wszystkich wpisów: ${entries.length}`}
        </div>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={<CopyIcon />}
          disabled={loading || entries.length === 0}
          onPress={copyAllMarkdown}
        >
          Eksport
        </Button>
      </div>

      {loading && (
        <>
          <Skeleton variant="card" count={3} />
          <Skeleton variant="card" count={2} />
          <Skeleton variant="card" count={3} />
        </>
      )}

      {!loading && entries.length === 0 && (
        <Card>
          <EmptyState
            icon={<ArchiveIcon />}
            title="Pusto w historii"
            body="Wróć do zakładki Dziennik i zapisz pierwszą myśl."
            action={{ label: "Dodaj wpis", onPress: () => setActiveTab("dziennik") }}
          />
        </Card>
      )}

      {!loading && entries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {entries.map((e, i) => (
            <Reveal key={e.id} index={i}>
              <JournalEntryCard
                entry={e}
                expanded={expandedIds.has(e.id)}
                onToggleExpand={toggleExpanded}
                onDelete={deleteEntry}
                onExportOne={copyOneEntry}
              />
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div style={PAGE_STYLE}>
      {/* Header */}
      <header className="anim-in">
        <div style={{ ...TYPO.label, color: T.text3 }}>Twoje myśli</div>
        <h1 style={{ ...TYPO.title1, color: T.text, margin: "6px 0 0" }}>Dziennik</h1>
        <p style={{ ...TYPO.callout, color: T.text2, margin: "4px 0 0" }}>
          Piszesz albo nagrywasz. AI porządkuje, mentorzy korzystają.
        </p>
      </header>

      <SegmentedTabs<TabKey>
        tabs={TABS}
        active={activeTab}
        onChange={setActiveTab}
        ariaLabel="Widok dziennika"
      />

      <SwipeDeck
        index={tabIndex}
        onChange={(i) => setActiveTab(TAB_KEYS[i] ?? "dziennik")}
        labels={TABS.map((t) => t.label)}
      >
        {journalPanel}
        {historyPanel}
      </SwipeDeck>

      {/* Toast */}
      {toast && (
        <BodyPortal>
          <div
            className="fade-scale"
            role="status"
            style={{
              position: "fixed",
              left: "50%",
              bottom: "calc(var(--above-tabbar) + 16px)",
              transform: "translateX(-50%)",
              padding: "12px 20px",
              borderRadius: T.rFull,
              background: T.text,
              color: T.bg,
              ...TYPO.footnote,
              fontWeight: 700,
              boxShadow: T.elev3,
              zIndex: 100,
              maxWidth: "92vw",
              textAlign: "center",
            }}
          >
            {toast}
          </div>
        </BodyPortal>
      )}
    </div>
  );
}
