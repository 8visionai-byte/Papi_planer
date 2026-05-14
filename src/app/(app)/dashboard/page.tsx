"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { UniversalInputBar } from "@/components/shell/UniversalInputBar";
import { format } from "date-fns";
import { pl } from "date-fns/locale";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BriefingData {
  id: string;
  content: string;
  audioUrl: string | null;
  phase: number | null;
  week: number | null;
  dayType: string | null;
}

interface ActivityData {
  id: string;
  name: string;
  type: string;
  scheduledAt: string | null;
  durationMin: number | null;
  completed: boolean;
  lifeAreaId: string | null;
  notes: string | null;
}

interface DailyLogData {
  id: string;
  energy: number | null;
  mood: string | null;
  sleepHours: number | null;
  sleepQuality: number | null;
  dayType: string | null;
}

interface ScheduleItem {
  id: string;
  time: string;
  activityName: string;
  lifeAreaId: string | null;
  notes: string | null;
}

interface DashboardData {
  briefing: BriefingData | null;
  schedule: ScheduleItem[];
  activities: ActivityData[];
  dailyLog: DailyLogData | null;
  userName: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const DAY_TYPE_LABELS: Record<string, string> = {
  training: "Trening",
  rest: "Odpoczynek",
  work: "Praca",
  competition: "Zawody",
};

const MOOD_EMOJI: Record<string, string> = {
  great: "😄",
  good: "🙂",
  ok: "😐",
  bad: "😔",
  terrible: "😢",
};

function timeBlock(time: string): "morning" | "afternoon" | "evening" {
  const hour = parseInt(time.split(":")[0], 10);
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

const BLOCK_LABELS: Record<string, string> = {
  morning: "Rano",
  afternoon: "Popoldnie",
  evening: "Wieczor",
};

/* ------------------------------------------------------------------ */
/*  Skeleton Components                                                */
/* ------------------------------------------------------------------ */

function SkeletonLine({ width = "100%" }: { width?: string }) {
  return (
    <div
      style={{
        height: 14,
        width,
        borderRadius: 7,
        background: "var(--border)",
        animation: "pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}

function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div style={cardStyle}>
      <SkeletonLine width="40%" />
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine key={i} width={`${70 + Math.random() * 30}%`} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const cardStyle: React.CSSProperties = {
  background: "var(--card)",
  borderRadius: 16,
  padding: 16,
  boxShadow: "var(--card-shadow)",
};

/* ------------------------------------------------------------------ */
/*  Dashboard Page                                                     */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("fetch failed");
      const json: DashboardData = await res.json();

      // If no dailyLog, initialize today's data
      if (!json.dailyLog && json.schedule.length > 0) {
        const initRes = await fetch("/api/dashboard/init", { method: "POST" });
        if (initRes.ok) {
          // Re-fetch after init
          const res2 = await fetch("/api/dashboard");
          if (res2.ok) {
            const json2: DashboardData = await res2.json();
            setData(json2);
            return;
          }
        }
      }

      setData(json);
    } catch {
      // keep data null — empty state will show
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const toggleActivity = async (activityId: string) => {
    if (togglingIds.has(activityId)) return;
    setTogglingIds((prev) => new Set(prev).add(activityId));

    // Optimistic update
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        activities: prev.activities.map((a) =>
          a.id === activityId ? { ...a, completed: !a.completed } : a
        ),
      };
    });

    try {
      const res = await fetch("/api/activities/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId }),
      });
      if (!res.ok) {
        // Revert on failure
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activities: prev.activities.map((a) =>
              a.id === activityId ? { ...a, completed: !a.completed } : a
            ),
          };
        });
      }
    } catch {
      // Revert
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          activities: prev.activities.map((a) =>
            a.id === activityId ? { ...a, completed: !a.completed } : a
          ),
        };
      });
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(activityId);
        return next;
      });
    }
  };

  const handleInputSubmit = (text: string) => {
    // Placeholder — Task 9 will wire AI processing
    console.log("User input:", text);
  };

  const today = new Date();
  const dateStr = format(today, "EEEE, d MMMM", { locale: pl });
  const firstName = user?.name?.split(" ")[0] ?? "";

  /* Group activities by time block */
  const grouped: Record<string, ActivityData[]> = { morning: [], afternoon: [], evening: [] };
  if (data) {
    for (const act of data.activities) {
      const block = act.scheduledAt ? timeBlock(act.scheduledAt) : "morning";
      grouped[block].push(act);
    }
  }

  return (
    <div style={{ padding: "20px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ---- Header ---- */}
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--foreground)", margin: 0 }}>
          {loading ? <SkeletonLine width="60%" /> : `Dzien dobry, ${firstName}`}
        </h1>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 4,
          }}
        >
          <span style={{ fontSize: 14, color: "var(--muted)", textTransform: "capitalize" }}>
            {dateStr}
          </span>
          {data?.dailyLog?.dayType && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: 9999,
                background: "var(--primary)",
                color: "#fff",
              }}
            >
              {DAY_TYPE_LABELS[data.dailyLog.dayType] ?? data.dailyLog.dayType}
            </span>
          )}
        </div>
      </div>

      {/* ---- Briefing Card ---- */}
      {loading ? (
        <SkeletonCard lines={4} />
      ) : (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Briefing</h2>
            {data?.briefing?.audioUrl && (
              <button
                onClick={() => {
                  const audio = new Audio(data.briefing!.audioUrl!);
                  audio.play();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  background: "var(--primary)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 9999,
                  padding: "4px 12px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                  <polygon points="5,3 19,12 5,21" />
                </svg>
                Odtwórz
              </button>
            )}
          </div>

          {data?.briefing ? (
            <div
              style={{
                marginTop: 10,
                fontSize: 14,
                lineHeight: 1.6,
                color: "var(--foreground)",
                whiteSpace: "pre-wrap",
              }}
            >
              {data.briefing.content}
            </div>
          ) : (
            <div style={{ marginTop: 10, textAlign: "center", padding: "12px 0" }}>
              <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 12px" }}>
                Brak briefingu na dzis
              </p>
              <button
                onClick={() => {
                  /* Task 8 will wire generation */
                }}
                style={{
                  background: "var(--primary)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  padding: "10px 20px",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Wygeneruj briefing
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---- Today's Schedule / Checklist ---- */}
      {loading ? (
        <SkeletonCard lines={5} />
      ) : (
        <div style={cardStyle}>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Plan dnia</h2>

          {data && data.activities.length === 0 && data.schedule.length === 0 ? (
            <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 10, textAlign: "center" }}>
              Brak zaplanowanych aktywnosci na dzis
            </p>
          ) : (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 16 }}>
              {(["morning", "afternoon", "evening"] as const).map((block) => {
                const items = grouped[block];
                if (items.length === 0) return null;
                return (
                  <div key={block}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--muted)",
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        marginBottom: 8,
                      }}
                    >
                      {BLOCK_LABELS[block]}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {items.map((act) => (
                        <ActivityRow
                          key={act.id}
                          activity={act}
                          toggling={togglingIds.has(act.id)}
                          onToggle={() => toggleActivity(act.id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---- Quick Stats ---- */}
      {loading ? (
        <SkeletonCard lines={1} />
      ) : (
        <div
          style={{
            ...cardStyle,
            display: "flex",
            justifyContent: "space-around",
            textAlign: "center",
          }}
        >
          <StatItem
            label="Energia"
            value={data?.dailyLog?.energy != null ? `${data.dailyLog.energy}/10` : "--"}
            icon="⚡"
          />
          <div style={{ width: 1, background: "var(--border)" }} />
          <StatItem
            label="Nastroj"
            value={
              data?.dailyLog?.mood
                ? MOOD_EMOJI[data.dailyLog.mood] ?? data.dailyLog.mood
                : "--"
            }
            icon=""
          />
          <div style={{ width: 1, background: "var(--border)" }} />
          <StatItem
            label="Sen"
            value={data?.dailyLog?.sleepHours != null ? `${data.dailyLog.sleepHours}h` : "--"}
            icon="🌙"
          />
        </div>
      )}

      {/* ---- Universal Input Bar ---- */}
      <div style={{ marginTop: 4 }}>
        <UniversalInputBar onSubmit={handleInputSubmit} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ActivityRow({
  activity,
  toggling,
  onToggle,
}: {
  activity: ActivityData;
  toggling: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={toggling}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 0",
        background: "none",
        border: "none",
        cursor: "pointer",
        width: "100%",
        textAlign: "left",
        fontFamily: "inherit",
        opacity: toggling ? 0.6 : 1,
        transition: "opacity 150ms",
      }}
    >
      {/* Checkbox */}
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 6,
          border: activity.completed ? "none" : "2px solid var(--border)",
          background: activity.completed ? "var(--success)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          transition: "all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          transform: activity.completed ? "scale(1)" : "scale(1)",
        }}
      >
        {activity.completed && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              animation: "checkmark 200ms ease-out",
            }}
          >
            <polyline points="4 12 10 18 20 6" />
          </svg>
        )}
      </div>

      {/* Time */}
      {activity.scheduledAt && (
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: "var(--muted)",
            minWidth: 42,
            flexShrink: 0,
          }}
        >
          {activity.scheduledAt}
        </span>
      )}

      {/* Name */}
      <span
        style={{
          fontSize: 14,
          color: activity.completed ? "var(--muted)" : "var(--foreground)",
          textDecoration: activity.completed ? "line-through" : "none",
          transition: "color 200ms, text-decoration 200ms",
        }}
      >
        {activity.name}
      </span>
    </button>
  );
}

function StatItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span style={{ fontSize: 18, fontWeight: 600, color: "var(--foreground)" }}>{value}</span>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
    </div>
  );
}
