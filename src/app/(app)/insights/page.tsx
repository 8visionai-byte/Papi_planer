"use client";

/**
 * "Wnioski" - what the app has learned about the user.
 *
 * This screen is the correction loop for the long-term memory: every card carries
 * a "To nieprawda" button that flips `active` to false, so the user can throw out
 * a conclusion that does not fit them. Nothing is deleted, it simply stops being
 * fed to the mentors. The user can also add their own statement about themselves,
 * which lands with full confidence.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import { haptic } from "@/lib/haptics";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Sheet,
  Skeleton,
  T,
  TYPO,
  TONE,
  fieldControlStyle,
  fieldTextareaStyle,
  type Tone,
} from "@/components/ui";
import { Reveal } from "@/components/motion";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Insight {
  id: string;
  kind: string;
  period: string | null;
  title: string;
  content: string;
  confidence: number;
  active: boolean;
  createdAt: string;
}

type WritableKind = "preference" | "pattern" | "milestone";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SECTIONS: { kind: string; label: string; icon: string; hint: string }[] = [
  {
    kind: "weekly_summary",
    label: "Podsumowania tygodniowe",
    icon: "🗓️",
    hint: "Co działo się w minionych tygodniach.",
  },
  {
    kind: "pattern",
    label: "Wzorce",
    icon: "🔁",
    hint: "Powtarzalne zachowania wyliczone z Twoich danych.",
  },
  {
    kind: "preference",
    label: "Preferencje",
    icon: "🎯",
    hint: "Jak najchętniej pracujesz.",
  },
  {
    kind: "milestone",
    label: "Kamienie milowe",
    icon: "🏁",
    hint: "Momenty, które warto pamiętać.",
  },
];

const KIND_OPTIONS: { value: WritableKind; label: string }[] = [
  { value: "preference", label: "Preferencja (jak lubię pracować)" },
  { value: "pattern", label: "Wzorzec (co mi się powtarza)" },
  { value: "milestone", label: "Kamień milowy (co osiągnąłem)" },
];

function confidenceTone(confidence: number): { tone: Tone; label: string } {
  if (confidence >= 0.75) return { tone: "success", label: "wysoka pewność" };
  if (confidence >= 0.5) return { tone: "accent", label: "średnia pewność" };
  return { tone: "warning", label: "hipoteza" };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "d MMM yyyy", { locale: pl });
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function InsightsPage() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newKind, setNewKind] = useState<WritableKind>("preference");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const fetchInsights = useCallback(async () => {
    try {
      const res = await fetch("/api/insights");
      if (res.ok) {
        const json: { insights: Insight[] } = await res.json();
        setInsights(json.insights ?? []);
      }
    } catch {
      // silent: an empty screen with its empty state is a better failure than an alert
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const dismiss = useCallback(
    async (id: string) => {
      setBusyIds((prev) => new Set(prev).add(id));
      // Optimistic: the card leaves immediately, it comes back only if the call fails.
      const snapshot = insights;
      setInsights((prev) => prev.filter((i) => i.id !== id));
      try {
        const res = await fetch("/api/insights", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, active: false }),
        });
        if (!res.ok) throw new Error("patch failed");
        haptic.success();
        showToast("Wniosek odrzucony. Mentorzy już go nie zobaczą.");
      } catch {
        setInsights(snapshot);
        haptic.error();
        showToast("Nie udało się zapisać. Spróbuj ponownie.");
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [insights, showToast],
  );

  const addOwn = useCallback(async () => {
    const content = newContent.trim();
    if (!content || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: newKind, title: newTitle.trim(), content }),
      });
      if (!res.ok) throw new Error("post failed");
      const json: { insight: Insight } = await res.json();
      setInsights((prev) => [json.insight, ...prev]);
      haptic.success();
      setShowAdd(false);
      setNewTitle("");
      setNewContent("");
      showToast("Zapisane. Mentorzy będą to wiedzieć.");
    } catch {
      haptic.error();
      showToast("Nie udało się zapisać wniosku.");
    } finally {
      setAdding(false);
    }
  }, [adding, newContent, newKind, newTitle, showToast]);

  const grouped = useMemo(() => {
    const map = new Map<string, Insight[]>();
    for (const i of insights) {
      const list = map.get(i.kind) ?? [];
      list.push(i);
      map.set(i.kind, list);
    }
    return map;
  }, [insights]);

  /** Running index so the whole screen cascades in one continuous wave. */
  let revealIndex = 0;

  return (
    <div
      style={{
        padding: `${T.sp6} ${T.gutter} ${T.sp6}`,
        display: "flex",
        flexDirection: "column",
        gap: T.sp6,
      }}
    >
      {/* ---------------- Header ---------------- */}
      <header className="anim-in">
        <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Pamięć aplikacji</div>
        <h1 style={{ ...TYPO.title1, fontWeight: 800, color: T.text, margin: 0 }}>Wnioski</h1>
        <p style={{ ...TYPO.callout, color: T.text2, margin: `${T.sp1} 0 0` }}>
          To, czego aplikacja nauczyła się o Tobie. Jeśli coś się nie zgadza, powiedz
          „To nieprawda” i zniknie z pamięci mentorów.
        </p>
      </header>

      {/* ---------------- Loading ---------------- */}
      {loading && (
        <Card padding="md">
          <Skeleton variant="list" count={4} />
        </Card>
      )}

      {/* ---------------- Empty ---------------- */}
      {!loading && insights.length === 0 && (
        <Card padding="none" className="anim-in">
          <EmptyState
            icon="🧠"
            title="Nie ma jeszcze wniosków"
            body="Wnioski pojawiają się w niedzielę wieczorem, gdy aplikacja podsumuje tydzień. Możesz też dopisać coś o sobie już teraz."
            action={{ label: "Dodaj własny wniosek", onPress: () => setShowAdd(true) }}
          />
        </Card>
      )}

      {/* ---------------- Sections ---------------- */}
      {!loading &&
        insights.length > 0 &&
        SECTIONS.map((section) => {
          const items = grouped.get(section.kind);
          if (!items || items.length === 0) return null;
          return (
            <section
              key={section.kind}
              style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}
            >
              <div style={{ padding: `0 ${T.sp1}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: T.sp2 }}>
                  <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
                    {section.icon}
                  </span>
                  <span style={{ ...TYPO.label, color: T.text3 }}>{section.label}</span>
                  <span
                    className="num"
                    style={{ ...TYPO.footnote, fontWeight: 600, color: T.text4 }}
                  >
                    {items.length}
                  </span>
                </div>
                <p style={{ ...TYPO.footnote, color: T.text3, margin: `${T.sp1} 0 0` }}>
                  {section.hint}
                </p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
                {items.map((insight) => (
                  <Reveal key={insight.id} index={revealIndex++}>
                    <InsightCard
                      insight={insight}
                      busy={busyIds.has(insight.id)}
                      onDismiss={() => dismiss(insight.id)}
                    />
                  </Reveal>
                ))}
              </div>
            </section>
          );
        })}

      {/* ---------------- Add own ---------------- */}
      {!loading && insights.length > 0 && (
        <Button variant="secondary" size="md" fullWidth onPress={() => setShowAdd(true)}>
          + Dodaj własny wniosek
        </Button>
      )}

      {/* ---------------- Add sheet ---------------- */}
      <Sheet
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Napisz coś o sobie"
        footer={
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={adding}
            disabled={newContent.trim().length === 0}
            onPress={addOwn}
          >
            Zapisz wniosek
          </Button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: T.sp4, paddingBottom: T.sp4 }}>
          <p style={{ ...TYPO.callout, color: T.text2, margin: 0 }}>
            To, co tu napiszesz, trafia do pamięci wszystkich mentorów z najwyższą wagą.
          </p>

          <Field label="Rodzaj">
            {(props) => (
              <select
                {...props}
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as WritableKind)}
                style={fieldControlStyle}
              >
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Tytuł" hint="Opcjonalny. Bez niego użyjemy początku treści.">
            {(props) => (
              <input
                {...props}
                type="text"
                value={newTitle}
                maxLength={80}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="np. Trenuję najlepiej rano"
                style={fieldControlStyle}
              />
            )}
          </Field>

          <Field label="Treść" required>
            {(props) => (
              <textarea
                {...props}
                value={newContent}
                maxLength={1200}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="np. Po 20:00 nie mam już siły na trening siłowy, wtedy działa tylko spacer."
                style={fieldTextareaStyle}
              />
            )}
          </Field>
        </div>
      </Sheet>

      {/* ---------------- Toast ---------------- */}
      {toast && (
        <div
          role="status"
          className="anim-pop"
          style={{
            position: "fixed",
            left: "50%",
            bottom: `calc(${T.aboveTabbar} + ${T.sp2})`,
            transform: "translateX(-50%)",
            padding: `${T.sp3} ${T.sp4}`,
            borderRadius: T.rMd,
            background: T.surface3,
            border: `1px solid ${T.borderStrong}`,
            color: T.text,
            ...TYPO.footnote,
            fontWeight: 600,
            boxShadow: T.elev3,
            zIndex: 1000,
            maxWidth: "90vw",
            textAlign: "center",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Card                                                               */
/* ------------------------------------------------------------------ */

function InsightCard({
  insight,
  busy,
  onDismiss,
}: {
  insight: Insight;
  busy: boolean;
  onDismiss: () => void;
}) {
  /** Two-step: one tap arms the action, the second confirms. No native confirm(). */
  const [armed, setArmed] = useState(false);
  const { tone, label } = confidenceTone(insight.confidence);
  const toneColors = TONE[tone];

  return (
    <Card padding="md">
      <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: T.sp3,
          }}
        >
          <h2 style={{ ...TYPO.title3, color: T.text, margin: 0, minWidth: 0 }}>
            {insight.title}
          </h2>
          <span
            style={{
              ...TYPO.footnote,
              fontWeight: 700,
              color: toneColors.fg,
              background: toneColors.soft,
              border: `1px solid ${toneColors.fill}`,
              borderRadius: T.rFull,
              padding: "4px 10px",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {label}
          </span>
        </div>

        <p style={{ ...TYPO.callout, color: T.text2, margin: 0, whiteSpace: "pre-wrap" }}>
          {insight.content}
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: T.sp3,
            flexWrap: "wrap",
          }}
        >
          <span className="num" style={{ ...TYPO.footnote, color: T.text3 }}>
            {insight.period ? `${insight.period} · ` : ""}
            {formatDate(insight.createdAt)}
          </span>

          {armed ? (
            <span style={{ display: "flex", gap: T.sp2, flexShrink: 0 }}>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => setArmed(false)}
                ariaLabel="Anuluj odrzucenie wniosku"
              >
                Anuluj
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={busy}
                onPress={onDismiss}
                ariaLabel={`Potwierdź: "${insight.title}" to nieprawda`}
              >
                Potwierdź
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              haptic="warning"
              onPress={() => setArmed(true)}
              ariaLabel={`Oznacz "${insight.title}" jako nieprawdę`}
            >
              To nieprawda
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
