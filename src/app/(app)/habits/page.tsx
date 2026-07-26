"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import VoiceInput from "@/components/forms/VoiceInput";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import { useBroadcastChannel } from "@/hooks/useBroadcastChannel";
import { haptic } from "@/lib/haptics";
import {
  Button,
  Card,
  EmptyState,
  Field,
  ListRow,
  Pressable,
  Sheet,
  Skeleton,
  T,
  TYPO,
  fieldControlStyle,
  fieldTextareaStyle,
} from "@/components/ui";
import { AnimatedNumber, Reveal } from "@/components/motion";
// TYPE-ONLY import: habit-coach pulls in the Anthropic SDK, which must never reach
// the client bundle. `import type` is erased at compile time.
import type { HabitKind, HabitLoopSuggestion } from "@/lib/ai/habit-coach";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TimeOfDay = "morning" | "afternoon" | "evening" | "any";

interface HabitData {
  id: string;
  name: string;
  description: string | null;
  timeOfDay: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  /* Habit loop. All optional and nullable: habits created before these columns
     existed come back without them, and the row has to survive that. */
  cue?: string | null;
  routine?: string | null;
  reward?: string | null;
  why?: string | null;
  identity?: string | null;
  kind?: string | null;
  replaces?: string | null;
}

interface HabitsResponse {
  habits: HabitData[];
  todayCompletions: Record<string, boolean>;
}

interface HabitStat {
  id: string;
  name: string;
  last7Days: boolean[];
  streak: number;
  completionRate30d: number;
}

interface StatsResponse {
  habits: HabitStat[];
}

/** Everything the add sheet and the edit sheet edit, in one object. */
interface HabitFormValues {
  name: string;
  description: string;
  timeOfDay: TimeOfDay;
  kind: HabitKind;
  replaces: string;
  cue: string;
  reward: string;
  why: string;
  identity: string;
  /**
   * The middle of the loop line. It has no field of its own on purpose: the user
   * already typed the habit name, and the row falls back to that name. The coach
   * fills it when it phrases the routine more precisely than the name does.
   */
  routine: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SECTIONS: { key: TimeOfDay; label: string; icon: string }[] = [
  { key: "morning", label: "Rano", icon: "🌅" },
  { key: "afternoon", label: "Popołudnie", icon: "☀️" },
  { key: "evening", label: "Wieczór", icon: "🌙" },
  { key: "any", label: "Inne", icon: "📌" },
];

const TIME_KEYS: TimeOfDay[] = SECTIONS.map((s) => s.key);

const KIND_OPTIONS: { key: HabitKind; label: string }[] = [
  { key: "build", label: "Nowy nawyk" },
  { key: "replace", label: "Zastępuje stary" },
];

/** Same ceiling the API enforces, so nothing is silently cut off after saving. */
const MAX_FIELD = 500;

const EMPTY_FORM: HabitFormValues = {
  name: "",
  description: "",
  timeOfDay: "any",
  kind: "build",
  replaces: "",
  cue: "",
  reward: "",
  why: "",
  identity: "",
  routine: "",
};

/** Polish weekday short names, indexed by Date.getDay() (0 = Sunday). */
const WEEKDAY_SHORT = ["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "So"];

/**
 * Labels under the 7-day heatmap, oldest first (index 0 = 6 days ago).
 * Only ever called after the stats fetch resolves, so there is no SSR/CSR mismatch.
 */
function last7DayLabels(): string[] {
  const today = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    return WEEKDAY_SHORT[d.getDay()];
  });
}

/** Loads an existing habit into the form so editing never starts from blanks. */
function formFromHabit(h: HabitData): HabitFormValues {
  const time = TIME_KEYS.includes(h.timeOfDay as TimeOfDay)
    ? (h.timeOfDay as TimeOfDay)
    : "any";
  return {
    name: h.name,
    description: h.description ?? "",
    timeOfDay: time,
    kind: h.kind === "replace" ? "replace" : "build",
    replaces: h.replaces ?? "",
    cue: h.cue ?? "",
    reward: h.reward ?? "",
    why: h.why ?? "",
    identity: h.identity ?? "",
    routine: h.routine ?? "",
  };
}

/**
 * Body for POST and PATCH.
 *
 * Empty strings are sent on purpose rather than omitted: the API reads "" as "clear
 * this column", which is what a user emptying a field in a controlled form means.
 * `replaces` is only sent filled for a "replace" habit; the API clears it anyway for
 * a "build" habit, this just keeps the two sides saying the same thing.
 */
function habitPayload(v: HabitFormValues) {
  return {
    name: v.name.trim(),
    description: v.description.trim() || null,
    timeOfDay: v.timeOfDay,
    kind: v.kind,
    replaces: v.kind === "replace" ? v.replaces.trim() : "",
    cue: v.cue.trim(),
    routine: v.routine.trim(),
    reward: v.reward.trim(),
    why: v.why.trim(),
    identity: v.identity.trim(),
  };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function HabitsPage() {
  const [habits, setHabits] = useState<HabitData[]>([]);
  const [todayCompletions, setTodayCompletions] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<HabitStat[]>([]);
  const [loading, setLoading] = useState(true);
  /** True when the last read of /api/habits failed. Keeps "no habits" honest. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<HabitFormValues>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<HabitFormValues>(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);
  /** Two-step delete inside the edit sheet: no nested sheet, no native confirm(). */
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Guards the destructive button against a double tap firing two DELETE calls. */
  const [deleting, setDeleting] = useState(false);

  /** Which row has its "po co" panel open. One at a time keeps the list scannable. */
  const [expandedWhyId, setExpandedWhyId] = useState<string | null>(null);

  const [toast, setToast] = useState<string | null>(null);

  const postHabitEvent = useBroadcastChannel("papicoach:habits");

  const fetchHabits = useCallback(async () => {
    try {
      const res = await fetch("/api/habits");
      if (res.ok) {
        const json: HabitsResponse = await res.json();
        setHabits(json.habits);
        setTodayCompletions(json.todayCompletions);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    } catch {
      // Offline or the request died. Remembered on purpose: without it the screen
      // shows "you have no habits yet" to someone who has plenty, and the obvious
      // reaction is to add them a second time.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/habits/stats");
      if (res.ok) {
        const json: StatsResponse = await res.json();
        setStats(json.habits);
      }
    } catch {
      // ignore
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHabits();
    fetchStats();
  }, [fetchHabits, fetchStats]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        fetchHabits();
        fetchStats();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [fetchHabits, fetchStats]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  /** Second chance after a failed read: skeleton first, then both fetches again. */
  const retryLoad = () => {
    setLoading(true);
    setStatsLoading(true);
    fetchHabits();
    fetchStats();
  };

  const toggleHabit = async (habitId: string) => {
    if (togglingIds.has(habitId)) return;
    setTogglingIds((prev) => new Set(prev).add(habitId));

    const prevCompleted = todayCompletions[habitId] ?? false;

    // Confirm the touch immediately, before the network call. Ticking something off
    // deserves the success pattern, un-ticking only a plain tap.
    if (prevCompleted) haptic.tap();
    else haptic.success();

    setTodayCompletions((prev) => ({ ...prev, [habitId]: !prevCompleted }));

    try {
      const res = await fetch("/api/habits/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habitId }),
      });
      if (!res.ok) {
        haptic.error();
        setTodayCompletions((prev) => ({ ...prev, [habitId]: prevCompleted }));
      } else {
        const json = await res.json();
        setTodayCompletions((prev) => ({ ...prev, [habitId]: json.completed }));
        postHabitEvent({ type: "habit-toggled", habitId, completed: json.completed });
        // Refresh stats in background
        fetchStats();
      }
    } catch {
      haptic.error();
      setTodayCompletions((prev) => ({ ...prev, [habitId]: prevCompleted }));
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(habitId);
        return next;
      });
    }
  };

  const toggleWhy = (habitId: string) => {
    setExpandedWhyId((prev) => (prev === habitId ? null : habitId));
  };

  const closeAdd = () => {
    setShowAdd(false);
    setAddForm(EMPTY_FORM);
  };

  const addHabit = async () => {
    if (!addForm.name.trim() || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(habitPayload(addForm)),
      });
      if (res.ok) {
        const habit: HabitData = await res.json();
        setHabits((prev) => [...prev, habit]);
        setTodayCompletions((prev) => ({ ...prev, [habit.id]: false }));
        haptic.success();
        closeAdd();
        showToast("Nawyk dodany!");
        fetchStats();
        postHabitEvent({ type: "habit-created", habitId: habit.id });
      } else {
        const err = await res.json().catch(() => ({}));
        haptic.error();
        showToast(err.error || "Błąd dodawania");
      }
    } catch {
      haptic.error();
      showToast("Błąd dodawania");
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (h: HabitData) => {
    setEditingId(h.id);
    setEditForm(formFromHabit(h));
    setConfirmDelete(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setConfirmDelete(false);
  };

  const saveEdit = async () => {
    if (!editingId || !editForm.name.trim() || savingEdit) return;
    setSavingEdit(true);
    try {
      const res = await fetch("/api/habits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, ...habitPayload(editForm) }),
      });
      if (res.ok) {
        const updated: HabitData = await res.json();
        setHabits((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
        haptic.success();
        cancelEdit();
        showToast("Zapisano");
        fetchStats();
      } else {
        // A rejected save used to end in silence: spinner off, sheet still open, no
        // way to tell a saved habit from a lost one.
        const err = await res.json().catch(() => ({}));
        haptic.error();
        showToast(err.error || "Błąd zapisu");
      }
    } catch {
      haptic.error();
      showToast("Błąd zapisu");
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteHabit = async (id: string) => {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/habits", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setHabits((prev) => prev.filter((h) => h.id !== id));
        setExpandedWhyId((prev) => (prev === id ? null : prev));
        haptic.warning();
        cancelEdit();
        showToast("Nawyk usunięty");
        postHabitEvent({ type: "habit-deleted", habitId: id });
        fetchStats();
      } else {
        haptic.error();
        showToast("Błąd usuwania");
      }
    } catch {
      haptic.error();
      showToast("Błąd usuwania");
    } finally {
      setDeleting(false);
    }
  };

  // Group habits by section
  const grouped: Record<TimeOfDay, HabitData[]> = {
    morning: [],
    afternoon: [],
    evening: [],
    any: [],
  };
  for (const h of habits) {
    const key = (h.timeOfDay as TimeOfDay) ?? "any";
    if (key in grouped) grouped[key].push(h);
    else grouped.any.push(h);
  }

  const completedToday = habits.filter((h) => todayCompletions[h.id]).length;
  const totalToday = habits.length;
  const dayPct = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : 0;
  const allDone = totalToday > 0 && completedToday === totalToday;

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
        <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Codzienne rytuały</div>
        <h1 style={{ ...TYPO.title1, fontWeight: 800, color: T.text, margin: 0 }}>Nawyki</h1>
        <p style={{ ...TYPO.callout, color: T.text2, margin: `${T.sp1} 0 0` }}>
          Małe rzeczy powtarzane codziennie budują formę.
        </p>
      </header>

      {/* ---------------- Hero: dzisiejszy wynik ---------------- */}
      {!loading && totalToday > 0 && (
        <section className="card-hero anim-in" style={{ animationDelay: "60ms" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: T.sp3 }}>
            <div style={{ minWidth: 0 }}>
              <AnimatedNumber
                value={dayPct}
                unit="%"
                duration={800}
                className="hero-num"
                style={{ color: T.text }}
                unitStyle={{ fontSize: 20, fontWeight: 700, color: T.text3 }}
              />
              <div style={{ ...TYPO.callout, color: T.text2, marginTop: T.sp2 }}>
                {completedToday} z {totalToday}{" "}
                {totalToday === 1 ? "nawyku zrobione" : "nawyków zrobionych"} dziś
              </div>
            </div>
            {allDone && (
              <span
                className="anim-pop"
                style={{
                  ...TYPO.footnote,
                  fontWeight: 700,
                  color: T.successOnSurface,
                  background: T.successSoft,
                  border: `1px solid ${T.success}`,
                  borderRadius: T.rFull,
                  padding: "6px 12px",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                }}
              >
                Komplet
              </span>
            )}
          </div>

          {/* progress bar: gradient fill, scaleX only (never width) */}
          <div
            role="progressbar"
            aria-valuenow={dayPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Postęp nawyków na dziś"
            style={{
              marginTop: T.sp5,
              height: 10,
              borderRadius: T.rFull,
              background: T.surface3,
              overflow: "hidden",
            }}
          >
            <div
              className="anim-bar"
              style={{
                width: `${Math.max(dayPct, 2)}%`,
                height: "100%",
                borderRadius: T.rFull,
                background: "var(--grad-accent)",
                boxShadow: "var(--glow-accent-soft)",
                transition: `width 720ms var(--ease-out)`,
              }}
            />
          </div>
        </section>
      )}

      {/* ---------------- Loading ---------------- */}
      {loading && (
        <Card padding="md">
          <Skeleton variant="list" count={4} />
        </Card>
      )}

      {/* ---------------- Empty ---------------- */}
      {!loading && habits.length === 0 && (
        <Card padding="none" className="anim-in">
          {loadFailed ? (
            <EmptyState
              icon="📡"
              title="Nie udało się wczytać nawyków"
              body="Sprawdź połączenie i spróbuj jeszcze raz. Twoje nawyki są zapisane, nic nie zginęło."
              tone="warning"
              action={{ label: "Spróbuj ponownie", onPress: retryLoad }}
            />
          ) : (
            <EmptyState
              icon="🌱"
              title="Nie masz jeszcze nawyków"
              body="Dodaj pierwszy rytuał i zacznij odhaczać go codziennie."
              action={{ label: "Dodaj nawyk", onPress: () => setShowAdd(true) }}
            />
          )}
        </Card>
      )}

      {/* ---------------- Sections ---------------- */}
      {!loading &&
        habits.length > 0 &&
        SECTIONS.map((section) => {
          const items = grouped[section.key];
          if (items.length === 0) return null;
          const sectionDone = items.filter((h) => todayCompletions[h.id]).length;
          return (
            <section
              key={section.key}
              style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: T.sp3,
                  padding: `0 ${T.sp1}`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: T.sp2, minWidth: 0 }}>
                  <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
                    {section.icon}
                  </span>
                  <span style={{ ...TYPO.label, color: T.text3 }}>{section.label}</span>
                </div>
                <span
                  className="num"
                  style={{ ...TYPO.footnote, fontWeight: 600, color: T.text3, flexShrink: 0 }}
                >
                  {sectionDone}/{items.length}
                </span>
              </div>

              <Card padding="sm">
                <div style={{ display: "flex", flexDirection: "column", gap: T.sp1 }}>
                  {items.map((h) => {
                    const stat = stats.find((s) => s.id === h.id);
                    return (
                      <Reveal key={h.id} index={revealIndex++}>
                        <HabitRow
                          habit={h}
                          completed={todayCompletions[h.id] ?? false}
                          toggling={togglingIds.has(h.id)}
                          streak={stat?.streak ?? 0}
                          whyOpen={expandedWhyId === h.id}
                          onToggle={() => toggleHabit(h.id)}
                          onEdit={() => startEdit(h)}
                          onToggleWhy={() => toggleWhy(h.id)}
                        />
                      </Reveal>
                    );
                  })}
                </div>
              </Card>
            </section>
          );
        })}

      {/* ---------------- Add habit (secondary action, never a dashed box) ---------------- */}
      {!loading && habits.length > 0 && (
        <Button variant="secondary" size="md" fullWidth onPress={() => setShowAdd(true)}>
          + Dodaj nawyk
        </Button>
      )}

      {/* ---------------- Stats ---------------- */}
      {!loading && habits.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: T.sp2, padding: `0 ${T.sp1}` }}>
            <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>
              📊
            </span>
            <span style={{ ...TYPO.label, color: T.text3 }}>Ostatnie 7 dni</span>
          </div>

          <Card padding="md">
            {statsLoading ? (
              <Skeleton variant="list" count={3} />
            ) : stats.length === 0 ? (
              <div style={{ ...TYPO.callout, color: T.text3 }}>
                Statystyki pojawią się po pierwszym odhaczonym dniu.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: T.sp5 }}>
                {stats.map((s, i) => (
                  <StatRow key={s.id} stat={s} index={i} />
                ))}
              </div>
            )}
          </Card>
        </section>
      )}

      {/* ---------------- Add sheet ---------------- */}
      <Sheet
        open={showAdd}
        onClose={closeAdd}
        title="Nowy nawyk"
        footer={
          <div style={{ display: "flex", gap: T.sp2 }}>
            <Button variant="secondary" size="lg" onPress={closeAdd} disabled={adding}>
              Anuluj
            </Button>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={adding}
              disabled={!addForm.name.trim()}
              onPress={addHabit}
            >
              Dodaj nawyk
            </Button>
          </div>
        }
      >
        {/* key = a fresh form per opening: the coach tip and the "could not help"
            note are local state and must not survive into the next habit */}
        <HabitForm
          key={showAdd ? "add-open" : "add-closed"}
          values={addForm}
          onChange={(patch) => setAddForm((prev) => ({ ...prev, ...patch }))}
          disabled={adding}
          autoFocus
        />
      </Sheet>

      {/* ---------------- Edit sheet ---------------- */}
      <Sheet
        open={editingId !== null}
        onClose={cancelEdit}
        title="Edytuj nawyk"
        footer={
          <div style={{ display: "flex", gap: T.sp2 }}>
            <Button variant="secondary" size="lg" onPress={cancelEdit} disabled={savingEdit}>
              Anuluj
            </Button>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={savingEdit}
              disabled={!editForm.name.trim()}
              onPress={saveEdit}
            >
              Zapisz
            </Button>
          </div>
        }
      >
        {/* key = one form per edited habit, so a tip about habit A cannot linger
            under the coach button while habit B is open */}
        <HabitForm
          key={editingId ?? "edit-closed"}
          values={editForm}
          onChange={(patch) => setEditForm((prev) => ({ ...prev, ...patch }))}
          disabled={savingEdit}
        />

        <div className="divider" />

        {/* destructive action: two steps, never sitting next to the primary button */}
        {!confirmDelete ? (
          <Button variant="ghost" size="md" fullWidth onPress={() => setConfirmDelete(true)}>
            Usuń nawyk
          </Button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
            <div style={{ ...TYPO.footnote, color: T.text2 }}>
              Nawyk zniknie z listy. Historia wykonań zostanie zachowana.
            </div>
            <div style={{ display: "flex", gap: T.sp2 }}>
              <Button
                variant="secondary"
                size="md"
                fullWidth
                disabled={deleting}
                onPress={() => setConfirmDelete(false)}
              >
                Zostaw
              </Button>
              <Button
                variant="danger"
                size="md"
                fullWidth
                loading={deleting}
                onPress={() => {
                  if (editingId) deleteHabit(editingId);
                }}
              >
                Usuń na zawsze
              </Button>
            </div>
          </div>
        )}
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  HabitForm — shared by the add and the edit sheet                   */
/* ------------------------------------------------------------------ */

function HabitForm({
  values,
  onChange,
  disabled,
  autoFocus = false,
}: {
  values: HabitFormValues;
  onChange: (patch: Partial<HabitFormValues>) => void;
  disabled: boolean;
  autoFocus?: boolean;
}) {
  const [suggesting, setSuggesting] = useState(false);
  /** Calm message when the coach could not help. Never an error state. */
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);

  /**
   * Always the newest values, for reading AFTER an await.
   *
   * The coach answers in seconds. `values` captured when the button was pressed is
   * stale by then: whatever the user typed while waiting is still "empty" in that
   * copy, and pasting over it is exactly what "fill only the empty fields" forbids.
   */
  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  });

  const isReplace = values.kind === "replace";
  const canSuggest = values.name.trim().length > 0 && !disabled && !suggesting;

  /**
   * Asks the coach for the loop and fills ONLY the fields the user left empty.
   * Overwriting what someone already typed would be the fastest way to make them
   * stop pressing this button, so a filled field always wins.
   */
  const askCoach = async () => {
    if (!canSuggest) return;
    const requestedName = values.name.trim();
    setSuggesting(true);
    setSuggestNote(null);
    try {
      const res = await fetch("/api/habits/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: requestedName,
          description: values.description.trim() || null,
          timeOfDay: values.timeOfDay,
          kind: values.kind,
          replaces: isReplace ? values.replaces.trim() || null : null,
        }),
      });
      if (!res.ok) throw new Error("suggest failed");

      const json: { suggestion: HabitLoopSuggestion | null } = await res.json();
      const s = json.suggestion;
      if (!s) throw new Error("no suggestion");

      // The form may have moved on while the coach was thinking: the sheet was closed
      // and the values reset, or another habit is being edited. A suggestion written
      // for a habit that is no longer on screen must not land anywhere.
      const latest = valuesRef.current;
      if (latest.name.trim() !== requestedName) {
        setTip(null);
        return;
      }

      const patch: Partial<HabitFormValues> = {};
      if (!latest.cue.trim() && s.cue) patch.cue = s.cue;
      if (!latest.reward.trim() && s.reward) patch.reward = s.reward;
      if (!latest.why.trim() && s.why) patch.why = s.why;
      if (!latest.identity.trim() && s.identity) patch.identity = s.identity;
      if (!latest.routine.trim() && s.routine) patch.routine = s.routine;
      if (Object.keys(patch).length > 0) onChange(patch);

      setTip(s.tip || null);
      haptic.success();
    } catch {
      // A coaching hiccup must never block saving a habit.
      setTip(null);
      setSuggestNote("Nie udało się podpowiedzieć, wpisz własnymi słowami");
      haptic.warning();
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp5 }}>
      <Field label="Nazwa nawyku">
        <VoiceInput
          value={values.name}
          onChange={(v) => onChange({ name: v })}
          placeholder="np. 20 minut spaceru"
          autoFocus={autoFocus}
          disabled={disabled}
        />
      </Field>

      <Field label="Pora dnia">
        <div
          role="radiogroup"
          aria-label="Pora dnia"
          style={{ display: "flex", gap: T.sp2, flexWrap: "wrap" }}
        >
          {SECTIONS.map((s) => {
            const active = values.timeOfDay === s.key;
            return (
              <Pressable
                key={s.key}
                as="button"
                press="sm"
                haptic="selection"
                disabled={disabled}
                role="radio"
                ariaChecked={active}
                onPress={() => onChange({ timeOfDay: s.key })}
                noMinSize
                style={{
                  minHeight: T.tapMin,
                  padding: `0 ${T.sp4}`,
                  gap: 6,
                  borderRadius: T.rFull,
                  background: active ? T.primarySoft : T.surface2,
                  border: `1px solid ${active ? T.borderAccent : T.border}`,
                  color: active ? T.primaryOnSurface : T.text2,
                  ...TYPO.footnote,
                  fontWeight: active ? 700 : 600,
                  boxShadow: active ? T.glowAccentSoft : "none",
                  transition: `background-color 140ms linear, color 140ms linear`,
                }}
              >
                <span aria-hidden="true">{s.icon}</span>
                {s.label}
              </Pressable>
            );
          })}
        </div>
      </Field>

      {/* Rodzaj: a habit is never deleted, only swapped. This is where that starts. */}
      <Field label="Rodzaj">
        <div
          role="radiogroup"
          aria-label="Rodzaj nawyku"
          style={{ display: "flex", gap: T.sp2, width: "100%" }}
        >
          {KIND_OPTIONS.map((o) => {
            const active = values.kind === o.key;
            return (
              <Pressable
                key={o.key}
                as="button"
                press="sm"
                haptic="selection"
                disabled={disabled}
                role="radio"
                ariaChecked={active}
                onPress={() => onChange({ kind: o.key })}
                noMinSize
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: T.tapMin,
                  padding: `0 ${T.sp3}`,
                  borderRadius: T.rMd,
                  background: active ? T.primarySoft : T.surface2,
                  border: `1px solid ${active ? T.borderAccent : T.border}`,
                  color: active ? T.primaryOnSurface : T.text2,
                  ...TYPO.footnote,
                  fontWeight: active ? 700 : 600,
                  boxShadow: active ? T.glowAccentSoft : "none",
                  transition: `background-color 140ms linear, color 140ms linear`,
                }}
              >
                {o.label}
              </Pressable>
            );
          })}
        </div>
      </Field>

      {isReplace && (
        <Field
          label="Jaki nawyk zastępujesz?"
          hint="Wyzwalacz i nagroda zostają te same. Zmienia się tylko to, co robisz pomiędzy."
        >
          {(p) => (
            <input
              {...p}
              disabled={disabled}
              type="text"
              value={values.replaces}
              onChange={(e) => onChange({ replaces: e.target.value })}
              placeholder="np. scrollowanie telefonu po kawie"
              maxLength={MAX_FIELD}
              style={fieldControlStyle}
            />
          )}
        </Field>
      )}

      {/* Coach: fills the loop for people who know the habit but not its trigger. */}
      <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
        <Button
          variant="secondary"
          size="md"
          fullWidth
          loading={suggesting}
          disabled={!values.name.trim() || disabled}
          onPress={askCoach}
        >
          {suggesting ? "Szukam wyzwalacza..." : "Podpowiedz wyzwalacz i nagrodę"}
        </Button>

        {suggesting && (
          <div role="status" style={{ ...TYPO.footnote, color: T.text3 }}>
            Szukam wyzwalacza...
          </div>
        )}

        {!suggesting && suggestNote && (
          <div role="status" style={{ ...TYPO.footnote, color: T.text2 }}>
            {suggestNote}
          </div>
        )}

        {!suggesting && tip && (
          <div
            style={{
              ...TYPO.footnote,
              color: T.text2,
              background: T.surface2,
              borderRadius: T.rMd,
              padding: T.sp3,
            }}
          >
            {tip}
          </div>
        )}
      </div>

      <Field label="Wyzwalacz">
        {(p) => (
          <input
            {...p}
            disabled={disabled}
            type="text"
            value={values.cue}
            onChange={(e) => onChange({ cue: e.target.value })}
            placeholder="Po odstawieniu kubka po kawie"
            maxLength={MAX_FIELD}
            style={fieldControlStyle}
          />
        )}
      </Field>

      <Field label="Nagroda">
        {(p) => (
          <input
            {...p}
            disabled={disabled}
            type="text"
            value={values.reward}
            onChange={(e) => onChange({ reward: e.target.value })}
            placeholder="Spokój w głowie"
            maxLength={MAX_FIELD}
            style={fieldControlStyle}
          />
        )}
      </Field>

      <Field label="Po co mi to">
        {(p) => (
          <textarea
            {...p}
            disabled={disabled}
            value={values.why}
            onChange={(e) => onChange({ why: e.target.value })}
            placeholder="Lepsza wydajność przez cały dzień"
            maxLength={MAX_FIELD}
            style={fieldTextareaStyle}
          />
        )}
      </Field>

      <Field label="Kim się staję">
        {(p) => (
          <textarea
            {...p}
            disabled={disabled}
            value={values.identity}
            onChange={(e) => onChange({ identity: e.target.value })}
            placeholder="Jestem kimś, kto zaczyna dzień od siebie"
            maxLength={MAX_FIELD}
            style={fieldTextareaStyle}
          />
        )}
      </Field>

      <Field label="Opis" labelTrailing="opcjonalnie">
        <VoiceTextarea
          value={values.description}
          onChange={(v) => onChange({ description: v })}
          placeholder="Cokolwiek, co chcesz zapamiętać o tym nawyku"
          minHeight={72}
          disabled={disabled}
        />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  HabitRow                                                           */
/* ------------------------------------------------------------------ */

function HabitRow({
  habit,
  completed,
  toggling,
  streak,
  whyOpen,
  onToggle,
  onEdit,
  onToggleWhy,
}: {
  habit: HabitData;
  completed: boolean;
  toggling: boolean;
  streak: number;
  whyOpen: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onToggleWhy: () => void;
}) {
  const cue = habit.cue?.trim() ?? "";
  const reward = habit.reward?.trim() ?? "";
  // The middle of the loop is the routine when the coach phrased one, the name otherwise.
  const routine = habit.routine?.trim() || habit.name;
  const hasLoop = Boolean(cue && reward);

  const replaces = habit.kind === "replace" ? (habit.replaces?.trim() ?? "") : "";
  const why = habit.why?.trim() ?? "";
  const identity = habit.identity?.trim() ?? "";
  const hasWhy = Boolean(why || identity);

  const description = habit.description?.trim() ?? "";

  const subtitle = (
    <span style={{ display: "flex", flexDirection: "column", gap: T.sp1, minWidth: 0 }}>
      {hasLoop ? <LoopLine cue={cue} routine={routine} reward={reward} /> : null}

      {/* The description was the row's subtitle before the loop existed. It stays
          visible next to the loop: it is text the user typed, and hiding it as soon
          as a cue appears would silently drop data from the list. */}
      {description ? (
        <span
          style={{
            ...TYPO.footnote,
            color: T.text3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {description}
        </span>
      ) : null}

      {replaces ? <ReplacesBadge value={replaces} /> : null}

      {!hasLoop ? (
        <Pressable
          as="button"
          press="sm"
          haptic="tap"
          stopPropagation
          noMinSize
          onPress={onEdit}
          style={{
            alignSelf: "flex-start",
            minHeight: T.tapMin,
            padding: `0 ${T.sp2} 0 0`,
            borderRadius: T.rSm,
            color: T.primaryOnSurface,
            ...TYPO.footnote,
            fontWeight: 700,
          }}
        >
          Uzupełnij wyzwalacz i nagrodę
        </Pressable>
      ) : null}
    </span>
  );

  return (
    <div style={{ width: "100%" }}>
      <ListRow
        leading={
          <HabitCheckbox
            checked={completed}
            disabled={toggling}
            label={habit.name}
            onToggle={onToggle}
          />
        }
        title={habit.name}
        subtitle={subtitle}
        trailing={
          streak > 0 || hasWhy ? (
            <>
              {streak > 0 ? <StreakBadge days={streak} /> : null}
              {hasWhy ? <WhyButton open={whyOpen} onPress={onToggleWhy} /> : null}
            </>
          ) : undefined
        }
        done={completed}
        dimmed={toggling}
        onPress={onEdit}
        haptic="tap"
        minHeight={56}
      />

      {/* .reveal = opacity + translateY over --dur-base, neutralised by the global
          prefers-reduced-motion block in globals.css. Height is never animated. */}
      {whyOpen && hasWhy ? (
        <div
          className="reveal"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: T.sp3,
            // line the panel up with the row title, past the checkbox
            marginLeft: `calc(${T.tapMin} + ${T.sp3})`,
            padding: `${T.sp1} ${T.sp1} ${T.sp3}`,
          }}
        >
          {why ? (
            <div>
              <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp1 }}>Po co mi to</div>
              <div style={{ ...TYPO.callout, color: T.text }}>{why}</div>
            </div>
          ) : null}
          {identity ? (
            <div>
              <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp1 }}>Kim się staję</div>
              <div style={{ ...TYPO.callout, color: T.text }}>{identity}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The habit loop on one line: cue -> routine -> reward.
 *
 * Every member shrinks and truncates on its own (minWidth 0 + ellipsis), so a long
 * reward cannot push the cue off the row and nothing ever wraps onto a second line.
 */
function LoopLine({ cue, routine, reward }: { cue: string; routine: string; reward: string }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        width: "100%",
        minWidth: 0,
        whiteSpace: "nowrap",
        ...TYPO.footnote,
        color: T.text2,
      }}
    >
      <LoopPart text={cue} />
      <LoopArrow />
      <LoopPart text={routine} />
      <LoopArrow />
      <LoopPart text={reward} />
    </span>
  );
}

function LoopPart({ text }: { text: string }) {
  return (
    <span
      title={text}
      style={{
        // shrink from the natural width: the longest member gives up the most room
        flex: "0 1 auto",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function LoopArrow() {
  return (
    <span aria-hidden="true" style={{ flexShrink: 0, color: T.text3 }}>
      →
    </span>
  );
}

/** Small marker that this habit took the place of an old one. */
function ReplacesBadge({ value }: { value: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "flex-start",
        maxWidth: "100%",
        padding: "2px 8px",
        borderRadius: T.rFull,
        background: T.warningSoft,
        color: T.warningOnSurface,
        ...TYPO.footnote,
        fontWeight: 600,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      zastępuje: {value}
    </span>
  );
}

/** Opens the "po co" panel. Its own 44 px target, never the checkbox. */
function WhyButton({ open, onPress }: { open: boolean; onPress: () => void }) {
  return (
    // The row is a div[role=button] with its own Enter/Space handler, so the keydown
    // has to stop here or pressing Enter on this button would ALSO open the editor.
    <span
      onKeyDown={(e) => e.stopPropagation()}
      style={{ display: "inline-flex", flexShrink: 0 }}
    >
      <Pressable
        as="button"
        press="sm"
        haptic="tap"
        stopPropagation
        ariaLabel="Po co ten nawyk"
        ariaExpanded={open}
        onPress={onPress}
        style={{ width: T.tapMin, height: T.tapMin, flexShrink: 0 }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: T.rFull,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
            border: `1.5px solid ${open ? T.borderAccent : T.border}`,
            background: open ? T.primarySoft : "transparent",
            color: open ? T.primaryOnSurface : T.text3,
            ...TYPO.footnote,
            fontWeight: 700,
            transition: `background-color 140ms linear, color 140ms linear`,
          }}
        >
          ?
        </span>
      </Pressable>
    </span>
  );
}

/** 26 px box, 44 px touch target, checkmark that draws itself. */
function HabitCheckbox({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <Pressable
      as="div"
      role="checkbox"
      ariaChecked={checked}
      ariaLabel={`${checked ? "Odznacz" : "Odhacz"} nawyk ${label}`}
      stopPropagation
      press="sm"
      haptic={false}
      disabled={disabled}
      onPress={onToggle}
      style={{ width: T.tapMin, height: T.tapMin, flexShrink: 0 }}
    >
      <span
        // the frame is ALWAYS 2px so neighbours never jump by 2 px when ticked
        key={checked ? "on" : "off"}
        className={checked ? "anim-pop" : undefined}
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          border: `2px solid ${checked ? T.success : T.borderStrong}`,
          background: checked ? T.success : "transparent",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
          transition: `background-color 200ms var(--ease-spring), border-color 200ms var(--ease-spring)`,
        }}
      >
        {checked && (
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={T.textInverse}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline
              className="anim-draw"
              points="4 12 10 18 20 6"
              // .anim-draw runs stroke-dashoffset from --check-len to 0
              style={{ strokeDasharray: 26, ["--check-len" as string]: 26 }}
            />
          </svg>
        )}
      </span>
    </Pressable>
  );
}

function StreakBadge({ days }: { days: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: T.rFull,
        background: T.highlightSoft,
        color: T.highlightOnSurface,
        border: `1px solid ${T.highlight}`,
        ...TYPO.footnote,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true">🔥</span>
      <span className="num">{days}</span>
      <span style={{ opacity: 0.75 }}>dni</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  StatRow — 7-day heatmap + 30-day rate                              */
/* ------------------------------------------------------------------ */

function StatRow({ stat, index }: { stat: HabitStat; index: number }) {
  const dayLabels = last7DayLabels();
  return (
    <Reveal index={index}>
      <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: T.sp3 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                ...TYPO.title3,
                color: T.text,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {stat.name}
            </div>
            {stat.streak > 0 && (
              <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>
                seria {stat.streak} {stat.streak === 1 ? "dzień" : "dni"} pod rząd
              </div>
            )}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <AnimatedNumber
              value={stat.completionRate30d}
              unit="%"
              duration={700}
              className="tile-num"
              style={{ color: T.text }}
              unitStyle={{ fontSize: 13, fontWeight: 600, color: T.text3 }}
            />
            <div style={{ ...TYPO.label, color: T.text3, marginTop: 2 }}>30 dni</div>
          </div>
        </div>

        {/* 7-day heatmap: 24 px cells, done = success, missed = surface-3 */}
        <div style={{ display: "flex", gap: 6 }}>
          {stat.last7Days.map((done, i) => (
            <div
              key={i}
              style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
            >
              <div
                title={done ? "Wykonane" : "Pominięte"}
                aria-label={done ? "Wykonane" : "Pominięte"}
                style={{
                  width: "100%",
                  minWidth: 20,
                  height: 24,
                  borderRadius: 8,
                  background: done ? T.success : T.surface3,
                  border: done ? "none" : `1px solid ${T.border}`,
                  boxSizing: "border-box",
                  transition: "background-color 200ms var(--ease-out)",
                }}
              />
              <span style={{ ...TYPO.label, color: T.text3, lineHeight: 1 }}>{dayLabels[i]}</span>
            </div>
          ))}
        </div>
      </div>
    </Reveal>
  );
}
