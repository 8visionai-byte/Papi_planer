"use client";

/**
 * "Wnioski" - what the app has learned about the user, and the queue of changes
 * waiting for their yes.
 *
 * Two loops live on this screen:
 *
 *  1. Correction. Every card carries "To nieprawda", which flips `active` to false.
 *     Nothing is deleted, the conclusion simply stops being fed to the mentors.
 *
 *  2. Restructuring with consent. The user writes a note about themselves ("zdałem
 *     karate"), the memory agent reads it and PROPOSES what should change in their
 *     goals, insights, habits or profile. Those proposals sit at the top of the
 *     screen as plain Polish sentences with two buttons. Until one is confirmed,
 *     absolutely nothing in the data has moved. That is the whole point: the user
 *     must never say something and later discover data quietly disappeared.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import { haptic } from "@/lib/haptics";
import {
  Button,
  Card,
  EmptyState,
  Sheet,
  Skeleton,
  T,
  TYPO,
  TONE,
  type Tone,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import VoiceTextarea from "@/components/forms/VoiceTextarea";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Insight {
  id: string;
  kind: string;
  /** "app" = written by the weekly agent, "user" = written by the person. */
  origin: string;
  period: string | null;
  title: string;
  content: string;
  confidence: number;
  active: boolean;
  createdAt: string;
}

interface Proposal {
  id: string;
  entity: string;
  entityId: string | null;
  action: string;
  summary: string;
  status: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SECTIONS: { kind: string; label: string; icon: string; hint: string }[] = [
  {
    kind: "user_note",
    label: "Twoje wpisy",
    icon: "✍️",
    hint: "To, co sam o sobie napisałeś. Mentorzy traktują to najpoważniej.",
  },
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

/** What each proposal touches, so the card says it before the sentence does. */
const ENTITY_LABEL: Record<string, string> = {
  goal: "Cel",
  insight: "Wniosek",
  habit: "Nawyk",
  profile: "Profil",
};

/** How long the card stays mounted while it fades out. Matches the transition below. */
const LEAVE_MS = 260;

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

/** Polish counting: 1 propozycję, 2-4 propozycje, 5+ propozycji. */
function proposalCountLabel(n: number): string {
  if (n === 1) return "1 propozycję zmiany";
  const last = n % 10;
  const lastTwo = n % 100;
  const many = last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14);
  return many ? `${n} propozycje zmian` : `${n} propozycji zmian`;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function InsightsPage() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  /** Cards mid-exit. Kept separate from `busyIds` so the fade is not a spinner. */
  const [leavingIds, setLeavingIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);
  /** The agent is reading the fresh note. Takes a few seconds, so it gets a banner. */
  const [analyzing, setAnalyzing] = useState(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
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
    }
  }, []);

  const fetchProposals = useCallback(async () => {
    try {
      const res = await fetch("/api/proposals");
      if (res.ok) {
        const json: { proposals: Proposal[] } = await res.json();
        setProposals(json.proposals ?? []);
      }
    } catch {
      // same reason: a missing queue must not blank the memory screen
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([fetchInsights(), fetchProposals()]);
      setLoading(false);
    })();
  }, [fetchInsights, fetchProposals]);

  /* ---------------- "To nieprawda" ---------------- */

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

  /* ---------------- Own note plus proposals ---------------- */

  const addOwn = useCallback(async () => {
    const content = newContent.trim();
    if (!content || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const json: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(json.error || "post failed");
      }
      const json: { insight: Insight } = await res.json();
      setInsights((prev) => [json.insight, ...prev]);
      haptic.success();
      setShowAdd(false);
      setNewContent("");
      setAdding(false);

      // The note is safely stored. Only now do we ask the agent what it implies:
      // if this call fails, nothing was lost, the queue is simply empty.
      setAnalyzing(true);
      showToast("Zapisane. Sprawdzam, czy to coś zmienia.");
      try {
        const pr = await fetch("/api/proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceText: content }),
        });
        if (!pr.ok) throw new Error("proposals failed");
        const pj: { proposals: Proposal[] } = await pr.json();
        const fresh = pj.proposals ?? [];
        if (fresh.length > 0) {
          setProposals((prev) => [...fresh, ...prev]);
          haptic.warning();
          showToast(`Mam ${proposalCountLabel(fresh.length)}. Potwierdź je na górze.`);
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          showToast("Zapisane. Nic innego nie wymaga zmiany.");
        }
      } catch {
        showToast("Wpis zapisany. Nie udało się sprawdzić, co to zmienia.");
      } finally {
        setAnalyzing(false);
      }
    } catch (err) {
      haptic.error();
      showToast(err instanceof Error ? err.message : "Nie udało się zapisać wniosku.");
      setAdding(false);
    }
  }, [adding, newContent, showToast]);

  /* ---------------- Accept / reject a proposal ---------------- */

  const decide = useCallback(
    async (id: string, decision: "accept" | "reject") => {
      if (busyIds.has(id)) return;
      setBusyIds((prev) => new Set(prev).add(id));
      try {
        const res = await fetch(`/api/proposals/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        if (!res.ok) {
          const json: { error?: string } = await res.json().catch(() => ({}));
          throw new Error(json.error || "decision failed");
        }

        if (decision === "accept") haptic.success();
        else haptic.tap();

        // Fade first, unmount after. Removing the row on the same tick would make
        // the card vanish and the list jump, which reads like a bug.
        setLeavingIds((prev) => new Set(prev).add(id));
        setTimeout(() => {
          setProposals((prev) => prev.filter((p) => p.id !== id));
          setLeavingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, LEAVE_MS);

        if (decision === "accept") {
          showToast("Zmiana wprowadzona.");
          // An accepted change can add or retire an insight, so the list is refetched.
          fetchInsights();
        } else {
          showToast("Zostawiam bez zmian.");
        }
      } catch (err) {
        haptic.error();
        showToast(err instanceof Error ? err.message : "Nie udało się zapisać decyzji.");
      } finally {
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [busyIds, fetchInsights, showToast],
  );

  /* ---------------- Derived ---------------- */

  const grouped = useMemo(() => {
    const map = new Map<string, Insight[]>();
    for (const i of insights) {
      const list = map.get(i.kind) ?? [];
      list.push(i);
      map.set(i.kind, list);
    }
    return map;
  }, [insights]);

  /** Kinds the app has never heard of still get a section, at the end. */
  const extraKinds = useMemo(
    () => [...grouped.keys()].filter((k) => !SECTIONS.some((s) => s.kind === k)),
    [grouped],
  );

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
          „To nieprawda” i zniknie z pamięci mentorów. Możesz też dopisać własny wniosek,
          a aplikacja zapyta, czy poprawić resztę danych.
        </p>
      </header>

      {/* ---------------- Add own note (always reachable) ---------------- */}
      <Button variant="primary" size="md" fullWidth onPress={() => setShowAdd(true)}>
        + Dodaj własny wniosek
      </Button>

      {/* ---------------- Agent working ---------------- */}
      {analyzing && (
        <Card padding="md">
          <div style={{ display: "flex", alignItems: "center", gap: T.sp3 }}>
            <span
              aria-hidden="true"
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: `2px solid ${T.primary}`,
                borderTopColor: "transparent",
                animation: "ins-spin 0.8s linear infinite",
                flexShrink: 0,
              }}
            />
            <span style={{ ...TYPO.callout, color: T.text2 }}>
              Czytam Twój wpis i sprawdzam, co powinno się zmienić. Nic nie zmieniam bez
              Twojej zgody.
            </span>
          </div>
        </Card>
      )}

      {/* ---------------- Pending proposals ---------------- */}
      {proposals.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
          <div style={{ padding: `0 ${T.sp1}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: T.sp2 }}>
              <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
                🔔
              </span>
              <span style={{ ...TYPO.label, color: T.text3 }}>Do potwierdzenia</span>
              <span
                className="num"
                style={{ ...TYPO.footnote, fontWeight: 600, color: T.text4 }}
              >
                {proposals.length}
              </span>
            </div>
            <p style={{ ...TYPO.footnote, color: T.text3, margin: `${T.sp1} 0 0` }}>
              Dopóki nie klikniesz „Tak, zmień”, w Twoich danych nic się nie zmienia.
            </p>
          </div>

          {proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              busy={busyIds.has(proposal.id)}
              leaving={leavingIds.has(proposal.id)}
              onAccept={() => decide(proposal.id, "accept")}
              onReject={() => decide(proposal.id, "reject")}
            />
          ))}
        </section>
      )}

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
        [
          ...SECTIONS,
          ...extraKinds.map((kind) => ({
            kind,
            label: kind,
            icon: "🧩",
            hint: "Nowy rodzaj wniosku.",
          })),
        ].map((section) => {
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
            Zapisz
          </Button>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: T.sp4, paddingBottom: T.sp4 }}>
          <p style={{ ...TYPO.callout, color: T.text2, margin: 0 }}>
            Napisz, co się zmieniło. Na przykład: „Zdałem egzamin na karate”. Wpis trafia
            do pamięci wszystkich mentorów z najwyższą wagą.
          </p>

          <VoiceTextarea
            value={newContent}
            onChange={setNewContent}
            minHeight={140}
            disabled={adding}
            placeholder="np. Zdałem egzamin na karate, więc ten cel jest już zamknięty."
          />

          <p style={{ ...TYPO.footnote, color: T.text3, margin: 0 }}>
            Po zapisaniu aplikacja sprawdzi, czy trzeba poprawić Twoje cele, nawyki albo
            starsze wnioski. Każdą zmianę pokaże Ci do zatwierdzenia. Nic nie zniknie bez
            Twojej zgody.
          </p>
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
            // Above the Sheet (300) and parked over the sheet footer button.
            // Non-interactive by nature, so it must never eat a tap.
            pointerEvents: "none",
            maxWidth: "90vw",
            textAlign: "center",
          }}
        >
          {toast}
        </div>
      )}

      <style>{`
        @keyframes ins-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Proposal card                                                      */
/* ------------------------------------------------------------------ */

function ProposalCard({
  proposal,
  busy,
  leaving,
  onAccept,
  onReject,
}: {
  proposal: Proposal;
  busy: boolean;
  leaving: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const entityLabel = ENTITY_LABEL[proposal.entity] ?? "Dane";
  const tone = TONE.accent;

  return (
    <div
      style={{
        // Visibility comes from the prop, never from state set during render.
        opacity: leaving ? 0 : 1,
        transform: leaving ? "translateY(-6px) scale(0.98)" : "none",
        transition: `opacity ${LEAVE_MS}ms ease, transform ${LEAVE_MS}ms ease`,
        pointerEvents: leaving ? "none" : undefined,
      }}
    >
      <Card padding="md" style={{ borderColor: T.borderAccent }}>
        <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
          <span
            style={{
              ...TYPO.footnote,
              fontWeight: 700,
              color: tone.fg,
              background: tone.soft,
              border: `1px solid ${tone.fill}`,
              borderRadius: T.rFull,
              padding: "4px 10px",
              alignSelf: "flex-start",
            }}
          >
            {entityLabel}
          </span>

          <p style={{ ...TYPO.body, color: T.text, margin: 0 }}>{proposal.summary}</p>

          <p style={{ ...TYPO.footnote, color: T.text3, margin: 0 }}>
            Nic jeszcze nie zostało zmienione.
          </p>

          <div style={{ display: "flex", gap: T.sp2 }}>
            <Button
              variant="primary"
              size="md"
              fullWidth
              loading={busy}
              onPress={onAccept}
              ariaLabel={`Zaakceptuj zmianę: ${proposal.summary}`}
            >
              Tak, zmień
            </Button>
            <Button
              variant="secondary"
              size="md"
              fullWidth
              disabled={busy}
              onPress={onReject}
              ariaLabel={`Odrzuć zmianę: ${proposal.summary}`}
            >
              Nie, zostaw
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Insight card                                                       */
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
  const isOwn = insight.origin === "user";
  const ownColors = TONE.primary;

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
              display: "flex",
              gap: T.sp2,
              flexShrink: 0,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {/* Who wrote it matters more than how sure the app is, so it comes first. */}
            {isOwn && (
              <span
                style={{
                  ...TYPO.footnote,
                  fontWeight: 700,
                  color: ownColors.fg,
                  background: ownColors.soft,
                  border: `1px solid ${ownColors.fill}`,
                  borderRadius: T.rFull,
                  padding: "4px 10px",
                  whiteSpace: "nowrap",
                }}
              >
                Twój wpis
              </span>
            )}
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
              }}
            >
              {label}
            </span>
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
