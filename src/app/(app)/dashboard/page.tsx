"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { UniversalInputBar } from "@/components/shell/UniversalInputBar";
import { BriefingCard, type BriefingData } from "@/components/briefing/BriefingCard";
import { FollowUpSheet, type FollowUpData } from "@/components/followup/FollowUpSheet";
import WeightTracker from "@/components/weight/WeightTracker";
import { format } from "date-fns";
import { pl } from "date-fns/locale";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ActivityData {
  id: string;
  name: string;
  type: string;
  scheduledAt: string | null;
  durationMin: number | null;
  completed: boolean;
  lifeAreaId: string | null;
  notes: string | null;
  metrics?: { caloriesBurned?: number; weightUsed?: number } | null;
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
  bmr?: number;
  tdee?: number;
  bmrSoFarToday?: number;
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
  great: "\u{1F604}",
  good: "\u{1F642}",
  ok: "\u{1F610}",
  bad: "\u{1F614}",
  terrible: "\u{1F622}",
};

function timeBlock(time: string): "morning" | "afternoon" | "evening" {
  const hour = parseInt(time.split(":")[0], 10);
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

const BLOCK_LABELS: Record<string, string> = {
  morning: "Rano",
  afternoon: "Popoludnie",
  evening: "Wieczor",
};

const CAROUSEL_PANELS = ["Plan dnia", "Briefing", "Statystyki"] as const;

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
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
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  const [activePanel, setActivePanel] = useState(0);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const touchDeltaRef = useRef(0);
  const isHorizontalSwipe = useRef<boolean | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<FollowUpData | null>(null);
  const [generatingPlanIds, setGeneratingPlanIds] = useState<Set<string>>(new Set());

  const [isGeneratingBriefing, setIsGeneratingBriefing] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("fetch failed");
      const json: DashboardData = await res.json();

      if (!json.dailyLog && json.schedule.length > 0) {
        const initRes = await fetch("/api/dashboard/init", { method: "POST" });
        if (initRes.ok) {
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
      // keep data null
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
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activities: prev.activities.map((a) =>
              a.id === activityId ? { ...a, completed: !a.completed } : a
            ),
          };
        });
      } else {
        const json = await res.json();
        if (json.activity) {
          setData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              activities: prev.activities.map((a) =>
                a.id === activityId ? { ...a, ...json.activity } : a
              ),
            };
          });
        }
        if (json.followUp) {
          setFollowUp(json.followUp);
        }
        if (json.mealAdded) {
          setToast(`Dodano do diety: ${json.mealAdded.name} (${json.mealAdded.calories} kcal)`);
          setTimeout(() => setToast(null), 3000);
        }
      }
    } catch {
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

  const generateBriefing = useCallback(async () => {
    setIsGeneratingBriefing(true);
    setStreamingText("");
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/briefing/generate", {
        method: "POST",
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let briefingId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === "text_delta" && event.text) {
              accumulated += event.text;
              setStreamingText(accumulated);
            } else if (event.type === "done") {
              briefingId = event.briefingId ?? null;
            } else if (event.type === "error") {
              throw new Error(event.error);
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }

      if (briefingId && accumulated) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                briefing: {
                  id: briefingId!,
                  content: accumulated,
                  audioUrl: null,
                  phase: null,
                  week: null,
                  dayType: null,
                },
              }
            : prev
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      console.error("Briefing generation error:", err);
    } finally {
      setIsGeneratingBriefing(false);
      setStreamingText("");
      abortRef.current = null;
    }
  }, []);

  const generateAudio = useCallback(async (briefingId: string) => {
    setIsGeneratingAudio(true);
    try {
      const res = await fetch("/api/briefing/audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefingId }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { audioUrl } = await res.json();

      setData((prev) =>
        prev?.briefing
          ? { ...prev, briefing: { ...prev.briefing, audioUrl } }
          : prev
      );
    } catch (err) {
      console.error("Audio generation error:", err);
    } finally {
      setIsGeneratingAudio(false);
    }
  }, []);

  const [isProcessingInput, setIsProcessingInput] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const generatePlan = useCallback(async (activityId: string) => {
    setGeneratingPlanIds((prev) => new Set(prev).add(activityId));
    try {
      const res = await fetch("/api/activities/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Blad generowania" }));
        throw new Error(err.error || "Blad generowania");
      }
      const json = await res.json();
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          activities: prev.activities.map((a) =>
            a.id === activityId ? { ...a, notes: json.notes } : a
          ),
        };
      });
      setToast(`Plan od ${json.mentorName} gotowy!`);
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Blad generowania");
      setTimeout(() => setToast(null), 4000);
    } finally {
      setGeneratingPlanIds((prev) => {
        const next = new Set(prev);
        next.delete(activityId);
        return next;
      });
    }
  }, []);

  const handleInputSubmit = useCallback(
    async (text: string) => {
      setIsProcessingInput(true);
      setToast(null);
      try {
        const res = await fetch("/api/input/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Blad przetwarzania" }));
          throw new Error(err.error || "Blad przetwarzania");
        }

        await fetchDashboard();
        setToast("Zapisano dane!");
        setTimeout(() => setToast(null), 3000);
      } catch (err) {
        console.error("Input processing error:", err);
        setToast(err instanceof Error ? err.message : "Blad przetwarzania");
        setTimeout(() => setToast(null), 4000);
      } finally {
        setIsProcessingInput(false);
      }
    },
    [fetchDashboard]
  );

  /* Carousel touch handlers */
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    touchDeltaRef.current = 0;
    isHorizontalSwipe.current = null;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartRef.current.x;
    const dy = e.touches[0].clientY - touchStartRef.current.y;

    if (isHorizontalSwipe.current === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      isHorizontalSwipe.current = Math.abs(dx) > Math.abs(dy);
    }

    if (isHorizontalSwipe.current) {
      touchDeltaRef.current = dx;
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (isHorizontalSwipe.current && Math.abs(touchDeltaRef.current) > 50) {
      setActivePanel((p) => {
        if (touchDeltaRef.current < 0 && p < 2) return p + 1;
        if (touchDeltaRef.current > 0 && p > 0) return p - 1;
        return p;
      });
    }
    touchDeltaRef.current = 0;
    isHorizontalSwipe.current = null;
  }, []);

  const today = new Date();
  const dateStr = format(today, "EEEE, d MMMM", { locale: pl });
  const firstName = user?.name?.split(" ")[0] ?? "";

  const grouped: Record<string, ActivityData[]> = { morning: [], afternoon: [], evening: [] };
  if (data) {
    for (const act of data.activities) {
      const block = act.scheduledAt ? timeBlock(act.scheduledAt) : "morning";
      grouped[block].push(act);
    }
  }

  const totalActivities = data?.activities.length ?? 0;
  const completedCount = data?.activities.filter((a) => a.completed).length ?? 0;
  const completionPct = totalActivities > 0 ? Math.round((completedCount / totalActivities) * 100) : 0;
  const totalCaloriesBurned = data?.activities.reduce(
    (sum, a) => sum + (a.completed && a.metrics?.caloriesBurned ? a.metrics.caloriesBurned : 0),
    0
  ) ?? 0;

  return (
    <div style={{ padding: "20px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ---- Header ---- */}
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--foreground)", margin: 0 }}>
          {loading ? <SkeletonLine width="60%" /> : `Dzien dobry, ${firstName}`}
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
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

      {/* ---- Progress bar ---- */}
      {!loading && totalActivities > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
            <div
              style={{
                width: `${completionPct}%`,
                height: "100%",
                borderRadius: 3,
                background: "var(--success)",
                transition: "width 400ms ease",
              }}
            />
          </div>
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500, flexShrink: 0 }}>
            {completedCount}/{totalActivities}
          </span>
        </div>
      )}

      {/* ---- Carousel Tab Pills ---- */}
      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
        {CAROUSEL_PANELS.map((label, i) => (
          <button
            key={label}
            onClick={() => setActivePanel(i)}
            style={{
              padding: "6px 14px",
              borderRadius: 9999,
              border: "none",
              background: i === activePanel ? "var(--primary)" : "transparent",
              color: i === activePanel ? "#fff" : "var(--muted)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 200ms ease",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ---- Carousel ---- */}
      {loading ? (
        <SkeletonCard lines={5} />
      ) : (
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{ overflow: "hidden", width: "100%", position: "relative" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              width: "100%",
              transform: `translateX(-${activePanel * 100}%)`,
              transition: "transform 300ms cubic-bezier(0.25, 1, 0.5, 1)",
            }}
          >
            {/* Panel 0: Plan dnia */}
            <div style={{ width: "100%", maxWidth: "100%", flexShrink: 0, padding: "0 1px", overflow: "hidden", boxSizing: "border-box" }}>
              <div style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Plan dnia</h2>
                  {totalActivities > 0 && (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{completionPct}% gotowe</span>
                  )}
                </div>

                {data && data.activities.length === 0 && data.schedule.length === 0 ? (
                  <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 10, textAlign: "center" }}>
                    Brak zaplanowanych aktywnosci na dzis
                  </p>
                ) : (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 14 }}>
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
                              marginBottom: 6,
                            }}
                          >
                            {BLOCK_LABELS[block]}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            {items.map((act) => (
                              <ActivityRow
                                key={act.id}
                                activity={act}
                                toggling={togglingIds.has(act.id)}
                                onToggle={() => toggleActivity(act.id)}
                                isExpanded={expandedId === act.id}
                                onExpand={() => setExpandedId(expandedId === act.id ? null : act.id)}
                                generatingPlan={generatingPlanIds.has(act.id)}
                                onGeneratePlan={() => generatePlan(act.id)}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Panel 1: Briefing */}
            <div style={{ width: "100%", maxWidth: "100%", flexShrink: 0, padding: "0 1px", overflow: "hidden", boxSizing: "border-box" }}>
              <BriefingCard
                briefing={data?.briefing ?? null}
                streamingText={streamingText}
                isGenerating={isGeneratingBriefing}
                onGenerate={generateBriefing}
                onGenerateAudio={generateAudio}
                isGeneratingAudio={isGeneratingAudio}
              />
            </div>

            {/* Panel 2: Statystyki */}
            <div style={{ width: "100%", maxWidth: "100%", flexShrink: 0, padding: "0 1px", overflow: "hidden", boxSizing: "border-box" }}>
              <div style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 16 }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Statystyki dnia</h2>
                <div style={{ display: "flex", justifyContent: "space-around", textAlign: "center" }}>
                  <StatItem
                    label="Energia"
                    value={data?.dailyLog?.energy != null ? `${data.dailyLog.energy}/10` : "--"}
                    icon="⚡"
                  />
                  <div style={{ width: 1, background: "var(--border)" }} />
                  <StatItem
                    label="Nastroj"
                    value={
                      data?.dailyLog?.mood ? MOOD_EMOJI[data.dailyLog.mood] ?? data.dailyLog.mood : "--"
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
                {totalActivities > 0 && (
                  <div style={{ textAlign: "center", padding: "8px 0" }}>
                    <div style={{ fontSize: 36, fontWeight: 700, color: "var(--primary)" }}>
                      {completionPct}%
                    </div>
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>
                      ukonczonych aktywnosci ({completedCount}/{totalActivities})
                    </div>
                  </div>
                )}
                {totalCaloriesBurned > 0 && (
                  <div style={{ textAlign: "center", padding: "8px 12px", background: "rgba(239,68,68,0.08)", borderRadius: 12 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "var(--danger)" }}>
                      🔥 {totalCaloriesBurned} kcal
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      spalonych dziś (estymacja)
                    </div>
                  </div>
                )}
                {data?.bmr != null && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--foreground)" }}>
                      <span>🌡️ Spalanie spoczynkowe (BMR)</span>
                      <span style={{ fontWeight: 600 }}>{data.bmr} kcal/dzień</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--foreground)" }}>
                      <span>📊 TDEE (z aktywnościami)</span>
                      <span style={{ fontWeight: 600 }}>{data.tdee ?? 0} kcal/dzień</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--danger)" }}>
                      <span>🔥 Spalone dziś (BMR + aktywności)</span>
                      <span style={{ fontWeight: 700 }}>
                        {(data.bmrSoFarToday ?? 0) + totalCaloriesBurned} kcal
                      </span>
                    </div>
                  </div>
                )}
                <WeightTracker />
                <button
                  onClick={() => router.push("/tracking")}
                  style={{
                    width: "100%",
                    padding: "10px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "var(--primary)",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    marginTop: 4,
                  }}
                >
                  Zobacz pelny tracking →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Dot Indicators ---- */}
      {!loading && (
        <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
          {CAROUSEL_PANELS.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === activePanel ? 16 : 6,
                height: 6,
                borderRadius: 3,
                background: i === activePanel ? "var(--primary)" : "var(--border)",
                transition: "all 250ms ease",
              }}
            />
          ))}
        </div>
      )}

      {/* ---- Universal Input Bar ---- */}
      <div style={{ marginTop: 4 }}>
        <UniversalInputBar onSubmit={handleInputSubmit} isProcessing={isProcessingInput} />
      </div>

      {/* ---- Mentor Follow-Up Sheet ---- */}
      {followUp && (
        <FollowUpSheet
          data={followUp}
          onDismiss={() => setFollowUp(null)}
          onSubmit={async (mentorId, message) => {
            setFollowUp(null);
            try {
              await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mentorId, message }),
              });
              setToast("Odpowiedz wyslana do mentora!");
              setTimeout(() => setToast(null), 3000);
            } catch {
              // silent
            }
          }}
        />
      )}

      {/* ---- Toast ---- */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: "50%",
            transform: "translateX(-50%)",
            background:
              toast.includes("Blad") || toast.includes("error") ? "var(--danger)" : "var(--success)",
            color: "#fff",
            padding: "8px 20px",
            borderRadius: 9999,
            fontSize: 14,
            fontWeight: 500,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 100,
            animation: "fadeInUp 200ms ease-out",
          }}
        >
          {toast}
        </div>
      )}

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes expandIn {
          from { opacity: 0; max-height: 0; }
          to { opacity: 1; max-height: 200px; }
        }
      `}</style>
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
  isExpanded,
  onExpand,
  generatingPlan,
  onGeneratePlan,
}: {
  activity: ActivityData;
  toggling: boolean;
  onToggle: () => void;
  isExpanded: boolean;
  onExpand: () => void;
  generatingPlan: boolean;
  onGeneratePlan: () => void;
}) {
  const canGeneratePlan =
    !!activity.lifeAreaId &&
    (!activity.notes || activity.notes.trim().length < 40);
  return (
    <div>
      <div
        onClick={onExpand}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 4px",
          cursor: "pointer",
          borderRadius: 8,
          background: isExpanded ? "rgba(0,0,0,0.03)" : "transparent",
          transition: "background 150ms ease",
          opacity: toggling ? 0.6 : 1,
          userSelect: "none",
        }}
      >
        {/* Checkbox */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            if (!toggling) onToggle();
          }}
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
            cursor: toggling ? "not-allowed" : "pointer",
            transition: "all 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
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
            flex: 1,
            color: activity.completed ? "var(--muted)" : "var(--foreground)",
            textDecoration: activity.completed ? "line-through" : "none",
            transition: "color 200ms, text-decoration 200ms",
          }}
        >
          {activity.name}
        </span>

        {/* Expand indicator */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transition: "transform 200ms ease",
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
            opacity: 0.5,
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div
          style={{
            padding: "6px 12px 12px 38px",
            fontSize: 13,
            color: "var(--muted)",
            lineHeight: 1.6,
            borderLeft: "2px solid var(--primary)",
            marginLeft: 11,
            animation: "expandIn 200ms ease-out",
            overflow: "hidden",
          }}
        >
          {activity.notes ? (
            <div style={{ whiteSpace: "pre-wrap" }}>{activity.notes}</div>
          ) : (
            <div style={{ fontStyle: "italic", opacity: 0.6 }}>Brak dodatkowych szczegolow</div>
          )}
          {activity.durationMin && (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
              ⏱ {activity.durationMin} min
            </div>
          )}
          {activity.type && (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
              Typ: {activity.type}
            </div>
          )}
          {activity.metrics?.caloriesBurned && activity.completed && (
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--success)", fontWeight: 600 }}>
              🔥 ~{activity.metrics.caloriesBurned} kcal spalonych
            </div>
          )}
          {canGeneratePlan && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!generatingPlan) onGeneratePlan();
              }}
              disabled={generatingPlan}
              style={{
                marginTop: 10,
                padding: "8px 14px",
                borderRadius: 10,
                border: "none",
                background: generatingPlan ? "var(--border)" : "var(--primary)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 600,
                cursor: generatingPlan ? "wait" : "pointer",
                transition: "all 200ms ease",
              }}
            >
              {generatingPlan ? "Generuję..." : "🧠 Generuj plan z mentorem"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StatItem({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span style={{ fontSize: 18, fontWeight: 600, color: "var(--foreground)" }}>{value}</span>
      <span style={{ fontSize: 12, color: "var(--muted)" }}>{label}</span>
    </div>
  );
}
