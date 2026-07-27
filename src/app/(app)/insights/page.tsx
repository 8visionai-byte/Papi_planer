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
 *  2. Restructuring with consent. The user writes a note about themselves ("zdalem
 *     karate"), the memory agent reads it and PROPOSES what should change in their
 *     goals, insights, habits or profile. Those proposals sit at the top of the
 *     screen as plain Polish sentences with two buttons. Until one is confirmed,
 *     absolutely nothing in the data has moved.
 *
 * Owner feedback (2026-07-27): the queue was readable but not obvious. He had to
 * think hard about whether a card meant "save", "correct" or "stop showing". So
 * every card now opens with ONE word for the kind of change (Zapisze / Zmienie /
 * Schowam), carries a sentence about what he will actually notice, and the promise
 * "Nic sie nie zmieni, dopoki nie klikniesz" sits above the list at all times.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /**
   * One sentence about what the user will notice after saying yes. Written by the
   * memory agent. Optional on purpose: rows created before that field existed do
   * not have it, and the card must still make sense without it.
   */
  skutek?: string | null;
  status: string;
  createdAt: string;
  /** Raw field patch. Read only as a fallback hiding place for `skutek`. */
  payload?: unknown;
}

/* ------------------------------------------------------------------ */
/*  What kind of change a card is                                      */
/* ------------------------------------------------------------------ */

/**
 * Three kinds, in the user's own words. The server vocabulary (create / update /
 * deactivate) never reaches the screen: "deactivate" told him nothing, "Schowam"
 * tells him everything he needs before tapping.
 */
type ChangeKind = "add" | "edit" | "hide";

const KIND_ORDER: readonly ChangeKind[] = ["add", "edit", "hide"];

const KIND_META: Record<
  ChangeKind,
  { label: string; icon: string; tone: { fg: string; fill: string; soft: string }; meaning: string }
> = {
  add: {
    label: "Zapiszę",
    icon: "➕",
    tone: TONE.success,
    meaning: "Nowa rzecz w pamięci aplikacji. Nic starego nie znika.",
  },
  edit: {
    label: "Zmienię",
    icon: "✏️",
    tone: TONE.accent,
    meaning: "Poprawka czegoś, co już jest zapisane.",
  },
  hide: {
    label: "Schowam",
    icon: "📦",
    tone: TONE.warning,
    meaning: "To przestanie się pokazywać. Nic nie kasuję, zostaje w historii.",
  },
};

/**
 * Fallback sentence when the agent did not send its own. Every card has to answer
 * "co z tego wyniknie", so a generic honest answer beats an empty space.
 */
const KIND_FALLBACK_EFFECT: Record<ChangeKind, string> = {
  add: "Po kliknięciu ta rzecz będzie w pamięci aplikacji i mentorzy będą ją znali.",
  edit: "Po kliknięciu poprawię ten wpis. Poprzednia wersja zostaje w historii.",
  hide: "Po kliknięciu to przestanie się pokazywać. Nic nie kasuję.",
};

function changeKindOf(action: string): ChangeKind {
  if (action === "create") return "add";
  if (action === "deactivate") return "hide";
  // Anything else, including an action this screen has never heard of, is a
  // correction of existing data. That is the honest reading of an unknown verb.
  return "edit";
}

/** Genitive forms, so the card can say "dotyczy celu" and not "dotyczy cel". */
const ENTITY_GENITIVE: Record<string, string> = {
  goal: "celu",
  insight: "wniosku",
  habit: "nawyku",
  profile: "Twojego profilu",
  // Added together with the two new card types in the memory agent. Without them the
  // card that switches off a weekly plan showed no "dotyczy" line at all, so the only
  // thing saying what it touched was the sentence itself.
  mentorPlan: "planu od mentora",
  mentor: "opisu mentora",
};

/** How long the card stays mounted while it fades out. Matches the transition below. */
const LEAVE_MS = 260;

/** Where the "what you will notice" sentence can arrive under. Order = priority. */
const EFFECT_KEYS = ["skutek", "effect", "impact", "consequence"] as const;

function pickString(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/**
 * Reads the effect sentence defensively. The model side of this feature ships
 * separately, so the field may sit on the row, may sit inside the payload blob,
 * or may not exist at all on older rows. All three cases end with a readable card.
 */
function readEffect(proposal: Proposal): string {
  const kind = changeKindOf(proposal.action);
  const direct = pickString(proposal as unknown as Record<string, unknown>, EFFECT_KEYS);
  const payload = proposal.payload;
  const nested =
    !direct && payload && typeof payload === "object" && !Array.isArray(payload)
      ? pickString(payload as Record<string, unknown>, EFFECT_KEYS)
      : null;

  const found = direct ?? nested;
  if (!found) return KIND_FALLBACK_EFFECT[kind];
  // A repeat of the main sentence is noise, not an explanation.
  if (found.toLowerCase() === proposal.summary.trim().toLowerCase()) {
    return KIND_FALLBACK_EFFECT[kind];
  }
  return found;
}

/* ------------------------------------------------------------------ */
/*  Insight sections                                                   */
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

/** Polish counting: 1 pytanie, 2-4 pytania, 5+ pytań. */
function questionCountLabel(n: number): string {
  if (n === 1) return "1 pytanie";
  const last = n % 10;
  const lastTwo = n % 100;
  const many = last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14);
  return many ? `${n} pytania` : `${n} pytań`;
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
  /** Which group is being accepted in one go. Null = no bulk run. */
  const [bulkKind, setBulkKind] = useState<ChangeKind | null>(null);
  /** `at` keeps two identical messages distinct, so the hide timer restarts. */
  const [toast, setToast] = useState<{ text: string; at: number } | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);
  /** The agent is reading the fresh note. Takes a few seconds, so it gets a banner. */
  const [analyzing, setAnalyzing] = useState(false);
  /**
   * Result of the last note, kept on screen instead of only in a toast. The owner
   * said he could not tell whether anything had happened after saving a note.
   */
  const [lastRun, setLastRun] = useState<{ count: number; failed: boolean } | null>(null);

  /**
   * Ids with a decision in flight. A ref, not state: two taps inside one render
   * would both read the same stale state and both fire a request.
   */
  const inFlight = useRef<Set<string>>(new Set());

  const showToast = useCallback((message: string) => {
    setToast({ text: message, at: Date.now() });
  }, []);

  // One timer owned by the toast itself: a new message replaces the old one and
  // gets its own full three seconds, instead of inheriting the previous countdown.
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);

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
        showToast("Schowane. Aplikacja już tego nie użyje.");
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

  const openAdd = useCallback(() => {
    // The previous result belongs to the previous note, so it goes away here.
    setLastRun(null);
    setShowAdd(true);
  }, []);

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
      setLastRun(null);
      try {
        const pr = await fetch("/api/proposals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceText: content }),
        });
        if (!pr.ok) throw new Error("proposals failed");
        const pj: { proposals: Proposal[] } = await pr.json();
        const fresh = pj.proposals ?? [];
        setLastRun({ count: fresh.length, failed: false });
        if (fresh.length > 0) {
          setProposals((prev) => [...fresh, ...prev]);
          haptic.warning();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      } catch {
        setLastRun({ count: 0, failed: true });
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

  /** Bare network call. No haptics, no toast, so bulk and single share it. */
  const sendDecision = useCallback(async (id: string, decision: "accept" | "reject") => {
    const res = await fetch(`/api/proposals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) {
      const json: { error?: string } = await res.json().catch(() => ({}));
      throw new Error(json.error || "Nie udało się zapisać decyzji.");
    }
  }, []);

  /**
   * Fade first, unmount after. Removing the row on the same tick would make the card
   * vanish and the list jump, which reads like a bug rather than like a decision.
   */
  const removeCards = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    setLeavingIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    setTimeout(() => {
      setProposals((prev) => prev.filter((p) => !gone.has(p.id)));
      setLeavingIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }, LEAVE_MS);
  }, []);

  const decide = useCallback(
    async (id: string, decision: "accept" | "reject") => {
      if (inFlight.current.has(id)) return;
      inFlight.current.add(id);
      setBusyIds((prev) => new Set(prev).add(id));
      try {
        await sendDecision(id, decision);

        if (decision === "accept") haptic.success();
        else haptic.tap();

        removeCards([id]);

        if (decision === "accept") {
          showToast("Zapisane.");
          // An accepted change can add or retire an insight, so the list is refetched.
          fetchInsights();
        } else {
          showToast("Zostawione bez zmian.");
        }
      } catch (err) {
        haptic.error();
        showToast(err instanceof Error ? err.message : "Nie udało się zapisać decyzji.");
      } finally {
        inFlight.current.delete(id);
        setBusyIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [fetchInsights, removeCards, sendDecision, showToast],
  );

  /**
   * Accept a whole group at once. Offered only for "Zapisze", because that group
   * only adds new memory: nothing existing is touched, so one tap is safe there.
   * "Zmienie" and "Schowam" stay one by one on purpose.
   */
  const acceptGroup = useCallback(
    async (kind: ChangeKind, ids: string[]) => {
      if (bulkKind) return;
      const todo = ids.filter((id) => !inFlight.current.has(id));
      if (todo.length === 0) return;

      for (const id of todo) inFlight.current.add(id);
      setBulkKind(kind);
      setBusyIds((prev) => {
        const next = new Set(prev);
        for (const id of todo) next.add(id);
        return next;
      });

      const done: string[] = [];
      let failed = 0;
      // One at a time: each accept is its own transaction on the server, and a
      // burst of parallel writes would only make a partial failure harder to read.
      for (const id of todo) {
        try {
          await sendDecision(id, "accept");
          done.push(id);
        } catch {
          failed += 1;
        }
      }

      if (done.length > 0) {
        haptic.success();
        removeCards(done);
        fetchInsights();
      }
      if (failed > 0) {
        haptic.error();
        showToast("Część się nie zapisała. Spróbuj jeszcze raz.");
      } else {
        showToast("Zapisane.");
      }

      for (const id of todo) inFlight.current.delete(id);
      setBusyIds((prev) => {
        const next = new Set(prev);
        for (const id of todo) next.delete(id);
        return next;
      });
      setBulkKind(null);
    },
    [bulkKind, fetchInsights, removeCards, sendDecision, showToast],
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

  /** Proposals split into Zapisze / Zmienie / Schowam, in that order. */
  const proposalGroups = useMemo(() => {
    const buckets = new Map<ChangeKind, Proposal[]>();
    for (const p of proposals) {
      const kind = changeKindOf(p.action);
      const list = buckets.get(kind) ?? [];
      list.push(p);
      buckets.set(kind, list);
    }
    return KIND_ORDER.filter((k) => (buckets.get(k)?.length ?? 0) > 0).map((k) => ({
      kind: k,
      items: buckets.get(k) as Proposal[],
    }));
  }, [proposals]);

  /**
   * Below four cards the flat list is easier to read than any grouping. From four
   * up, the headings also unlock the one bulk button ("Zapisze"), which is exactly
   * where a long queue starts to hurt.
   */
  const useGroups = proposals.length > 3;

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
          To, czego aplikacja nauczyła się o Tobie. Jeśli coś się nie zgadza, kliknij
          „To nieprawda”, a zniknie z pamięci mentorów. Możesz też dopisać coś od siebie.
        </p>
      </header>

      {/* ---------------- Add own note (always reachable) ---------------- */}
      <Button variant="primary" size="md" fullWidth onPress={openAdd}>
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
              Czytam Twój wpis i sprawdzam, co z niego wynika. Nic nie zmieniam bez Twojego
              kliknięcia.
            </span>
          </div>
        </Card>
      )}

      {/* ---------------- What came out of the last note ---------------- */}
      {!analyzing && lastRun && (
        <Card padding="md" className="anim-in">
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
            <p style={{ ...TYPO.callout, color: T.text, margin: 0 }}>
              {lastRun.failed
                ? "Twój wpis jest zapisany. Nie udało mi się sprawdzić, co z niego wynika. Nic nie zostało zmienione."
                : lastRun.count === 0
                  ? "Twój wpis jest zapisany. Nic innego nie trzeba zmieniać."
                  : `Twój wpis jest zapisany. Mam z niego ${questionCountLabel(lastRun.count)} do Ciebie, niżej. Nic się nie zmieni, dopóki nie klikniesz.`}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onPress={() => setLastRun(null)}
              ariaLabel="Ukryj informację o ostatnim wpisie"
            >
              Rozumiem
            </Button>
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
                style={{ ...TYPO.footnote, fontWeight: 600, color: T.text3 }}
              >
                {proposals.length}
              </span>
            </div>
          </div>

          {/* The promise the owner was given, on screen for as long as the queue is. */}
          <div
            style={{
              background: TONE.primary.soft,
              border: `1px solid ${T.borderAccent}`,
              borderRadius: T.rMd,
              padding: `${T.sp3} ${T.sp4}`,
            }}
          >
            <p
              style={{
                ...TYPO.callout,
                fontWeight: 600,
                color: T.primaryOnSurface,
                margin: 0,
              }}
            >
              Nic się nie zmieni, dopóki nie klikniesz.
            </p>
          </div>

          {useGroups
            ? proposalGroups.map((group) => {
                const meta = KIND_META[group.kind];
                const ids = group.items.map((p) => p.id);
                // Bulk yes only for the group that adds new memory and touches nothing.
                const canAcceptAll = group.kind === "add" && group.items.length > 1;
                return (
                  <div
                    key={group.kind}
                    style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}
                  >
                    <div style={{ padding: `${T.sp2} ${T.sp1} 0` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: T.sp2 }}>
                        <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
                          {meta.icon}
                        </span>
                        <span style={{ ...TYPO.title3, color: T.text }}>{meta.label}</span>
                        <span
                          className="num"
                          style={{ ...TYPO.footnote, fontWeight: 600, color: T.text3 }}
                        >
                          {group.items.length}
                        </span>
                      </div>
                      <p style={{ ...TYPO.footnote, color: T.text3, margin: `${T.sp1} 0 0` }}>
                        {meta.meaning}
                      </p>
                    </div>

                    {group.items.map((proposal) => (
                      <ProposalCard
                        key={proposal.id}
                        proposal={proposal}
                        busy={busyIds.has(proposal.id)}
                        leaving={leavingIds.has(proposal.id)}
                        onAccept={() => decide(proposal.id, "accept")}
                        onReject={() => decide(proposal.id, "reject")}
                      />
                    ))}

                    {canAcceptAll && (
                      <Button
                        variant="secondary"
                        size="md"
                        fullWidth
                        loading={bulkKind === group.kind}
                        disabled={bulkKind !== null && bulkKind !== group.kind}
                        onPress={() => acceptGroup(group.kind, ids)}
                        ariaLabel={`Przyjmij wszystkie z grupy ${meta.label}`}
                      >
                        Przyjmij wszystkie z tej grupy
                      </Button>
                    )}
                  </div>
                );
              })
            : proposals.map((proposal) => (
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
            action={{ label: "Dodaj własny wniosek", onPress: openAdd }}
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
                    style={{ ...TYPO.footnote, fontWeight: 600, color: T.text3 }}
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
        title="Napisz, co się zmieniło"
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
            Napisz, co się zmieniło. Aplikacja sprawdzi, co z tego wynika, i zapyta, zanim
            cokolwiek ruszy.
          </p>

          <VoiceTextarea
            value={newContent}
            onChange={setNewContent}
            minHeight={140}
            disabled={adding}
            placeholder="np. Zdałem egzamin na karate, więc ten cel jest już zamknięty."
          />

          <p style={{ ...TYPO.footnote, color: T.text3, margin: 0 }}>
            Twój wpis trafia do pamięci wszystkich mentorów z najwyższą wagą. Jeśli z niego
            wyniknie coś jeszcze, zobaczysz to zaraz po zapisaniu jako pytania do kliknięcia.
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
          {toast.text}
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
  const kind = changeKindOf(proposal.action);
  const meta = KIND_META[kind];
  const area = ENTITY_GENITIVE[proposal.entity];
  const effect = readEffect(proposal);

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
          {/* One word for the kind of change, read before anything else. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: T.sp2,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                ...TYPO.footnote,
                fontWeight: 700,
                color: meta.tone.fg,
                background: meta.tone.soft,
                border: `1px solid ${meta.tone.fill}`,
                borderRadius: T.rFull,
                padding: "4px 10px",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              <span aria-hidden="true">{meta.icon}</span>
              {meta.label}
            </span>
            {area && (
              <span style={{ ...TYPO.footnote, color: T.text3 }}>dotyczy {area}</span>
            )}
          </div>

          <p style={{ ...TYPO.body, color: T.text, margin: 0 }}>{proposal.summary}</p>

          <p style={{ ...TYPO.callout, color: T.text2, margin: 0 }}>{effect}</p>

          {/* Stacked, not side by side: full width each, and no label ever truncates. */}
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
            <Button
              variant="primary"
              size="md"
              fullWidth
              loading={busy}
              haptic="impact"
              onPress={onAccept}
              ariaLabel={`Tak, zrób to: ${proposal.summary}`}
            >
              Tak, zrób to
            </Button>
            <Button
              variant="secondary"
              size="md"
              fullWidth
              disabled={busy}
              haptic="tap"
              onPress={onReject}
              ariaLabel={`Nie, zostaw jak jest: ${proposal.summary}`}
            >
              Nie, zostaw jak jest
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
