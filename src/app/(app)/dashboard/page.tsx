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
import { SwipeDeck, SegmentedTabs, AnimatedNumber } from "@/components/motion";
import {
  Button,
  Card,
  EmptyState,
  ListRow,
  Pressable,
  Skeleton,
  Stat,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
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
  completed: boolean;
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

const MOOD_LABEL: Record<string, string> = {
  great: "Świetnie",
  good: "Dobrze",
  ok: "Ok",
  bad: "Słabo",
  terrible: "Źle",
};

function timeBlock(time: string): "morning" | "afternoon" | "evening" {
  const hour = parseInt(time.split(":")[0], 10);
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

const BLOCK_LABELS: Record<string, string> = {
  morning: "Rano",
  afternoon: "Popołudnie",
  evening: "Wieczór",
};

const CAROUSEL_PANELS = ["Plan dnia", "Briefing", "Statystyki"] as const;

/* ------------------------------------------------------------------ */
/*  Dashboard Page                                                     */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const [togglingMeetings, setTogglingMeetings] = useState<Set<string>>(new Set());

  const [activePanel, setActivePanel] = useState(0);
  /** Minutes since midnight, set after mount so SSR and client HTML match. */
  const [nowMin, setNowMin] = useState<number | null>(null);

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

    // Confirm the touch immediately, before the network call.
    haptic.tap();

    const prevCompleted = habitCompletions[habitId] ?? false;
    setHabitCompletions((prev) => ({ ...prev, [habitId]: !prevCompleted }));

    try {
      const res = await fetch("/api/habits/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ habitId }),
      });
      if (!res.ok) {
        haptic.error();
        setHabitCompletions((prev) => ({ ...prev, [habitId]: prevCompleted }));
      } else {
        const json = await res.json();
        setHabitCompletions((prev) => ({ ...prev, [habitId]: json.completed }));
      }
    } catch {
      haptic.error();
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

    // Silent background: finalize yesterday's briefing if it wasn't finalized
    // (user generated it early in the day, day has now ended).
    // No toast, no UI feedback — runs once on mount.
    fetch("/api/briefing/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        // If we actually finalized something, refresh dashboard so the new
        // content shows up next time the user opens the briefing card.
        if (json?.finalized && !json?.alreadyFinal) {
          fetchDashboard();
        }
      })
      .catch(() => {
        // silent — never disturb the user with finalize errors
      });
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

    // Confirm the touch immediately, before the network call.
    haptic.tap();

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
        haptic.error();
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
      haptic.error();
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

  const toggleMeeting = async (externalId: string) => {
    if (togglingMeetings.has(externalId)) return;
    setTogglingMeetings((prev) => new Set(prev).add(externalId));

    // Optimistic update
    setData((prev) => {
      if (!prev || !prev.meetings) return prev;
      return {
        ...prev,
        meetings: prev.meetings.map((m) =>
          m.id === externalId ? { ...m, completed: !m.completed } : m,
        ),
      };
    });

    // YYYY-MM-DD in Europe/Warsaw — same day the dashboard is showing
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;

    try {
      const res = await fetch("/api/calendar/meeting-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalId, date: dateStr }),
      });
      if (!res.ok) {
        // Rollback
        setData((prev) => {
          if (!prev || !prev.meetings) return prev;
          return {
            ...prev,
            meetings: prev.meetings.map((m) =>
              m.id === externalId ? { ...m, completed: !m.completed } : m,
            ),
          };
        });
      } else {
        const json = (await res.json()) as { completed?: boolean };
        if (typeof json.completed === "boolean") {
          setData((prev) => {
            if (!prev || !prev.meetings) return prev;
            return {
              ...prev,
              meetings: prev.meetings.map((m) =>
                m.id === externalId ? { ...m, completed: json.completed as boolean } : m,
              ),
            };
          });
        }
      }
    } catch {
      // Rollback on network error
      setData((prev) => {
        if (!prev || !prev.meetings) return prev;
        return {
          ...prev,
          meetings: prev.meetings.map((m) =>
            m.id === externalId ? { ...m, completed: !m.completed } : m,
          ),
        };
      });
    } finally {
      setTogglingMeetings((prev) => {
        const next = new Set(prev);
        next.delete(externalId);
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
      haptic.success();
      setToast(`Plan od ${json.mentorName} gotowy!`);
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      haptic.error();
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
        haptic.success();
        if (action === "replan") {
          setToast(
            `Plan przepracowany — zachowano ${json.kept ?? 0} ukonczonych`
          );
        } else {
          setToast("Plan wygenerowany!");
        }
        setTimeout(() => setToast(null), 3500);
      } catch (err) {
        haptic.error();
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

  /* Wall clock for the "Teraz" row. Ticks once a minute; never during SSR. */
  useEffect(() => {
    const read = () => {
      const d = new Date();
      setNowMin(d.getHours() * 60 + d.getMinutes());
    };
    read();
    const id = window.setInterval(read, 60_000);
    return () => window.clearInterval(id);
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

  /* --------------------------------------------------------------- */
  /*  Derived view data (no business logic - shaping only)             */
  /* --------------------------------------------------------------- */

  const burnedToday = (data?.bmrSoFarToday ?? 0) + totalCaloriesBurned;
  const doneHabits = habits.filter((h) => habitCompletions[h.id]).length;
  const isDayEmpty =
    !!data && data.activities.length === 0 && data.schedule.length === 0 && !hasAnyMeeting;

  // "Teraz" row: first unfinished activity of the day, in schedule order.
  // Sorted deterministically so server and client HTML match.
  const nextActivity =
    [...(data?.activities ?? [])]
      .sort((a, b) => (a.scheduledAt ?? "23:59").localeCompare(b.scheduledAt ?? "23:59"))
      .find((a) => !a.completed) ?? null;

  const nextIsNow =
    nowMin != null && nextActivity?.scheduledAt
      ? (() => {
          const [h, m] = nextActivity.scheduledAt.split(":").map(Number);
          return h * 60 + m <= nowMin;
        })()
      : false;

  const focusActivity = (id: string) => {
    setActivePanel(0);
    setExpandedId(id);
    window.setTimeout(() => {
      document.getElementById(`act-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 420);
  };

  const planButtons = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      <Button
        variant="secondary"
        size="md"
        fullWidth
        disabled={isGeneratingPlan}
        onPress={() => {
          if (isGeneratingPlan) return;
          setPlanMode(planMode === "input" ? null : "input");
          setPlanContext("");
        }}
      >
        Zaplanuj z mentorem
      </Button>
      {totalActivities > 0 && completedCount > 0 && (
        <Button
          variant="ghost"
          size="md"
          fullWidth
          disabled={isGeneratingPlan}
          onPress={() => {
            if (isGeneratingPlan) return;
            setPlanMode(planMode === "replan" ? null : "replan");
            setPlanContext("");
          }}
        >
          Przeplanuj resztę dnia
        </Button>
      )}
      <Button
        variant="ghost"
        size="md"
        fullWidth
        loading={isGeneratingPlan && planAction === "auto"}
        disabled={isGeneratingPlan && planAction !== "auto"}
        onPress={handleAutoGenerate}
      >
        Wygeneruj plan od nowa
      </Button>
    </div>
  );

  return (
    <div
      style={{
        padding: "16px var(--gutter) 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* ---- Header: date whispered, name loud, day type as a quiet badge ---- */}
      <header
        className="anim-in"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="t-label" style={{ marginBottom: 6 }}>
            {dateStr}
          </div>
          {loading ? (
            <Skeleton variant="line" width="72%" height={26} />
          ) : (
            <h1 className="t-title1" style={{ color: "var(--text)", margin: 0 }}>
              {firstName ? `Dzień dobry, ${firstName}` : "Dzień dobry"}
            </h1>
          )}
        </div>
        {data?.dailyLog?.dayType && (
          <span
            className="fade-scale"
            style={{
              flexShrink: 0,
              marginTop: 2,
              padding: "5px 10px",
              borderRadius: "var(--r-full)",
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text-2)",
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {DAY_TYPE_LABELS[data.dailyLog.dayType] ?? data.dailyLog.dayType}
          </span>
        )}
      </header>

      {/* ---- HERO: the one number of the screen ---- */}
      <section
        className="card-hero anim-in"
        style={{ animationDelay: "60ms", position: "relative" }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          {data?.dailyLog?.mood && (
            <span
              style={{
                alignSelf: "flex-end",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 10px",
                borderRadius: "var(--r-full)",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
              }}
            >
              <span style={{ fontSize: 15, lineHeight: 1 }}>
                {MOOD_EMOJI[data.dailyLog.mood] ?? "\u{1F642}"}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>
                {MOOD_LABEL[data.dailyLog.mood] ?? data.dailyLog.mood}
              </span>
            </span>
          )}

          {loading ? (
            <Skeleton variant="circle" height={172} />
          ) : (
            <DayRing pct={completionPct} />
          )}

          <div
            style={{
              fontSize: 15,
              lineHeight: 1.4,
              color: "var(--text-2)",
              textAlign: "center",
            }}
          >
            {loading
              ? " "
              : totalActivities > 0
                ? `${completedCount} z ${totalActivities} zadań zrobione`
                : "Dzień czeka na plan"}
          </div>
        </div>

        {nextActivity && (
          <>
            <div className="divider" />
            <Pressable
              as="div"
              press="lg"
              haptic="tap"
              noMinSize
              ariaLabel={`Przejdź do: ${nextActivity.name}`}
              onPress={() => focusActivity(nextActivity.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                minHeight: 44,
                padding: "0 2px",
                borderRadius: "var(--r-md)",
              }}
            >
              <span
                className={nextIsNow ? "glow-pulse" : undefined}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: "var(--accent-fill)",
                }}
              />
              <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <span className="t-label" style={{ display: "block" }}>
                  {nextIsNow ? "Teraz" : "Następne"}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: 17,
                    fontWeight: 600,
                    color: "var(--text)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {nextActivity.name}
                </span>
              </span>
              {nextActivity.scheduledAt && (
                <span
                  className="num"
                  style={{ fontSize: 13, fontWeight: 600, color: "var(--text-3)", flexShrink: 0 }}
                >
                  {nextActivity.scheduledAt}
                </span>
              )}
              <ChevronRight />
            </Pressable>
          </>
        )}
      </section>

      {/* ---- Three tiles: the numbers of the day ---- */}
      <div
        className="anim-stagger"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        <MetricTile label="Energia" value={data?.dailyLog?.energy ?? null} unit="/10" />
        <MetricTile
          label="Sen"
          value={data?.dailyLog?.sleepHours ?? null}
          unit="h"
          decimals={1}
        />
        <MetricTile
          label="Spalone"
          value={totalCaloriesBurned > 0 ? totalCaloriesBurned : null}
          unit="kcal"
        />
      </div>

      {/* ---- Google Calendar error banner ---- */}
      {!loading && data?.calendarError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: "var(--r-md)",
            background: "var(--warning-soft)",
            border: "1px solid var(--warning)",
          }}
        >
          <span style={{ fontSize: 18, flexShrink: 0 }} aria-hidden="true">
            ⚠️
          </span>
          <div style={{ flex: 1, minWidth: 0, color: "var(--text-2)", fontSize: 13, lineHeight: 1.4 }}>
            {data.calendarError === "refresh_failed"
              ? "Połączenie z Google Calendar wygasło — spotkania nie są pobierane."
              : data.calendarError === "not_connected"
                ? "Google Calendar nie jest połączony."
                : data.calendarError === "missing_scope"
                  ? "Brak uprawnień do kalendarza — połącz ponownie."
                  : "Nie udało się pobrać kalendarza Google."}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => router.push("/admin?tab=settings")}
          >
            Połącz
          </Button>
        </div>
      )}

      {/* ---- Tabs (swipeable) ---- */}
      <div style={{ marginTop: 12 }}>
        <SegmentedTabs
          tabs={CAROUSEL_PANELS.map((label, i) => ({ key: String(i), label }))}
          active={String(activePanel)}
          onChange={(k) => setActivePanel(Number(k))}
          ariaLabel="Panele dnia"
        />
      </div>

      {/* ---- Deck: same state as the tabs, so swipe and tap agree ---- */}
      {loading ? (
        <Skeleton variant="card" count={5} />
      ) : (
        <SwipeDeck
          index={activePanel}
          onChange={setActivePanel}
          labels={CAROUSEL_PANELS}
          showDots
          ariaLabel="Panele dnia"
          heightPadding={2}
        >
          {/* ---------------- Panel 0: Plan dnia ---------------- */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {habits.length > 0 && (
              <Card padding="md">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
                      Nawyki
                    </span>
                    <span
                      className="num"
                      style={{ fontSize: 13, fontWeight: 600, color: "var(--text-3)" }}
                    >
                      {doneHabits}/{habits.length}
                    </span>
                  </div>
                  <Pressable
                    noMinSize
                    haptic="tap"
                    ariaLabel="Zobacz wszystkie nawyki"
                    onPress={() => router.push("/habits")}
                    style={{ minHeight: 44, padding: "0 4px" }}
                  >
                    <span
                      style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-text)" }}
                    >
                      Wszystkie
                    </span>
                  </Pressable>
                </div>

                {/* progress dots */}
                <div style={{ display: "flex", gap: 4, marginTop: 10, marginBottom: 6 }}>
                  {habits.map((h) => (
                    <span
                      key={h.id}
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: "var(--r-full)",
                        background: habitCompletions[h.id]
                          ? "var(--success)"
                          : "var(--surface-3)",
                        transition: "background-color var(--dur-base) var(--ease-out)",
                      }}
                    />
                  ))}
                </div>

                <div className="anim-stagger" style={{ display: "flex", flexDirection: "column" }}>
                  {habits.slice(0, 5).map((h) => {
                    const completed = habitCompletions[h.id] ?? false;
                    const toggling = togglingHabitIds.has(h.id);
                    return (
                      <ListRow
                        key={h.id}
                        minHeight={44}
                        done={completed}
                        dimmed={toggling}
                        haptic={false}
                        onPress={() => {
                          if (toggling) return;
                          if (!completed) haptic.success();
                          toggleHabit(h.id);
                        }}
                        leading={
                          <CheckBoxGlyph checked={completed} />
                        }
                        title={
                          <span style={{ fontSize: 15, fontWeight: 500 }}>{h.name}</span>
                        }
                      />
                    );
                  })}
                  {habits.length > 5 && (
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text-3)",
                        paddingLeft: 48,
                        marginTop: 4,
                      }}
                    >
                      +{habits.length - 5} więcej nawyków
                    </div>
                  )}
                </div>
              </Card>
            )}

            <Card padding="md">
              {isDayEmpty ? (
                <EmptyState
                  icon="🗓️"
                  title="Nie masz jeszcze planu na dziś"
                  body="Mentor ułoży dzień z Twoich celów, kalendarza i formy. Zajmuje to kilkanaście sekund."
                  action={{
                    label: "Wygeneruj automatycznie",
                    onPress: handleAutoGenerate,
                    loading: isGeneratingPlan && planAction === "auto",
                  }}
                  secondaryAction={{
                    label: "Zaplanuj z mentorem",
                    onPress: () => {
                      setPlanMode("input");
                      setPlanContext("");
                    },
                  }}
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
                        <div className="t-label" style={{ marginBottom: 6, paddingLeft: 4 }}>
                          {BLOCK_LABELS[block]}
                        </div>
                        <div
                          className="anim-stagger"
                          style={{ display: "flex", flexDirection: "column", gap: 2 }}
                        >
                          {merged.map((entry) => {
                            if (entry.kind === "meeting") {
                              const m = entry.data;
                              return (
                                <MeetingRow
                                  key={`meet-${m.id}`}
                                  meeting={m}
                                  toggling={togglingMeetings.has(m.id)}
                                  onToggle={() => toggleMeeting(m.id)}
                                  isExpanded={expandedId === `meet-${m.id}`}
                                  onExpand={() =>
                                    setExpandedId(
                                      expandedId === `meet-${m.id}` ? null : `meet-${m.id}`,
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
                                onExpand={() =>
                                  setExpandedId(expandedId === act.id ? null : act.id)
                                }
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
            </Card>

            {/* ---- Plan generation, within thumb reach ---- */}
            {planMode === "input" && (
              <Card variant="inset" padding="sm" className="reveal">
                <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 8 }}>
                  Jak minęła noc? Co uwzględnić dziś? Ograniczenia?
                </div>
                <VoiceTextarea
                  value={planContext}
                  onChange={setPlanContext}
                  placeholder="np. spałem 5h, jutro wyjazd, dziś bez treningu nóg"
                  minHeight={70}
                  disabled={isGeneratingPlan}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Button
                    variant="primary"
                    size="md"
                    fullWidth
                    loading={isGeneratingPlan && planAction === "input"}
                    onPress={handleInputGenerate}
                    style={{ background: "var(--grad-accent)" }}
                  >
                    Generuj plan
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={isGeneratingPlan}
                    onPress={() => {
                      setPlanMode(null);
                      setPlanContext("");
                    }}
                  >
                    Anuluj
                  </Button>
                </div>
              </Card>
            )}

            {planMode === "replan" && (
              <Card variant="inset" padding="sm" className="reveal">
                <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 8 }}>
                  Co się zmieniło? (opcjonalnie) — {completedCount} ukończonych zostanie zachowanych
                </div>
                <VoiceTextarea
                  value={planContext}
                  onChange={setPlanContext}
                  placeholder="np. spotkanie się przedłużyło, padam z energii"
                  minHeight={70}
                  disabled={isGeneratingPlan}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Button
                    variant="primary"
                    size="md"
                    fullWidth
                    loading={isGeneratingPlan && planAction === "replan"}
                    onPress={handleReplan}
                    style={{ background: "var(--grad-accent)" }}
                  >
                    Przeplanuj
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={isGeneratingPlan}
                    onPress={() => {
                      setPlanMode(null);
                      setPlanContext("");
                    }}
                  >
                    Anuluj
                  </Button>
                </div>
              </Card>
            )}

            {!isDayEmpty && planButtons}
          </div>

          {/* ---------------- Panel 1: Briefing ---------------- */}
          <div>
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

          {/* ---------------- Panel 2: Statystyki ---------------- */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card padding="md">
              <div className="t-label">Spalone dziś</div>
              <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginTop: 6 }}>
                <AnimatedNumber
                  value={burnedToday}
                  duration={800}
                  style={{
                    fontSize: 32,
                    fontWeight: 700,
                    lineHeight: 1.05,
                    letterSpacing: "-0.02em",
                    color: "var(--text)",
                  }}
                />
                <span className="tile-unit" style={{ fontSize: 15 }}>
                  kcal
                </span>
              </div>
              <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 4 }}>
                spoczynkowe + aktywności (estymacja)
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(136px, 1fr))",
                  gap: 12,
                  marginTop: 16,
                }}
              >
                <Card variant="inset" padding="sm">
                  <Stat
                    value={data?.bmr ?? "—"}
                    unit={data?.bmr != null ? "kcal" : undefined}
                    label="Spoczynkowo / dzień"
                  />
                </Card>
                <Card variant="inset" padding="sm">
                  <Stat
                    value={data?.tdee ?? "—"}
                    unit={data?.tdee != null ? "kcal" : undefined}
                    label="Z aktywnością / dzień"
                  />
                </Card>
                <Card variant="inset" padding="sm">
                  <Stat
                    value={totalCaloriesBurned > 0 ? totalCaloriesBurned : "—"}
                    unit={totalCaloriesBurned > 0 ? "kcal" : undefined}
                    label="Z treningów dziś"
                  />
                </Card>
                <Card variant="inset" padding="sm">
                  <Stat value={completionPct} unit="%" label="Plan wykonany" />
                </Card>
              </div>
            </Card>

            <WeightTracker />

            <Button
              variant="ghost"
              size="md"
              fullWidth
              onPress={() => router.push("/tracking")}
            >
              Zobacz pełny tracking
            </Button>
          </div>
        </SwipeDeck>
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
            // /api/activities/follow-up saves the exchange (conversation +
            // training log) and returns the mentor's answer, which the sheet
            // now shows. The old call to /api/chat threw the answer away.
            const res = await fetch("/api/activities/follow-up", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                activityId: followUp.activityId,
                mentorId,
                message,
              }),
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              return {
                reply: null,
                error: err.error || "Nie udało się zapisać odpowiedzi.",
              };
            }
            const json = await res.json();
            return {
              reply: typeof json.reply === "string" ? json.reply : null,
              error: json.replyError ?? null,
              savedTrainingLog: Boolean(json.trainingLogId),
            };
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
            background: "var(--overlay)",
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
              background: "var(--surface)",
              borderRadius: "var(--r-xl)",
              border: "1px solid var(--border)",
              width: "100%",
              maxWidth: 600,
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "var(--elev-4)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "14px 16px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text)" }}>
                  Historia briefingów
                </h2>
                <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--text-3)" }}>
                  Ostatnie 30 dni
                </p>
              </div>
              <Pressable
                ariaLabel="Zamknij"
                haptic="tap"
                onPress={() => setHistoryOpen(false)}
                style={{ width: 44, height: 44, borderRadius: "var(--r-full)", flexShrink: 0 }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--text-2)"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </Pressable>
            </div>

            <div
              className="papi-scroll"
              style={{
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {historyLoading ? (
                <Skeleton variant="list" count={4} />
              ) : historyItems.length === 0 ? (
                <EmptyState
                  compact
                  icon="📭"
                  title="Brak briefingów"
                  body="W ostatnich 30 dniach nie powstał żaden briefing."
                />
              ) : (
                historyItems.map((item) => {
                  const isExpanded = expandedHistoryId === item.id;
                  return (
                    <ListRow
                      key={item.id}
                      minHeight={56}
                      expandable
                      expanded={isExpanded}
                      onToggleExpand={() => setExpandedHistoryId(isExpanded ? null : item.id)}
                      title={<span style={{ fontSize: 15, fontWeight: 600 }}>{item.date}</span>}
                      subtitle={isExpanded ? undefined : `${item.summary}…`}
                      trailing={item.hasAudio ? <span aria-label="z audio">🔊</span> : undefined}
                    >
                      <div
                        style={{
                          fontSize: 15,
                          lineHeight: 1.6,
                          color: "var(--text-2)",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {item.content}
                      </div>
                    </ListRow>
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
          role="status"
          style={{
            position: "fixed",
            bottom: "var(--above-tabbar)",
            left: "50%",
            transform: "translateX(-50%)",
            background:
              toast.includes("Blad") || toast.includes("Błąd") || toast.includes("error")
                ? "var(--danger)"
                : "var(--success)",
            color: "var(--text-inverse)",
            padding: "10px 22px",
            borderRadius: "var(--r-full)",
            fontSize: 15,
            fontWeight: 600,
            boxShadow: "var(--elev-3)",
            zIndex: 100,
            maxWidth: "calc(100vw - 32px)",
            textAlign: "center",
            animation: "fadeInUp 260ms var(--ease-spring)",
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
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

/** Progress ring: gradient stroke, fills itself on entry, counts its number. */
function DayRing({ pct }: { pct: number }) {
  const size = 172;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safe = Math.max(0, Math.min(100, pct));

  // Start empty, fill on the next frame -> the ring draws itself instead of
  // appearing done. The same transition then animates every later change.
  // A hidden / throttled tab freezes requestAnimationFrame, and a ring stuck at
  // 0 while the number next to it says 50% is worse than no entry animation:
  // hence the immediate path when the document is hidden, and the timer as a
  // second net when rAF is merely being throttled.
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (typeof document !== "undefined" && document.hidden) {
      // Deliberate: one extra render to paint the correct value when no frame
      // will ever arrive.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFilled(true);
      return;
    }
    const raf = requestAnimationFrame(() => setFilled(true));
    const timer = window.setTimeout(() => setFilled(true), 150);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, []);

  const offset = circumference * (1 - (filled ? safe : 0) / 100);

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ transform: "rotate(-90deg)", display: "block" }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="papi-day-ring" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--grad-ring-from)" />
            <stop offset="100%" stopColor="var(--grad-ring-to)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#papi-day-ring)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset var(--dur-ring) var(--ease-out)" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "baseline" }}>
          <AnimatedNumber value={safe} duration={800} className="hero-num" />
          <span className="hero-unit">%</span>
        </span>
        <span className="t-label" style={{ marginTop: 4 }}>
          dnia
        </span>
      </div>
    </div>
  );
}

/** Small metric tile: label whispered, number loud, unit muted. */
function MetricTile({
  label,
  value,
  unit,
  decimals = 0,
}: {
  label: string;
  value: number | null;
  unit?: string;
  decimals?: number;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--elev-1)",
        padding: 12,
        minHeight: 88,
        minWidth: 0,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div
        className="t-label"
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", marginTop: 10 }}>
        {value == null ? (
          <span className="tile-num" style={{ color: "var(--text-3)" }}>
            —
          </span>
        ) : (
          <>
            <AnimatedNumber value={value} decimals={decimals} className="tile-num" />
            {unit && <span className="tile-unit">{unit}</span>}
          </>
        )}
      </div>
    </div>
  );
}

/** 24 px box with a 44 px touch target around it. Border stays 2 px in both
 *  states, so ticking a task never nudges its neighbours. */
function CheckBox({
  checked,
  disabled,
  onToggle,
  label,
}: {
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Pressable
      as="div"
      role="checkbox"
      ariaChecked={checked}
      ariaLabel={label}
      stopPropagation
      disabled={disabled}
      haptic={false}
      noMinSize
      onPress={() => {
        if (disabled) return;
        if (!checked) haptic.success();
        onToggle();
      }}
      // 44x44 touch target, but the negative margins let it overlap the row
      // padding so it only costs ~32 px of layout width on a 320 px screen.
      style={{ width: 44, height: 44, flexShrink: 0, marginLeft: -6, marginRight: -6 }}
    >
      <CheckBoxGlyph checked={checked} />
    </Pressable>
  );
}

/** The visual box alone — for rows where the whole row is the target. */
function CheckBoxGlyph({ checked }: { checked: boolean }) {
  return (
    <span
      className={checked ? "anim-pop" : undefined}
      style={{
        width: 24,
        height: 24,
        borderRadius: 8,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        border: `2px solid ${checked ? "var(--success)" : "var(--border-strong)"}`,
        background: checked ? "var(--success)" : "transparent",
        transition:
          "background-color var(--dur-base) var(--ease-spring), border-color var(--dur-base) var(--ease-spring)",
      }}
    >
      {checked && (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-inverse)"
          strokeWidth="3.2"
          className="anim-draw"
          strokeDasharray="32"
          style={{ ["--check-len" as string]: "32" } as React.CSSProperties}
          aria-hidden="true"
        >
          <polyline points="4 12 10 18 20 6" />
        </svg>
      )}
    </span>
  );
}

function ChevronRight() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--text-3)"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** Row title: 17/600, clamped to two lines so one long name cannot turn a
 *  56 px row into a three-line block and break the rhythm of the list. */
function RowTitle({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontWeight: 600,
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
      }}
    >
      {children}
    </span>
  );
}

/** Fixed-width, tabular hour column so names line up down the list. */
function TimeSlot({ time }: { time: string | null }) {
  return (
    <span
      className="num"
      style={{
        width: 38,
        marginLeft: 8,
        flexShrink: 0,
        textAlign: "left",
        fontSize: 13,
        fontWeight: 600,
        color: "var(--text-3)",
      }}
    >
      {time ?? ""}
    </span>
  );
}

function MeetingRow({
  meeting,
  toggling,
  onToggle,
  isExpanded,
  onExpand,
}: {
  meeting: MeetingItem;
  toggling: boolean;
  onToggle: () => void;
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

  const subtitle = meeting.allDay
    ? "Spotkanie · cały dzień"
    : endLabel
      ? `Spotkanie · do ${endLabel}`
      : "Spotkanie";

  return (
    <ListRow
      minHeight={56}
      done={meeting.completed}
      dimmed={toggling}
      expandable
      expanded={isExpanded}
      onToggleExpand={onExpand}
      style={{
        borderLeft: "3px solid var(--accent)",
        borderRadius: "var(--r-md)",
        background: "var(--accent-soft)",
        boxSizing: "border-box",
      }}
      leading={
        <span style={{ display: "inline-flex", alignItems: "center" }}>
          <CheckBox
            checked={meeting.completed}
            disabled={toggling}
            onToggle={onToggle}
            label={`Odhacz spotkanie ${meeting.name}`}
          />
          <TimeSlot time={meeting.allDay ? null : meeting.time} />
        </span>
      }
      title={<RowTitle>{meeting.name}</RowTitle>}
      subtitle={subtitle}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          fontSize: 15,
          lineHeight: 1.5,
          color: "var(--text-2)",
        }}
      >
        {meeting.location && (
          <div>
            <span style={{ color: "var(--text-3)" }}>Lokalizacja: </span>
            {meeting.location}
          </div>
        )}
        {meeting.hangoutLink && (
          <div style={{ overflowWrap: "anywhere" }}>
            <span style={{ color: "var(--text-3)" }}>Meet: </span>
            <a
              href={meeting.hangoutLink}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ color: "var(--accent-text)" }}
            >
              {meeting.hangoutLink}
            </a>
          </div>
        )}
        {meeting.attendees.length > 0 && (
          <div>
            <span style={{ color: "var(--text-3)" }}>Uczestnicy: </span>
            {meeting.attendees.join(", ")}
          </div>
        )}
        {meeting.description && (
          <div style={{ whiteSpace: "pre-wrap", color: "var(--text-3)" }}>
            {meeting.description}
          </div>
        )}
        {!meeting.location &&
          !meeting.hangoutLink &&
          meeting.attendees.length === 0 &&
          !meeting.description && (
            <div style={{ color: "var(--text-3)" }}>Brak dodatkowych szczegółów.</div>
          )}
      </div>
    </ListRow>
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
    !!activity.lifeAreaId && (!activity.notes || activity.notes.trim().length < 40);
  const isMeal = isMealActivity(activity.name);

  return (
    <div id={`act-${activity.id}`}>
      <ListRow
        minHeight={56}
        done={activity.completed}
        dimmed={toggling}
        expandable
        expanded={isExpanded}
        onToggleExpand={onExpand}
        leading={
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            <CheckBox
              checked={activity.completed}
              disabled={toggling}
              onToggle={onToggle}
              label={`${activity.completed ? "Odznacz" : "Odhacz"}: ${activity.name}`}
            />
            <TimeSlot time={activity.scheduledAt} />
          </span>
        }
        title={<RowTitle>{activity.name}</RowTitle>}
      >
        <div
          style={{
            fontSize: 15,
            lineHeight: 1.55,
            color: "var(--text-2)",
            paddingLeft: 4,
          }}
        >
          {activity.notes ? (
            <div style={{ whiteSpace: "pre-wrap" }}>{activity.notes}</div>
          ) : (
            <div style={{ color: "var(--text-3)" }}>Brak dodatkowych szczegółów</div>
          )}

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 10,
              fontSize: 13,
              color: "var(--text-3)",
            }}
          >
            {activity.durationMin && <span>{activity.durationMin} min</span>}
            {activity.metrics?.caloriesBurned && activity.completed && (
              <span style={{ color: "var(--success-on-surface)", fontWeight: 600 }}>
                ~{activity.metrics.caloriesBurned} kcal spalonych
              </span>
            )}
          </div>

          {canGeneratePlan && (
            <div style={{ marginTop: 12 }}>
              <Button
                variant="secondary"
                size="sm"
                loading={generatingPlan}
                onPress={() => {
                  if (!generatingPlan) onGeneratePlan();
                }}
              >
                Generuj plan z mentorem
              </Button>
            </div>
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
      </ListRow>
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
      <div style={{ marginTop: 12 }}>
        <Button
          variant="secondary"
          size="sm"
          onPress={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          Zjadłem coś innego
        </Button>
      </div>
    );
  }

  const miniInput: React.CSSProperties = {
    width: "100%",
    minHeight: 44,
    padding: "8px 12px",
    borderRadius: "var(--r-md)",
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text)",
    // 17px: below 16px iOS zooms the whole page when the field gets focus
    fontSize: 17,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  };

  const miniLabel: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-2)",
    marginBottom: 4,
    display: "block",
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: 12,
        padding: 14,
        borderRadius: "var(--r-md)",
        background: "var(--surface-2)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: "var(--text)" }}>
          Co zjadłeś?
        </span>
        <Pressable
          ariaLabel="Zamknij formularz posiłku"
          stopPropagation
          haptic="tap"
          onPress={() => setOpen(false)}
          style={{ width: 44, height: 44, borderRadius: "var(--r-full)", marginRight: -8 }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-3)"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </Pressable>
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

      <div style={{ display: "flex", gap: 8 }}>
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          loading={estimating}
          disabled={recognizing || (!description.trim() && !name.trim())}
          onPress={(e) => {
            e.stopPropagation();
            handleEstimate();
          }}
        >
          Oszacuj z AI
        </Button>
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          loading={recognizing}
          disabled={estimating}
          onPress={(e) => {
            e.stopPropagation();
            handlePhotoClick();
          }}
        >
          Zdjęcie
        </Button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
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

      <Button
        variant="primary"
        size="md"
        fullWidth
        disabled={disabled || estimating || recognizing}
        onPress={handleSubmit}
        style={{ marginTop: 4, background: "var(--grad-accent)" }}
      >
        Zapisz i oznacz jako zjedzone
      </Button>
    </div>
  );
}
