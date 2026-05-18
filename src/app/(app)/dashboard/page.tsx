"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useBroadcastChannel } from "@/hooks/useBroadcastChannel";
import { useRouter } from "next/navigation";
import { UniversalInputBar } from "@/components/shell/UniversalInputBar";
import { BriefingCard, type BriefingData } from "@/components/briefing/BriefingCard";
import { FollowUpSheet, type FollowUpData } from "@/components/followup/FollowUpSheet";
import WeightTracker from "@/components/weight/WeightTracker";
import VoiceTextarea from "@/components/forms/VoiceTextarea";
import BigTabs from "@/components/ui/BigTabs";
import { format } from "date-fns";
import { pl } from "date-fns/locale";

/* ------------------------------------------------------------------ */
/*  Meal detection (mirror of API logic for client-side UI)            */
/* ------------------------------------------------------------------ */

const MEAL_KEYWORDS = [
  "śniadanie",
  "drugie śniadanie",
  "obiad",
  "kolacja",
  "posiłek",
  "podwieczorek",
  "przekąska",
];

function isMealActivity(name: string): boolean {
  const lower = name.toLowerCase();
  return MEAL_KEYWORDS.some((kw) => lower.includes(kw));
}

interface CustomMealPayload {
  name: string;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  description: string | null;
}

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

interface MeetingItem {
  id: string;
  time: string;
  durationMin: number;
  name: string;
  location: string | null;
  description: string | null;
  attendees: string[];
  hangoutLink: string | null;
  allDay: boolean;
  start: string;
  end: string;
}

interface DashboardData {
  briefing: BriefingData | null;
  schedule: ScheduleItem[];
  activities: ActivityData[];
  meetings?: MeetingItem[];
  calendarError?: string | null;
  dailyLog: DailyLogData | null;
  userName: string;
  bmr?: number;
  tdee?: number;
  bmrSoFarToday?: number;
}

interface HabitWidgetData {
  id: string;
  name: string;
  timeOfDay: string;
}

interface HabitsApiResponse {
  habits: HabitWidgetData[];
  todayCompletions: Record<string, boolean>;
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

  // Plan generation (Plan dnia panel buttons)
  type PlanMode = "auto" | "input" | "replan" | null;
  const [planMode, setPlanMode] = useState<PlanMode>(null);
  const [planContext, setPlanContext] = useState("");
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [planAction, setPlanAction] = useState<"auto" | "input" | "replan" | null>(null);

  const [isGeneratingBriefing, setIsGeneratingBriefing] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Briefing history modal state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<
    Array<{
      id: string;
      date: string;
      summary: string;
      content: string;
      hasAudio: boolean;
      createdAt: string;
    }>
  >([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

  // Broadcast diet-invalidation events to other open pages (e.g. /diet)
  const postInvalidate = useBroadcastChannel("papicoach:diet");
  // Broadcast goal-invalidation events to /goals page
  const postGoalsInvalidate = useBroadcastChannel("papicoach:goals");

  // Habits widget state
  const [habits, setHabits] = useState<HabitWidgetData[]>([]);
  const [habitCompletions, setHabitCompletions] = useState<Record<string, boolean>>({});
  const [togglingHabitIds, setTogglingHabitIds] = useState<Set<string>>(new Set());

  const fetchHabits = useCallback(async () => {
    try {
      const res = await fetch("/api/habits");
      if (!res.ok) return;
      const json: HabitsApiResponse = await res.json();
      setHabits(json.habits);
      setHabitCompletions(json.todayCompletions);
    } catch {
      // ignore
    }
  }, []);

  // Listen for habit toggles from /habits page
  useBroadcastChannel("papicoach:habits", (data) => {
    const msg = data as { type?: string; habitId?: string; completed?: boolean } | null;
    if (!msg) return;
    if (msg.type === "habit-toggled" && msg.habitId) {
      setHabitCompletions((prev) => ({
        ...prev,
        [msg.habitId!]: !!msg.completed,
      }));
    } else if (msg.type === "habit-created" || msg.type === "habit-deleted") {
      fetchHabits();
    }
  });

  const toggleHabit = useCallback(async (habitId: string) => {
    if (togglingHabitIds.has(habitId)) return;
    setTogglingHabitIds((prev) => new Set(prev).add(habitId));

    const prevCompleted = habitCompletions[habitId] ?? false;
    setHabitCompletions((prev) => ({ ...prev, [habitId]: !prevCompleted }));

    try {
      const res = await fetch("/api/habits/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habitId }),
      });
      if (!res.ok) {
        setHabitCompletions((prev) => ({ ...prev, [habitId]: prevCompleted }));
      } else {
        const json = await res.json();
        setHabitCompletions((prev) => ({ ...prev, [habitId]: json.completed }));
      }
    } catch {
      setHabitCompletions((prev) => ({ ...prev, [habitId]: prevCompleted }));
    } finally {
      setTogglingHabitIds((prev) => {
        const next = new Set(prev);
        next.delete(habitId);
        return next;
      });
    }
  }, [habitCompletions, togglingHabitIds]);

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
    fetchHabits();
  }, [fetchDashboard, fetchHabits]);

  // Refetch when the user comes back to this page (tab focus / route change back to /dashboard)
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        fetchDashboard();
        fetchHabits();
      }
    };
    document.addEventListener("visibilitychange", handler);
    window.addEventListener("focus", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      window.removeEventListener("focus", handler);
    };
  }, [fetchDashboard, fetchHabits]);

  const toggleActivity = async (activityId: string, customMeal?: CustomMealPayload) => {
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
        body: JSON.stringify(customMeal ? { activityId, customMeal } : { activityId }),
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
        if (json.mealRemoved) {
          setToast(`Usunieto z diety: ${json.mealRemoved.name}`);
          setTimeout(() => setToast(null), 3000);
        }
        if (json.planTaskUpdated) {
          setToast(`Postęp celu: ${json.planTaskUpdated.goalProgress}%`);
          setTimeout(() => setToast(null), 3000);
          // Notify /goals that plan task + goal progress changed
          postGoalsInvalidate({ type: "plan-task-toggled" });
        }
        // Notify /diet (and any other open listeners) that today's diet data changed
        postInvalidate({ type: "activity-toggled", activityId });
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

  const generateBriefing = useCallback(async (opts?: { regenerate?: boolean }) => {
    setIsGeneratingBriefing(true);
    setStreamingText("");
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/briefing/generate", {
        method: "POST",
        signal: abortRef.current.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate: Boolean(opts?.regenerate) }),
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

  const openHistory = useCallback(async () => {
    setHistoryOpen(true);
    setExpandedHistoryId(null);
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/briefing/history");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setHistoryItems(Array.isArray(json.items) ? json.items : []);
    } catch (err) {
      console.error("Briefing history error:", err);
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
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

  const runPlanGeneration = useCallback(
    async (action: "auto" | "input" | "replan", userContext?: string) => {
      setIsGeneratingPlan(true);
      setPlanAction(action);
      try {
        const endpoint =
          action === "replan" ? "/api/plan/replan" : "/api/plan/generate";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userContext: userContext ?? "" }),
        });
        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: "Blad generowania planu" }));
          throw new Error(err.error || "Blad generowania planu");
        }
        const json = await res.json();
        await fetchDashboard();
        setPlanMode(null);
        setPlanContext("");
        if (action === "replan") {
          setToast(
            `Plan przepracowany — zachowano ${json.kept ?? 0} ukonczonych`
          );
        } else {
          setToast("Plan wygenerowany!");
        }
        setTimeout(() => setToast(null), 3500);
      } catch (err) {
        setToast(
          err instanceof Error ? err.message : "Blad generowania planu"
        );
        setTimeout(() => setToast(null), 4000);
      } finally {
        setIsGeneratingPlan(false);
        setPlanAction(null);
      }
    },
    [fetchDashboard]
  );

  const handleAutoGenerate = useCallback(() => {
    if (isGeneratingPlan) return;
    const hasActivities = (data?.activities.length ?? 0) > 0;
    if (hasActivities) {
      const ok = window.confirm(
        "Wygenerowac plan? Istniejace aktywnosci zostana zastapione."
      );
      if (!ok) return;
    }
    runPlanGeneration("auto");
  }, [data?.activities.length, isGeneratingPlan, runPlanGeneration]);

  const handleInputGenerate = useCallback(() => {
    if (isGeneratingPlan) return;
    runPlanGeneration("input", planContext.trim() || undefined);
  }, [isGeneratingPlan, planContext, runPlanGeneration]);

  const handleReplan = useCallback(() => {
    if (isGeneratingPlan) return;
    runPlanGeneration("replan", planContext.trim() || undefined);
  }, [isGeneratingPlan, planContext, runPlanGeneration]);

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
        // Universal input may have created/updated meals — invalidate diet listeners
        postInvalidate({ type: "input-processed" });
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
    [fetchDashboard, postInvalidate]
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

  const meetingsByBlock: Record<string, MeetingItem[]> = {
    morning: [],
    afternoon: [],
    evening: [],
  };
  if (data?.meetings) {
    for (const m of data.meetings) {
      const block = m.allDay ? "morning" : timeBlock(m.time);
      meetingsByBlock[block].push(m);
    }
    for (const key of Object.keys(meetingsByBlock) as Array<keyof typeof meetingsByBlock>) {
      meetingsByBlock[key].sort((a, b) => a.time.localeCompare(b.time));
    }
  }
  const hasAnyMeeting = (data?.meetings?.length ?? 0) > 0;

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

      <BigTabs
        tabs={CAROUSEL_PANELS.map((label, i) => ({
          key: String(i),
          label,
        }))}
        active={String(activePanel)}
        onChange={(k) => setActivePanel(Number(k))}
      />

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
              {/* Plan generation buttons (TOP of Plan dnia panel) */}
              <div style={{ ...cardStyle, marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0, marginBottom: 10 }}>
                  Wygeneruj plan dnia
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleAutoGenerate}
                    disabled={isGeneratingPlan}
                    style={{
                      padding: "12px 10px",
                      borderRadius: 10,
                      border: "none",
                      background: "var(--primary)",
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: isGeneratingPlan ? "not-allowed" : "pointer",
                      opacity: isGeneratingPlan && planAction !== "auto" ? 0.5 : 1,
                      boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                      transition: "background 150ms ease, opacity 150ms ease",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      minHeight: 44,
                    }}
                  >
                    {isGeneratingPlan && planAction === "auto" ? (
                      <>
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            border: "2px solid #fff",
                            borderTopColor: "transparent",
                            animation: "vt-spin 0.8s linear infinite",
                          }}
                        />
                        Mentor planuje...
                      </>
                    ) : (
                      <>⚡ Wygeneruj automatycznie</>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isGeneratingPlan) return;
                      setPlanMode(planMode === "input" ? null : "input");
                      setPlanContext("");
                    }}
                    disabled={isGeneratingPlan}
                    style={{
                      padding: "12px 10px",
                      borderRadius: 10,
                      border: `1px solid ${planMode === "input" ? "var(--primary)" : "var(--border)"}`,
                      background: planMode === "input" ? "rgba(59, 130, 246, 0.08)" : "var(--card)",
                      color: "var(--foreground)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: isGeneratingPlan ? "not-allowed" : "pointer",
                      opacity: isGeneratingPlan ? 0.5 : 1,
                      transition: "background 150ms ease, border-color 150ms ease",
                      minHeight: 44,
                    }}
                  >
                    💬 Wygeneruj z wkladem
                  </button>
                </div>

                {totalActivities > 0 && completedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (isGeneratingPlan) return;
                      setPlanMode(planMode === "replan" ? null : "replan");
                      setPlanContext("");
                    }}
                    disabled={isGeneratingPlan}
                    style={{
                      marginTop: 8,
                      width: "100%",
                      padding: "12px 10px",
                      borderRadius: 10,
                      border: `1px solid ${planMode === "replan" ? "var(--primary)" : "var(--border)"}`,
                      background: planMode === "replan" ? "rgba(59, 130, 246, 0.08)" : "var(--card)",
                      color: "var(--foreground)",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: isGeneratingPlan ? "not-allowed" : "pointer",
                      opacity: isGeneratingPlan ? 0.5 : 1,
                      transition: "background 150ms ease, border-color 150ms ease",
                      minHeight: 44,
                    }}
                  >
                    🔄 Przeplanuj reszte ({completedCount} ukonczonych zostanie zachowanych)
                  </button>
                )}

                {planMode === "input" && (
                  <div
                    style={{
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: "1px solid var(--border)",
                      animation: "expandIn 200ms ease-out",
                    }}
                  >
                    <p style={{ fontSize: 12, color: "var(--muted)", margin: 0, marginBottom: 8 }}>
                      Jak minela noc? Co chcesz uwzglednic dzis? Ograniczenia?
                    </p>
                    <VoiceTextarea
                      value={planContext}
                      onChange={setPlanContext}
                      placeholder="np. spalem 5h, jutro wyjazd, dzis bez treningu nog"
                      minHeight={70}
                      disabled={isGeneratingPlan}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        onClick={handleInputGenerate}
                        disabled={isGeneratingPlan}
                        style={{
                          flex: 1,
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: "none",
                          background: "var(--primary)",
                          color: "#fff",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: isGeneratingPlan ? "not-allowed" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          minHeight: 40,
                        }}
                      >
                        {isGeneratingPlan && planAction === "input" ? (
                          <>
                            <span
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: "50%",
                                border: "2px solid #fff",
                                borderTopColor: "transparent",
                                animation: "vt-spin 0.8s linear infinite",
                              }}
                            />
                            Mentor planuje...
                          </>
                        ) : (
                          "Generuj"
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlanMode(null);
                          setPlanContext("");
                        }}
                        disabled={isGeneratingPlan}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: "1px solid var(--border)",
                          background: "var(--card)",
                          color: "var(--foreground)",
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: isGeneratingPlan ? "not-allowed" : "pointer",
                          minHeight: 40,
                        }}
                      >
                        Anuluj
                      </button>
                    </div>
                  </div>
                )}

                {planMode === "replan" && (
                  <div
                    style={{
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: "1px solid var(--border)",
                      animation: "expandIn 200ms ease-out",
                    }}
                  >
                    <p style={{ fontSize: 12, color: "var(--muted)", margin: 0, marginBottom: 8 }}>
                      Co sie zmienilo? (opcjonalnie)
                    </p>
                    <VoiceTextarea
                      value={planContext}
                      onChange={setPlanContext}
                      placeholder="np. spotkanie sie przedluzylo, padam z energii"
                      minHeight={70}
                      disabled={isGeneratingPlan}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        onClick={handleReplan}
                        disabled={isGeneratingPlan}
                        style={{
                          flex: 1,
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: "none",
                          background: "var(--primary)",
                          color: "#fff",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: isGeneratingPlan ? "not-allowed" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          minHeight: 40,
                        }}
                      >
                        {isGeneratingPlan && planAction === "replan" ? (
                          <>
                            <span
                              style={{
                                width: 12,
                                height: 12,
                                borderRadius: "50%",
                                border: "2px solid #fff",
                                borderTopColor: "transparent",
                                animation: "vt-spin 0.8s linear infinite",
                              }}
                            />
                            Mentor planuje...
                          </>
                        ) : (
                          "Przeplanuj"
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPlanMode(null);
                          setPlanContext("");
                        }}
                        disabled={isGeneratingPlan}
                        style={{
                          padding: "10px 14px",
                          borderRadius: 10,
                          border: "1px solid var(--border)",
                          background: "var(--card)",
                          color: "var(--foreground)",
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: isGeneratingPlan ? "not-allowed" : "pointer",
                          minHeight: 40,
                        }}
                      >
                        Anuluj
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={cardStyle}>
                {/* Habits mini-widget */}
                {habits.length > 0 && (
                  <div
                    style={{
                      marginBottom: 14,
                      paddingBottom: 14,
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 8,
                      }}
                    >
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
                        ✅ Nawyki dzisiaj
                      </h3>
                      <button
                        onClick={() => router.push("/habits")}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--primary)",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        Zobacz wszystkie →
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {habits.slice(0, 5).map((h) => {
                        const completed = habitCompletions[h.id] ?? false;
                        const toggling = togglingHabitIds.has(h.id);
                        return (
                          <div
                            key={h.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "6px 2px",
                              opacity: toggling ? 0.6 : 1,
                              transition: "opacity 150ms ease",
                            }}
                          >
                            <div
                              onClick={() => {
                                if (!toggling) toggleHabit(h.id);
                              }}
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 5,
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
                                  width="12"
                                  height="12"
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
                            <span
                              style={{
                                fontSize: 13,
                                flex: 1,
                                color: completed ? "var(--muted)" : "var(--foreground)",
                                textDecoration: completed ? "line-through" : "none",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                transition: "color 200ms",
                              }}
                            >
                              {h.name}
                            </span>
                          </div>
                        );
                      })}
                      {habits.length > 5 && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--muted)",
                            marginTop: 4,
                            paddingLeft: 30,
                          }}
                        >
                          +{habits.length - 5} więcej nawyków...
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Plan dnia</h2>
                  {totalActivities > 0 && (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{completionPct}% gotowe</span>
                  )}
                </div>

                {data && data.activities.length === 0 && data.schedule.length === 0 && !hasAnyMeeting ? (
                  <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 10, textAlign: "center" }}>
                    Brak zaplanowanych aktywnosci na dzis
                  </p>
                ) : (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 14 }}>
                    {(["morning", "afternoon", "evening"] as const).map((block) => {
                      const items = grouped[block];
                      const meetings = meetingsByBlock[block] ?? [];
                      if (items.length === 0 && meetings.length === 0) return null;
                      // Merge activities + meetings into one time-sorted list.
                      // Each entry has 'time' for sort comparison.
                      type MergedEntry =
                        | { kind: "activity"; time: string; data: ActivityData }
                        | { kind: "meeting"; time: string; data: MeetingItem };
                      const merged: MergedEntry[] = [
                        ...items.map<MergedEntry>((act) => ({
                          kind: "activity",
                          time: act.scheduledAt ?? "23:59",
                          data: act,
                        })),
                        ...meetings.map<MergedEntry>((m) => ({
                          kind: "meeting",
                          time: m.time || "23:59",
                          data: m,
                        })),
                      ].sort((a, b) => a.time.localeCompare(b.time));
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
                            {merged.map((entry) => {
                              if (entry.kind === "meeting") {
                                const m = entry.data;
                                return (
                                  <MeetingRow
                                    key={`meet-${m.id}`}
                                    meeting={m}
                                    isExpanded={expandedId === `meet-${m.id}`}
                                    onExpand={() =>
                                      setExpandedId(
                                        expandedId === `meet-${m.id}`
                                          ? null
                                          : `meet-${m.id}`,
                                      )
                                    }
                                  />
                                );
                              }
                              const act = entry.data;
                              return (
                                <ActivityRow
                                  key={act.id}
                                  activity={act}
                                  toggling={togglingIds.has(act.id)}
                                  onToggle={() => toggleActivity(act.id)}
                                  onSubmitCustomMeal={(meal) => toggleActivity(act.id, meal)}
                                  isExpanded={expandedId === act.id}
                                  onExpand={() => setExpandedId(expandedId === act.id ? null : act.id)}
                                  generatingPlan={generatingPlanIds.has(act.id)}
                                  onGeneratePlan={() => generatePlan(act.id)}
                                  onToast={(msg) => {
                                    setToast(msg);
                                    setTimeout(() => setToast(null), 3000);
                                  }}
                                />
                              );
                            })}
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
                onGenerate={() => generateBriefing()}
                onRegenerate={() => generateBriefing({ regenerate: true })}
                onGenerateAudio={generateAudio}
                isGeneratingAudio={isGeneratingAudio}
                onShowHistory={openHistory}
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

      {/* ---- Briefing History Modal ---- */}
      {historyOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Historia briefingów"
          onClick={() => setHistoryOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--card)",
              borderRadius: 16,
              width: "100%",
              maxWidth: 600,
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 16px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
                  📚 Historia briefingów
                </h2>
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  Ostatnie 30 dni
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Zamknij"
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 22,
                  color: "var(--muted)",
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: 4,
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                overflowY: "auto",
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {historyLoading ? (
                <p
                  style={{
                    textAlign: "center",
                    color: "var(--muted)",
                    fontSize: 14,
                    margin: "20px 0",
                  }}
                >
                  Ładowanie...
                </p>
              ) : historyItems.length === 0 ? (
                <p
                  style={{
                    textAlign: "center",
                    color: "var(--muted)",
                    fontSize: 14,
                    margin: "20px 0",
                  }}
                >
                  Brak briefingów w ostatnich 30 dniach.
                </p>
              ) : (
                historyItems.map((item) => {
                  const isExpanded = expandedHistoryId === item.id;
                  return (
                    <div
                      key={item.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        overflow: "hidden",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedHistoryId(isExpanded ? null : item.id)
                        }
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          background: "transparent",
                          border: "none",
                          textAlign: "left",
                          cursor: "pointer",
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          color: "var(--foreground)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <strong style={{ fontSize: 13 }}>{item.date}</strong>
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>
                            {item.hasAudio ? "🔊 " : ""}
                            {isExpanded ? "▲" : "▼"}
                          </span>
                        </div>
                        {!isExpanded && (
                          <p
                            style={{
                              margin: 0,
                              fontSize: 12,
                              color: "var(--muted)",
                              lineHeight: 1.4,
                            }}
                          >
                            {item.summary}…
                          </p>
                        )}
                      </button>
                      {isExpanded && (
                        <div
                          style={{
                            padding: "10px 12px 12px",
                            fontSize: 13,
                            lineHeight: 1.6,
                            color: "var(--foreground)",
                            whiteSpace: "pre-wrap",
                            borderTop: "1px solid var(--border)",
                          }}
                        >
                          {item.content}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
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
        @keyframes vt-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function MeetingRow({
  meeting,
  isExpanded,
  onExpand,
}: {
  meeting: MeetingItem;
  isExpanded: boolean;
  onExpand: () => void;
}) {
  const endLabel = (() => {
    try {
      const end = new Date(meeting.end);
      const hh = end.getHours().toString().padStart(2, "0");
      const mm = end.getMinutes().toString().padStart(2, "0");
      return `${hh}:${mm}`;
    } catch {
      return null;
    }
  })();
  return (
    <div
      style={{
        background: "rgba(59, 130, 246, 0.08)",
        border: "1px solid rgba(59, 130, 246, 0.25)",
        borderRadius: 10,
        padding: "10px 12px",
        cursor: "pointer",
      }}
      onClick={onExpand}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#1d4ed8",
            background: "rgba(59, 130, 246, 0.18)",
            padding: "2px 8px",
            borderRadius: 999,
            letterSpacing: 0.3,
          }}
        >
          📅 Spotkanie
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
          {meeting.allDay
            ? "Cały dzień"
            : `${meeting.time}${endLabel ? `–${endLabel}` : ""}`}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--foreground)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {meeting.name}
        </span>
      </div>
      {isExpanded && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px dashed rgba(59, 130, 246, 0.3)",
            fontSize: 12,
            color: "var(--foreground)",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {meeting.location && (
            <div>
              <strong style={{ color: "var(--muted)" }}>Lokalizacja: </strong>
              {meeting.location}
            </div>
          )}
          {meeting.hangoutLink && (
            <div>
              <strong style={{ color: "var(--muted)" }}>Meet: </strong>
              <a
                href={meeting.hangoutLink}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{ color: "#1d4ed8" }}
              >
                {meeting.hangoutLink}
              </a>
            </div>
          )}
          {meeting.attendees.length > 0 && (
            <div>
              <strong style={{ color: "var(--muted)" }}>Uczestnicy: </strong>
              {meeting.attendees.join(", ")}
            </div>
          )}
          {meeting.description && (
            <div style={{ whiteSpace: "pre-wrap", color: "var(--muted)" }}>
              {meeting.description}
            </div>
          )}
          {!meeting.location &&
            !meeting.hangoutLink &&
            meeting.attendees.length === 0 &&
            !meeting.description && (
              <div style={{ color: "var(--muted)" }}>
                Brak dodatkowych szczegółów.
              </div>
            )}
        </div>
      )}
    </div>
  );
}

function ActivityRow({
  activity,
  toggling,
  onToggle,
  onSubmitCustomMeal,
  isExpanded,
  onExpand,
  generatingPlan,
  onGeneratePlan,
  onToast,
}: {
  activity: ActivityData;
  toggling: boolean;
  onToggle: () => void;
  onSubmitCustomMeal: (meal: CustomMealPayload) => void;
  isExpanded: boolean;
  onExpand: () => void;
  generatingPlan: boolean;
  onGeneratePlan: () => void;
  onToast: (msg: string) => void;
}) {
  const canGeneratePlan =
    !!activity.lifeAreaId &&
    (!activity.notes || activity.notes.trim().length < 40);
  const isMeal = isMealActivity(activity.name);

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

          {/* Custom meal swap — only for meal-type activities that aren't completed yet */}
          {isMeal && !activity.completed && (
            <CustomMealForm
              activityName={activity.name}
              disabled={toggling}
              onSubmit={onSubmitCustomMeal}
              onToast={onToast}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CustomMealForm — inline form for "ate something different"         */
/* ------------------------------------------------------------------ */

function CustomMealForm({
  activityName,
  disabled,
  onSubmit,
  onToast,
}: {
  activityName: string;
  disabled: boolean;
  onSubmit: (meal: CustomMealPayload) => void;
  onToast: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleEstimate = async () => {
    const src = description.trim() || name.trim();
    if (!src) {
      onToast("Wpisz opis posiłku");
      return;
    }
    setEstimating(true);
    try {
      const res = await fetch("/api/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: src, description: src, autoEstimate: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Oszacowanie nie powiodło się");
      }
      const data = await res.json();
      const est = data.estimate as {
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
        foods: string[];
      };
      setCalories(String(est.calories));
      setProtein(String(est.protein));
      setCarbs(String(est.carbs));
      setFat(String(est.fat));
      if (!name.trim() && est.foods.length > 0) {
        setName(est.foods.join(", "));
      }
      onToast("Oszacowano przez AI");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Błąd AI");
    } finally {
      setEstimating(false);
    }
  };

  const handlePhotoClick = () => {
    if (recognizing) return;
    fileInputRef.current?.click();
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      onToast("Plik za duży (max 5MB)");
      return;
    }
    setRecognizing(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch("/api/meals/recognize-image", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Rozpoznawanie nie powiodło się");
      }
      const data = (await res.json()) as {
        name: string;
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
      };
      setName(data.name || "Posiłek");
      setCalories(String(data.calories));
      setProtein(String(data.protein));
      setCarbs(String(data.carbs));
      setFat(String(data.fat));
      onToast("Rozpoznano ze zdjęcia");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Błąd rozpoznawania");
    } finally {
      setRecognizing(false);
    }
  };

  const handleSubmit = (e: React.MouseEvent) => {
    e.stopPropagation();
    const finalName = name.trim() || activityName;
    const cal = parseFloat(calories);
    if (!finalName || !calories || Number.isNaN(cal) || cal <= 0) {
      onToast("Podaj nazwę i kalorie posiłku");
      return;
    }
    onSubmit({
      name: finalName,
      calories: Math.round(cal),
      protein: protein ? parseFloat(protein) : null,
      carbs: carbs ? parseFloat(carbs) : null,
      fat: fat ? parseFloat(fat) : null,
      description: description.trim() || null,
    });
    setOpen(false);
    setName("");
    setDescription("");
    setCalories("");
    setProtein("");
    setCarbs("");
    setFat("");
  };

  if (!open) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        style={{
          marginTop: 10,
          padding: "8px 14px",
          borderRadius: 10,
          border: "1px dashed var(--border)",
          background: "transparent",
          color: "var(--foreground)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 200ms ease",
        }}
      >
        🍽️ Zjadłem coś innego
      </button>
    );
  }

  const miniInput: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--background)",
    color: "var(--foreground)",
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  };

  const miniLabel: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 500,
    color: "var(--muted)",
    marginBottom: 3,
    display: "block",
  };

  const miniBtn: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--foreground)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: 10,
        padding: 12,
        borderRadius: 10,
        background: "var(--background)",
        border: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
          🍽️ Co zjadłeś?
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
          style={{
            background: "none",
            border: "none",
            color: "var(--muted)",
            fontSize: 16,
            cursor: "pointer",
            padding: 2,
            lineHeight: 1,
          }}
          aria-label="Zamknij"
        >
          ✕
        </button>
      </div>

      <div>
        <label style={miniLabel}>Nazwa (opcjonalnie)</label>
        <input
          style={miniInput}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`np. ${activityName}`}
        />
      </div>

      <div>
        <label style={miniLabel}>Opis (dla AI)</label>
        <VoiceTextarea
          value={description}
          onChange={setDescription}
          placeholder="np. 2 jajka, 50g szynki, kromka chleba"
          minHeight={60}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoChange}
        style={{ display: "none" }}
      />

      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleEstimate();
          }}
          disabled={estimating || recognizing || (!description.trim() && !name.trim())}
          style={{
            ...miniBtn,
            flex: 1,
            opacity:
              estimating || recognizing || (!description.trim() && !name.trim()) ? 0.5 : 1,
          }}
        >
          {estimating ? "⏳ Szacuję..." : "🤖 Oszacuj z AI"}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handlePhotoClick();
          }}
          disabled={recognizing || estimating}
          style={{
            ...miniBtn,
            flex: 1,
            opacity: recognizing || estimating ? 0.5 : 1,
          }}
        >
          {recognizing ? "⏳ Rozpoznaję..." : "📸 Zdjęcie posiłku"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <div>
          <label style={miniLabel}>Kcal</label>
          <input
            style={miniInput}
            type="number"
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
            placeholder="0"
          />
        </div>
        <div>
          <label style={miniLabel}>Białko (g)</label>
          <input
            style={miniInput}
            type="number"
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
            placeholder="0"
          />
        </div>
        <div>
          <label style={miniLabel}>Węgle (g)</label>
          <input
            style={miniInput}
            type="number"
            value={carbs}
            onChange={(e) => setCarbs(e.target.value)}
            placeholder="0"
          />
        </div>
        <div>
          <label style={miniLabel}>Tłuszcz (g)</label>
          <input
            style={miniInput}
            type="number"
            value={fat}
            onChange={(e) => setFat(e.target.value)}
            placeholder="0"
          />
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={disabled || estimating || recognizing}
        style={{
          marginTop: 4,
          padding: "9px 14px",
          borderRadius: 10,
          border: "none",
          background: "var(--primary)",
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          cursor: disabled || estimating || recognizing ? "wait" : "pointer",
          opacity: disabled || estimating || recognizing ? 0.6 : 1,
        }}
      >
        ✓ Zapisz i oznacz jako zjedzone
      </button>
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
