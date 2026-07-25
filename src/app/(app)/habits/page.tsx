"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "@/components/ui";
import { AnimatedNumber, Reveal } from "@/components/motion";

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

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SECTIONS: { key: TimeOfDay; label: string; icon: string }[] = [
  { key: "morning", label: "Rano", icon: "🌅" },
  { key: "afternoon", label: "Popołudnie", icon: "☀️" },
  { key: "evening", label: "Wieczór", icon: "🌙" },
  { key: "any", label: "Inne", icon: "📌" },
];

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

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function HabitsPage() {
  const [habits, setHabits] = useState<HabitData[]>([]);
  const [todayCompletions, setTodayCompletions] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState<HabitStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newTimeOfDay, setNewTimeOfDay] = useState<TimeOfDay>("any");
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editTimeOfDay, setEditTimeOfDay] = useState<TimeOfDay>("any");
  const [savingEdit, setSavingEdit] = useState(false);
  /** Two-step delete inside the edit sheet: no nested sheet, no native confirm(). */
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [toast, setToast] = useState<string | null>(null);

  const postHabitEvent = useBroadcastChannel("papicoach:habits");

  const fetchHabits = useCallback(async () => {
    try {
      const res = await fetch("/api/habits");
      if (res.ok) {
        const json: HabitsResponse = await res.json();
        setHabits(json.habits);
        setTodayCompletions(json.todayCompletions);
      }
    } catch {
      // ignore
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

  const closeAdd = () => {
    setShowAdd(false);
    setNewName("");
    setNewDescription("");
    setNewTimeOfDay("any");
  };

  const addHabit = async () => {
    if (!newName.trim() || adding) return;
    setAdding(true);
    try {
      const res = await fetch("/api/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDescription.trim() || null,
          timeOfDay: newTimeOfDay,
        }),
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
    setEditName(h.name);
    setEditDescription(h.description ?? "");
    setEditTimeOfDay((h.timeOfDay as TimeOfDay) ?? "any");
    setConfirmDelete(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditDescription("");
    setEditTimeOfDay("any");
    setConfirmDelete(false);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim() || savingEdit) return;
    setSavingEdit(true);
    try {
      const res = await fetch("/api/habits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          name: editName.trim(),
          description: editDescription.trim() || null,
          timeOfDay: editTimeOfDay,
        }),
      });
      if (res.ok) {
        const updated: HabitData = await res.json();
        setHabits((prev) => prev.map((h) => (h.id === updated.id ? updated : h)));
        haptic.success();
        cancelEdit();
        showToast("Zapisano");
        fetchStats();
      }
    } catch {
      haptic.error();
      showToast("Błąd zapisu");
    } finally {
      setSavingEdit(false);
    }
  };

  const deleteHabit = async (id: string) => {
    try {
      const res = await fetch("/api/habits", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setHabits((prev) => prev.filter((h) => h.id !== id));
        haptic.warning();
        cancelEdit();
        showToast("Nawyk usunięty");
        postHabitEvent({ type: "habit-deleted", habitId: id });
        fetchStats();
      }
    } catch {
      haptic.error();
      showToast("Błąd usuwania");
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
          <EmptyState
            icon="🌱"
            title="Nie masz jeszcze nawyków"
            body="Dodaj pierwszy rytuał i zacznij odhaczać go codziennie."
            action={{ label: "Dodaj nawyk", onPress: () => setShowAdd(true) }}
          />
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
                          onToggle={() => toggleHabit(h.id)}
                          onEdit={() => startEdit(h)}
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
              disabled={!newName.trim()}
              onPress={addHabit}
            >
              Dodaj nawyk
            </Button>
          </div>
        }
      >
        <HabitForm
          name={newName}
          onName={setNewName}
          description={newDescription}
          onDescription={setNewDescription}
          timeOfDay={newTimeOfDay}
          onTimeOfDay={setNewTimeOfDay}
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
              disabled={!editName.trim()}
              onPress={saveEdit}
            >
              Zapisz
            </Button>
          </div>
        }
      >
        <HabitForm
          name={editName}
          onName={setEditName}
          description={editDescription}
          onDescription={setEditDescription}
          timeOfDay={editTimeOfDay}
          onTimeOfDay={setEditTimeOfDay}
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
              <Button variant="secondary" size="md" fullWidth onPress={() => setConfirmDelete(false)}>
                Zostaw
              </Button>
              <Button
                variant="danger"
                size="md"
                fullWidth
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
  name,
  onName,
  description,
  onDescription,
  timeOfDay,
  onTimeOfDay,
  disabled,
  autoFocus = false,
}: {
  name: string;
  onName: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
  timeOfDay: TimeOfDay;
  onTimeOfDay: (v: TimeOfDay) => void;
  disabled: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp5 }}>
      <Field label="Nazwa nawyku">
        <VoiceInput
          value={name}
          onChange={onName}
          placeholder="np. 20 minut spaceru"
          autoFocus={autoFocus}
          disabled={disabled}
        />
      </Field>

      <Field label="Opis" labelTrailing="opcjonalnie">
        <VoiceTextarea
          value={description}
          onChange={onDescription}
          placeholder="Po co go robisz?"
          minHeight={72}
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
            const active = timeOfDay === s.key;
            return (
              <Pressable
                key={s.key}
                as="button"
                press="sm"
                haptic="selection"
                disabled={disabled}
                role="radio"
                ariaChecked={active}
                onPress={() => onTimeOfDay(s.key)}
                noMinSize
                style={{
                  minHeight: T.tapMin,
                  padding: `0 ${T.sp4}`,
                  gap: 6,
                  borderRadius: T.rFull,
                  background: active ? T.primarySoft : T.surface2,
                  border: `1px solid ${active ? "var(--border-accent, transparent)" : T.border}`,
                  color: active ? T.primaryOnSurface : T.text2,
                  ...TYPO.footnote,
                  fontWeight: active ? 700 : 600,
                  boxShadow: active ? "var(--glow-accent-soft)" : "none",
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
  onToggle,
  onEdit,
}: {
  habit: HabitData;
  completed: boolean;
  toggling: boolean;
  streak: number;
  onToggle: () => void;
  onEdit: () => void;
}) {
  return (
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
      subtitle={habit.description ?? undefined}
      trailing={streak > 0 ? <StreakBadge days={streak} /> : undefined}
      done={completed}
      dimmed={toggling}
      onPress={onEdit}
      haptic="tap"
      minHeight={56}
    />
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
