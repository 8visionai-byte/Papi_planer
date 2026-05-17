"use client";

import { useCallback, useEffect, useState } from "react";
import VoiceInput from "@/components/forms/VoiceInput";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import { useBroadcastChannel } from "@/hooks/useBroadcastChannel";

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
/*  Constants / styles                                                 */
/* ------------------------------------------------------------------ */

const SECTIONS: { key: TimeOfDay; label: string; icon: string }[] = [
  { key: "morning", label: "Rano", icon: "🌅" },
  { key: "afternoon", label: "Popołudnie", icon: "☀️" },
  { key: "evening", label: "Wieczór", icon: "🌙" },
  { key: "any", label: "Inne", icon: "📌" },
];

const cardStyle: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 16,
  padding: 16,
  boxShadow: "var(--card-shadow)",
};

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
    setTodayCompletions((prev) => ({ ...prev, [habitId]: !prevCompleted }));

    try {
      const res = await fetch("/api/habits/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habitId }),
      });
      if (!res.ok) {
        setTodayCompletions((prev) => ({ ...prev, [habitId]: prevCompleted }));
      } else {
        const json = await res.json();
        setTodayCompletions((prev) => ({ ...prev, [habitId]: json.completed }));
        postHabitEvent({ type: "habit-toggled", habitId, completed: json.completed });
        // Refresh stats in background
        fetchStats();
      }
    } catch {
      setTodayCompletions((prev) => ({ ...prev, [habitId]: prevCompleted }));
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(habitId);
        return next;
      });
    }
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
        setNewName("");
        setNewDescription("");
        setNewTimeOfDay("any");
        setShowAdd(false);
        showToast("Nawyk dodany!");
        fetchStats();
        postHabitEvent({ type: "habit-created", habitId: habit.id });
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || "Błąd dodawania");
      }
    } catch {
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
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditDescription("");
    setEditTimeOfDay("any");
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
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
        cancelEdit();
        showToast("Zapisano");
        fetchStats();
      }
    } catch {
      showToast("Błąd zapisu");
    }
  };

  const deleteHabit = async (id: string) => {
    if (!confirm("Usunąć ten nawyk? Historia zostanie zachowana.")) return;
    try {
      const res = await fetch("/api/habits", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setHabits((prev) => prev.filter((h) => h.id !== id));
        showToast("Nawyk usunięty");
        postHabitEvent({ type: "habit-deleted", habitId: id });
        fetchStats();
      }
    } catch {
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

  return (
    <div style={{ padding: "20px 16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--foreground)", margin: 0 }}>
          Nawyki
        </h1>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: "4px 0 0" }}>
          Twoje codzienne rytuały
        </p>
      </div>

      {/* Day progress */}
      {!loading && totalToday > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
            <div
              style={{
                width: `${dayPct}%`,
                height: "100%",
                borderRadius: 3,
                background: "var(--success)",
                transition: "width 400ms ease",
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500, flexShrink: 0 }}>
            {completedToday}/{totalToday} dziś
          </span>
        </div>
      )}

      {/* Add button / form */}
      {!showAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "10px 16px",
            borderRadius: 12,
            border: "2px dashed var(--border)",
            background: "transparent",
            color: "var(--muted)",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          + Dodaj nawyk
        </button>
      ) : (
        <div style={cardStyle}>
          <VoiceInput
            value={newName}
            onChange={setNewName}
            placeholder="Nazwa nawyku..."
            autoFocus
          />
          <div style={{ marginTop: 8 }}>
            <VoiceTextarea
              value={newDescription}
              onChange={setNewDescription}
              placeholder="Opis (opcjonalnie)..."
              minHeight={60}
            />
          </div>
          <div style={{ marginTop: 10 }}>
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
              Pora dnia
            </label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {SECTIONS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setNewTimeOfDay(s.key)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 9999,
                    border: "none",
                    background: newTimeOfDay === s.key ? "var(--primary)" : "var(--border)",
                    color: newTimeOfDay === s.key ? "#fff" : "var(--muted)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 200ms ease",
                  }}
                >
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={addHabit}
              disabled={!newName.trim() || adding}
              style={{
                flex: 1,
                padding: "10px",
                borderRadius: 10,
                border: "none",
                background: "var(--primary)",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: adding ? "not-allowed" : "pointer",
                opacity: !newName.trim() || adding ? 0.5 : 1,
              }}
            >
              {adding ? "Dodaję..." : "Dodaj"}
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setNewName("");
                setNewDescription("");
                setNewTimeOfDay("any");
              }}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--muted)",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={cardStyle}>
          <div style={{ height: 14, width: "50%", borderRadius: 7, background: "var(--border)", marginBottom: 10, animation: "pulse 1.5s ease-in-out infinite" }} />
          <div style={{ height: 14, width: "80%", borderRadius: 7, background: "var(--border)", marginBottom: 10, animation: "pulse 1.5s ease-in-out infinite" }} />
          <div style={{ height: 14, width: "65%", borderRadius: 7, background: "var(--border)", animation: "pulse 1.5s ease-in-out infinite" }} />
        </div>
      )}

      {/* Empty state */}
      {!loading && habits.length === 0 && !showAdd && (
        <div style={{ ...cardStyle, textAlign: "center", padding: "40px 16px" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 500, color: "var(--foreground)" }}>
            Brak nawyków
          </div>
          <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
            Dodaj swój pierwszy nawyk i zacznij budować rytuały
          </div>
        </div>
      )}

      {/* Sections */}
      {!loading &&
        SECTIONS.map((section) => {
          const items = grouped[section.key];
          if (items.length === 0) return null;
          const sectionDone = items.filter((h) => todayCompletions[h.id]).length;
          return (
            <div key={section.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 4px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 18 }}>{section.icon}</span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--foreground)",
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                    }}
                  >
                    {section.label}
                  </span>
                </div>
                <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>
                  {sectionDone}/{items.length}
                </span>
              </div>
              <div style={cardStyle}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {items.map((h) => {
                    const stat = stats.find((s) => s.id === h.id);
                    const isEditing = editingId === h.id;
                    if (isEditing) {
                      return (
                        <div
                          key={h.id}
                          style={{
                            padding: 10,
                            borderRadius: 10,
                            background: "var(--background)",
                            border: "1px solid var(--primary)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          <VoiceInput value={editName} onChange={setEditName} placeholder="Nazwa..." />
                          <VoiceTextarea
                            value={editDescription}
                            onChange={setEditDescription}
                            placeholder="Opis..."
                            minHeight={50}
                          />
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {SECTIONS.map((s) => (
                              <button
                                key={s.key}
                                onClick={() => setEditTimeOfDay(s.key)}
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: 9999,
                                  border: "none",
                                  background:
                                    editTimeOfDay === s.key ? "var(--primary)" : "var(--border)",
                                  color: editTimeOfDay === s.key ? "#fff" : "var(--muted)",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: "pointer",
                                }}
                              >
                                {s.icon} {s.label}
                              </button>
                            ))}
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={saveEdit}
                              disabled={!editName.trim()}
                              style={{
                                flex: 1,
                                padding: 8,
                                borderRadius: 8,
                                border: "none",
                                background: "var(--primary)",
                                color: "#fff",
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: "pointer",
                                opacity: !editName.trim() ? 0.5 : 1,
                              }}
                            >
                              Zapisz
                            </button>
                            <button
                              onClick={cancelEdit}
                              style={{
                                padding: "8px 14px",
                                borderRadius: 8,
                                border: "1px solid var(--border)",
                                background: "transparent",
                                color: "var(--muted)",
                                fontSize: 13,
                                cursor: "pointer",
                              }}
                            >
                              Anuluj
                            </button>
                            <button
                              onClick={() => deleteHabit(h.id)}
                              style={{
                                padding: "8px 14px",
                                borderRadius: 8,
                                border: "1px solid var(--danger)",
                                background: "transparent",
                                color: "var(--danger)",
                                fontSize: 13,
                                cursor: "pointer",
                              }}
                            >
                              Usuń
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <HabitRow
                        key={h.id}
                        habit={h}
                        completed={todayCompletions[h.id] ?? false}
                        toggling={togglingIds.has(h.id)}
                        streak={stat?.streak ?? 0}
                        onToggle={() => toggleHabit(h.id)}
                        onEdit={() => startEdit(h)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}

      {/* Stats */}
      {!loading && habits.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 4px",
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 18 }}>📊</span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "var(--foreground)",
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Statystyki
            </span>
          </div>
          <div style={cardStyle}>
            {statsLoading ? (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>Ładuję statystyki...</div>
            ) : stats.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>Brak danych</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {stats.map((s) => (
                  <StatRow key={s.id} stat={s} />
                ))}
              </div>
            )}
          </div>
        </div>
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
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 4px",
        borderRadius: 8,
        opacity: toggling ? 0.6 : 1,
        transition: "opacity 150ms ease",
      }}
    >
      <div
        onClick={(e) => {
          e.stopPropagation();
          if (!toggling) onToggle();
        }}
        style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          border: completed ? "none" : "2px solid var(--border)",
          background: completed ? "var(--success)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          cursor: toggling ? "not-allowed" : "pointer",
          transition: "all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        {completed && (
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="4 12 10 18 20 6" />
          </svg>
        )}
      </div>
      <div
        onClick={onEdit}
        style={{ flex: 1, minWidth: 0, cursor: "pointer" }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: completed ? "var(--muted)" : "var(--foreground)",
            textDecoration: completed ? "line-through" : "none",
            transition: "color 200ms",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {habit.name}
        </div>
        {habit.description && (
          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              marginTop: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {habit.description}
          </div>
        )}
      </div>
      {streak > 0 && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 9999,
            background: "rgba(245, 158, 11, 0.15)",
            color: "#d97706",
            flexShrink: 0,
          }}
        >
          🔥 {streak}d
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  StatRow                                                            */
/* ------------------------------------------------------------------ */

function StatRow({ stat }: { stat: HabitStat }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--foreground)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {stat.name}
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 9999,
              background: "rgba(245, 158, 11, 0.15)",
              color: "#d97706",
            }}
          >
            🔥 {stat.streak}d
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 9999,
              background: "rgba(29, 78, 216, 0.12)",
              color: "var(--primary)",
            }}
          >
            30d: {stat.completionRate30d}%
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {stat.last7Days.map((done, i) => (
          <div
            key={i}
            title={done ? "Wykonane" : "Brak"}
            style={{
              flex: 1,
              height: 10,
              borderRadius: 3,
              background: done ? "var(--success)" : "var(--border)",
              transition: "background 200ms ease",
            }}
          />
        ))}
      </div>
    </div>
  );
}
