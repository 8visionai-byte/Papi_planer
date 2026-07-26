"use client";

import { useState, useEffect, useCallback } from "react";
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
  fieldControlStyle,
  T,
  TYPO,
} from "@/components/ui";
import { AnimatedNumber, Reveal, SegmentedTabs, SwipeDeck } from "@/components/motion";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MentorRef {
  id: string;
  name: string;
  avatarEmoji: string | null;
  role: string;
}

interface AvailableMentor {
  id: string;
  name: string;
  role: string;
  avatarEmoji: string | null;
}

interface LifeAreaRef {
  id: string;
  name: string;
}

interface Milestone {
  id: string;
  title: string;
  completed: boolean;
  sortOrder: number;
}

interface GoalData {
  id: string;
  title: string;
  description: string | null;
  /** "active" | "achieved" | "abandoned" | "paused" (+ legacy "completed"). */
  status: string;
  progress: number;
  targetDate: string | null;
  /** Set the moment the goal was closed. Null while it is still in play. */
  achievedAt: string | null;
  /** One line from the user: how it actually went. */
  outcome: string | null;
  mentor: MentorRef | null;
  mentors: MentorRef[];
  mentorIds: string[];
  lifeArea: LifeAreaRef | null;
  milestones: Milestone[];
}

/** The three ways a goal leaves the active list. */
type CloseMode = "achieved" | "abandoned" | "paused";

interface PlanTask {
  title: string;
  description?: string;
  frequency?: string;
  done?: boolean;
  feedback?: string;
}

interface PlanGoalRef {
  id: string;
  title: string;
  progress: number;
  status: string;
}

interface MentorPlanData {
  id: string;
  weekNumber: number;
  phase: number;
  tasks: PlanTask[];
  notes: string | null;
  mentor: MentorRef;
  goalId: string | null;
  goal: PlanGoalRef | null;
}

interface ClarifyingQuestion {
  question: string;
  mentorId: string;
  mentorName: string;
  mentorEmoji: string | null;
}

interface ClarifyingState {
  goalId: string;
  questions: ClarifyingQuestion[];
  mentorId: string;
  mentorName: string;
  mentorIds: string[];
  answers: string[];
}

interface EditDraft {
  title: string;
  description: string;
  mentorIds: string[];
  targetDate: string;
}

const MENTOR_FALLBACK_EMOJI = "\u{1F9D1}‍\u{1F3EB}";
/** Standard list row height used across this screen (DESIGN-SPEC 5.3). */
const ROW_H = 56;
const TABS = [
  { key: "goals" as const, label: "Cele" },
  { key: "plans" as const, label: "Plany mentorów" },
];

/* ---------------- goal lifecycle (mirrors /api/goals) ---------------- */

/** Still in play. "paused" stays visible so the user can resume it. */
function isOpenGoal(g: GoalData) {
  return g.status === "active" || g.status === "paused";
}
/** Off the board. "completed" is the legacy value from the old auto-complete code. */
function isClosedGoal(g: GoalData) {
  return g.status === "achieved" || g.status === "abandoned" || g.status === "completed";
}
function isAchievedGoal(g: GoalData) {
  return g.status === "achieved" || g.status === "completed";
}

/** Polish plurals: 1 cel, 2 cele, 5 celów. */
function plural(n: number, one: string, few: string, many: string) {
  if (n === 1) return one;
  const r10 = n % 10;
  const r100 = n % 100;
  if (r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14)) return few;
  return many;
}

function formatCloseDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "long", year: "numeric" });
}

/** Copy for the confirmation sheet, one entry per way of closing a goal. */
const CLOSE_COPY: Record<
  CloseMode,
  {
    sheetTitle: string;
    lead: string;
    confirm: string;
    /** Sheets with an outcome field write it to goal.outcome. Pause does not. */
    askOutcome: boolean;
    danger: boolean;
    toast: string;
  }
> = {
  achieved: {
    sheetTitle: "Cel osiągnięty",
    lead: "Zamykam ten cel. Zniknie z listy aktywnych i z planu dnia, ale zostanie w historii.",
    confirm: "Tak, zamykam cel",
    askOutcome: true,
    danger: false,
    toast: "Cel zamknięty. Gratulacje.",
  },
  abandoned: {
    sheetTitle: "Odpuszczasz ten cel?",
    lead: "Cel trafi do zamkniętych. Nie będzie już wracał w planie dnia ani u mentorów.",
    confirm: "Odpuszczam",
    askOutcome: true,
    danger: true,
    toast: "Cel odpuszczony.",
  },
  paused: {
    sheetTitle: "Wstrzymać ten cel?",
    lead: "Cel zostaje na liście, ale mentorzy i planer dnia przestają go brać pod uwagę. Wznowisz go jednym kliknięciem.",
    confirm: "Wstrzymaj",
    askOutcome: false,
    danger: false,
    toast: "Cel wstrzymany.",
  },
};

/* ------------------------------------------------------------------ */
/*  Small shared pieces                                                */
/* ------------------------------------------------------------------ */

/** Interface icons are SVG (stroke 1.75, round caps); emoji stay for mentors. */
function Icon({ path, size = 20 }: { path: React.ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {path}
    </svg>
  );
}

const PencilPath = (
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </>
);
const TrashPath = (
  <>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </>
);
const ChevronPath = <polyline points="6 9 12 15 18 9" />;

/** Muted pill: mentor chip, life area, week/phase. */
function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "success";
}) {
  const palette =
    tone === "accent"
      ? { bg: T.primarySoft, fg: T.primaryOnSurface, bd: "var(--border-accent, transparent)" }
      : tone === "success"
        ? { bg: T.successSoft, fg: T.successOnSurface, bd: T.success }
        : { bg: T.surface2, fg: T.text2, bd: T.border };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "5px 10px",
        borderRadius: T.rFull,
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.bd}`,
        ...TYPO.footnote,
        fontWeight: 600,
        maxWidth: "100%",
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
      }}
    >
      {children}
    </span>
  );
}

/** Emoji in a fixed 28 px box so the action-menu rows line up. */
function MenuGlyph({ emoji }: { emoji: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 28,
        flexShrink: 0,
        fontSize: 22,
        lineHeight: 1,
        textAlign: "center",
      }}
    >
      {emoji}
    </span>
  );
}

/** 24 px box, 44 px touch target, checkmark that draws itself. */
function CheckBox({
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
      ariaLabel={`${checked ? "Odznacz" : "Odhacz"}: ${label}`}
      stopPropagation
      press="sm"
      haptic={false}
      disabled={disabled}
      onPress={onToggle}
      style={{ width: T.tapMin, height: T.tapMin, flexShrink: 0 }}
    >
      <span
        key={checked ? "on" : "off"}
        className={checked ? "anim-pop" : undefined}
        style={{
          // frame is ALWAYS 2 px so ticking never shifts the neighbours by 2 px
          width: 24,
          height: 24,
          borderRadius: 7,
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
            width="15"
            height="15"
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
              style={{ strokeDasharray: 26, ["--check-len" as string]: 26 }}
            />
          </svg>
        )}
      </span>
    </Pressable>
  );
}

/** Progress ring, gradient stroke, fills itself on entry. */
function ProgressRing({
  value,
  id,
  done,
  size = 60,
}: {
  value: number;
  id: string;
  done: boolean;
  size?: number;
}) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const len = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const offset = len * (1 - pct / 100);
  const gradId = `ring-${id}`;

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--grad-ring-from)" />
            <stop offset="100%" stopColor="var(--grad-ring-to)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={T.surface3}
          strokeWidth={stroke}
        />
        <circle
          className="anim-ring"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={done ? T.success : `url(#${gradId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{
            ["--ring-len" as string]: len,
            transition: `stroke-dashoffset 900ms var(--ease-out)`,
          }}
        />
      </svg>
      <span
        className="num"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          ...TYPO.footnote,
          fontWeight: 700,
          color: T.text,
        }}
      >
        {pct}%
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Reusable: MentorCheckboxList                                       */
/* ------------------------------------------------------------------ */

function MentorCheckboxList({
  mentorsList,
  selected,
  onToggle,
  disabled,
}: {
  mentorsList: AvailableMentor[];
  selected: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  if (mentorsList.length === 0) {
    return (
      <div style={{ ...TYPO.footnote, color: T.text3 }}>
        Brak aktywnych mentorów. Dodaj mentora w admin/Mentorzy.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp2, width: "100%" }}>
      {mentorsList.map((m) => {
        const checked = selected.includes(m.id);
        return (
          <Pressable
            key={m.id}
            as="div"
            role="checkbox"
            ariaChecked={checked}
            press="sm"
            haptic="selection"
            disabled={disabled}
            onPress={() => onToggle(m.id)}
            noMinSize
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: T.sp3,
              padding: `${T.sp2} ${T.sp3}`,
              minHeight: 60,
              width: "100%",
              boxSizing: "border-box",
              borderRadius: T.rMd,
              border: `1px solid ${checked ? "var(--border-accent, transparent)" : T.border}`,
              background: checked ? T.primarySoft : T.surface2,
              boxShadow: checked ? "var(--glow-accent-soft)" : "none",
              opacity: disabled ? 0.6 : 1,
              transition: "background-color 140ms linear, border-color 140ms linear",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 26,
                height: 26,
                flexShrink: 0,
                borderRadius: 7,
                boxSizing: "border-box",
                border: `2px solid ${checked ? T.primary : T.borderStrong}`,
                background: checked ? T.primary : "transparent",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background-color 160ms var(--ease-spring)",
              }}
            >
              {checked && (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--accent-ink)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="4 12 10 18 20 6" />
                </svg>
              )}
            </span>

            <span aria-hidden="true" style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>
              {m.avatarEmoji ?? MENTOR_FALLBACK_EMOJI}
            </span>

            <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
              <span
                style={{
                  display: "block",
                  ...TYPO.title3,
                  color: T.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {m.name}
              </span>
              <span
                style={{
                  display: "block",
                  ...TYPO.footnote,
                  color: T.text3,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {m.role}
              </span>
            </span>
          </Pressable>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function GoalsPage() {
  const [goals, setGoals] = useState<GoalData[]>([]);
  const [plans, setPlans] = useState<MentorPlanData[]>([]);
  const [mentorsList, setMentorsList] = useState<AvailableMentor[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"goals" | "plans">("goals");
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);
  const [togglingMilestones, setTogglingMilestones] = useState<Set<string>>(new Set());

  // Add goal form
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newMentorIds, setNewMentorIds] = useState<string[]>([]);
  const [newTargetDate, setNewTargetDate] = useState<string>("");
  const [addingGoal, setAddingGoal] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const [generatingPlanForGoal, setGeneratingPlanForGoal] = useState<string | null>(null);
  const [planStage, setPlanStage] = useState<"questions" | "plan" | null>(null);
  const [clarifyingState, setClarifyingState] = useState<ClarifyingState | null>(null);
  const [submittingAnswers, setSubmittingAnswers] = useState(false);

  // Edit goal state
  const [editingGoal, setEditingGoal] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete confirmation sheet target
  const [confirmDeleteGoal, setConfirmDeleteGoal] = useState<GoalData | null>(null);
  const [deletingGoal, setDeletingGoal] = useState(false);

  // Closing a goal: Aktywne / Zamknięte tab, the "..." menu, the confirm sheet
  const [goalsView, setGoalsView] = useState<"open" | "closed">("open");
  const [actionsForGoal, setActionsForGoal] = useState<GoalData | null>(null);
  const [closeTarget, setCloseTarget] = useState<{ goal: GoalData; mode: CloseMode } | null>(null);
  const [outcomeDraft, setOutcomeDraft] = useState("");
  const [closingGoal, setClosingGoal] = useState(false);
  const [restoringGoal, setRestoringGoal] = useState<string | null>(null);
  /** Title of the goal just achieved — drives the short celebration overlay. */
  const [celebrated, setCelebrated] = useState<string | null>(null);

  // Two-step cleanup of legacy plans (replaces window.confirm)
  const [confirmCleanup, setConfirmCleanup] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [goalsRes, plansRes, mentorsRes] = await Promise.all([
        // status=all: both tabs come from one request, so switching them is instant.
        fetch("/api/goals?status=all"),
        fetch("/api/mentor-plans"),
        fetch("/api/mentors"),
      ]);
      if (goalsRes.ok) setGoals(await goalsRes.json());
      if (plansRes.ok) setPlans(await plansRes.json());
      if (mentorsRes.ok) {
        const ms = await mentorsRes.json();
        if (Array.isArray(ms)) {
          setMentorsList(
            ms.map((m: AvailableMentor) => ({
              id: m.id,
              name: m.name,
              role: m.role,
              avatarEmoji: m.avatarEmoji ?? null,
            }))
          );
        }
      }
    } catch {
      // keep empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Listen for plan-task toggle events from dashboard → refetch goals + plans
  useBroadcastChannel("papicoach:goals", (data) => {
    const msg = data as { type?: string } | null;
    if (msg?.type === "plan-task-toggled") {
      fetchData();
    }
  });

  // Per-task UI state
  const [togglingTasks, setTogglingTasks] = useState<Set<string>>(new Set());
  const [schedulingTask, setSchedulingTask] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState<{ date: string; time: string; durationMin: number }>(
    () => {
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const mi = String(now.getMinutes()).padStart(2, "0");
      return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}`, durationMin: 30 };
    }
  );
  const [submittingSchedule, setSubmittingSchedule] = useState(false);

  // Per-task feedback UI state
  const [feedbackForTask, setFeedbackForTask] = useState<string | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState<string>("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const toggleTask = useCallback(async (planId: string, taskIndex: number) => {
    const key = `${planId}:${taskIndex}`;
    if (togglingTasks.has(key)) return;
    setTogglingTasks((prev) => new Set(prev).add(key));

    // Confirm the touch immediately, before the network call.
    haptic.tap();

    // Optimistic update
    setPlans((prev) =>
      prev.map((p) => {
        if (p.id !== planId) return p;
        const newTasks = p.tasks.map((t, i) =>
          i === taskIndex ? { ...t, done: !t.done } : t
        );
        return { ...p, tasks: newTasks };
      })
    );

    try {
      const res = await fetch("/api/mentor-plans/toggle-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, taskIndex }),
      });
      if (!res.ok) {
        // Revert on failure
        haptic.error();
        setPlans((prev) =>
          prev.map((p) => {
            if (p.id !== planId) return p;
            const newTasks = p.tasks.map((t, i) =>
              i === taskIndex ? { ...t, done: !t.done } : t
            );
            return { ...p, tasks: newTasks };
          })
        );
        setToast("Nie udało się zaktualizować zadania.");
        setTimeout(() => setToast(null), 3000);
      } else {
        const json = await res.json();
        if (typeof json.goalProgress === "number" && json.goalId) {
          // Progress only. The status belongs to the user (see the close sheet),
          // so 100% no longer silently closes a goal and dropping below 100%
          // no longer reopens one that was already closed.
          setGoals((prev) =>
            prev.map((g) =>
              g.id === json.goalId ? { ...g, progress: json.goalProgress } : g
            )
          );
        }
      }
    } catch {
      setPlans((prev) =>
        prev.map((p) => {
          if (p.id !== planId) return p;
          const newTasks = p.tasks.map((t, i) =>
            i === taskIndex ? { ...t, done: !t.done } : t
          );
          return { ...p, tasks: newTasks };
        })
      );
    } finally {
      setTogglingTasks((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [togglingTasks]);

  const openScheduleForm = useCallback((planId: string, taskIndex: number) => {
    const key = `${planId}:${taskIndex}`;
    setSchedulingTask((prev) => (prev === key ? null : key));
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    setScheduleForm({ date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}`, durationMin: 30 });
  }, []);

  const submitSchedule = useCallback(async (planId: string, taskIndex: number) => {
    if (submittingSchedule) return;
    setSubmittingSchedule(true);
    try {
      const res = await fetch("/api/mentor-plans/schedule-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          taskIndex,
          date: scheduleForm.date,
          time: scheduleForm.time,
          durationMin: scheduleForm.durationMin,
        }),
      });
      if (res.ok) {
        haptic.success();
        setToast("Zaplanowano w dashboard");
        setSchedulingTask(null);
        setTimeout(() => setToast(null), 3000);
      } else {
        const err = await res.json().catch(() => ({}));
        haptic.error();
        setToast(typeof err.error === "string" ? err.error : "Nie udało się zaplanować.");
        setTimeout(() => setToast(null), 4000);
      }
    } catch {
      haptic.error();
      setToast("Błąd sieci przy planowaniu zadania.");
      setTimeout(() => setToast(null), 4000);
    } finally {
      setSubmittingSchedule(false);
    }
  }, [scheduleForm, submittingSchedule]);

  const openFeedbackForm = useCallback(
    (planId: string, taskIndex: number, current: string | undefined) => {
      const key = `${planId}:${taskIndex}`;
      setFeedbackForTask((prev) => (prev === key ? null : key));
      setFeedbackDraft(current ?? "");
    },
    []
  );

  const submitFeedback = useCallback(
    async (planId: string, taskIndex: number) => {
      if (submittingFeedback) return;
      setSubmittingFeedback(true);
      try {
        const res = await fetch("/api/mentor-plans/task-feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planId,
            taskIndex,
            feedback: feedbackDraft.trim(),
          }),
        });
        if (res.ok) {
          const updated = (await res.json()) as MentorPlanData;
          setPlans((prev) =>
            prev.map((p) =>
              p.id === planId ? { ...p, tasks: updated.tasks } : p
            )
          );
          haptic.success();
          setToast(
            feedbackDraft.trim().length === 0
              ? "Uwaga usunięta"
              : "Uwaga zapisana — mentor uwzględni ją przy kolejnym planie"
          );
          setFeedbackForTask(null);
          setFeedbackDraft("");
          setTimeout(() => setToast(null), 3500);
        } else {
          const err = await res.json().catch(() => ({}));
          haptic.error();
          setToast(typeof err.error === "string" ? err.error : "Nie udało się zapisać uwagi.");
          setTimeout(() => setToast(null), 4000);
        }
      } catch {
        haptic.error();
        setToast("Błąd sieci przy zapisywaniu uwagi.");
        setTimeout(() => setToast(null), 4000);
      } finally {
        setSubmittingFeedback(false);
      }
    },
    [feedbackDraft, submittingFeedback]
  );

  const toggleMilestone = async (milestoneId: string) => {
    if (togglingMilestones.has(milestoneId)) return;
    setTogglingMilestones((prev) => new Set(prev).add(milestoneId));

    // Confirm the touch immediately, before the network call.
    haptic.tap();

    setGoals((prev) =>
      prev.map((g) => ({
        ...g,
        milestones: g.milestones.map((m) =>
          m.id === milestoneId ? { ...m, completed: !m.completed } : m
        ),
      }))
    );

    try {
      const res = await fetch("/api/goals/milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestoneId }),
      });
      if (res.ok) {
        const { goalProgress, goalStatus } = await res.json();
        setGoals((prev) =>
          prev.map((g) => {
            const hasMilestone = g.milestones.some((m) => m.id === milestoneId);
            if (!hasMilestone) return g;
            // Status comes from the server as-is; ticking a box never closes or
            // reopens a goal any more.
            return {
              ...g,
              progress: goalProgress,
              status: typeof goalStatus === "string" ? goalStatus : g.status,
            };
          })
        );
      }
    } catch {
      setGoals((prev) =>
        prev.map((g) => ({
          ...g,
          milestones: g.milestones.map((m) =>
            m.id === milestoneId ? { ...m, completed: !m.completed } : m
          ),
        }))
      );
    } finally {
      setTogglingMilestones((prev) => {
        const next = new Set(prev);
        next.delete(milestoneId);
        return next;
      });
    }
  };

  /* ----------- Add goal ----------- */

  const toggleNewMentor = (mentorId: string) => {
    setNewMentorIds((prev) =>
      prev.includes(mentorId) ? prev.filter((id) => id !== mentorId) : [...prev, mentorId]
    );
  };

  const resetAddForm = () => {
    setShowAddGoal(false);
    setNewTitle("");
    setNewDescription("");
    setNewMentorIds([]);
    setNewTargetDate("");
  };

  const addGoal = async () => {
    if (!newTitle.trim() || addingGoal) return;
    setAddingGoal(true);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          description: newDescription.trim() || null,
          mentorIds: newMentorIds,
          targetDate: newTargetDate || null,
        }),
      });
      if (res.ok) {
        const goal = (await res.json()) as GoalData;
        setGoals((prev) => [goal, ...prev]);
        const hadMentors = newMentorIds.length > 0;
        haptic.success();
        resetAddForm();
        setToast(
          hadMentors
            ? "Cel utworzony! Kliknij „Wygeneruj plan z mentorem” aby zacząć."
            : "Cel utworzony. Edytuj cel i wybierz mentorów, aby wygenerować plan."
        );
        setTimeout(() => setToast(null), 4000);
      } else {
        const err = await res.json().catch(() => ({}));
        haptic.error();
        setToast(typeof err.error === "string" ? err.error : "Nie udało się utworzyć celu.");
        setTimeout(() => setToast(null), 4000);
      }
    } catch {
      haptic.error();
      setToast("Błąd sieci przy tworzeniu celu.");
      setTimeout(() => setToast(null), 4000);
    } finally {
      setAddingGoal(false);
    }
  };

  /* ----------- Edit goal ----------- */

  const startEditGoal = (goal: GoalData) => {
    setEditingGoal(goal.id);
    setEditDraft({
      title: goal.title,
      description: goal.description ?? "",
      mentorIds: [...(goal.mentorIds ?? [])],
      targetDate: goal.targetDate ? goal.targetDate.slice(0, 10) : "",
    });
    setExpandedGoal(goal.id);
  };

  const toggleEditMentor = (mentorId: string) => {
    setEditDraft((prev) => {
      if (!prev) return prev;
      const has = prev.mentorIds.includes(mentorId);
      return {
        ...prev,
        mentorIds: has
          ? prev.mentorIds.filter((id) => id !== mentorId)
          : [...prev.mentorIds, mentorId],
      };
    });
  };

  const cancelEditGoal = () => {
    setEditingGoal(null);
    setEditDraft(null);
  };

  const saveEditGoal = async () => {
    if (!editingGoal || !editDraft || savingEdit) return;
    if (!editDraft.title.trim()) {
      setToast("Tytuł celu nie może być pusty.");
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch("/api/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingGoal,
          title: editDraft.title.trim(),
          description: editDraft.description.trim() || null,
          mentorIds: editDraft.mentorIds,
          targetDate: editDraft.targetDate || null,
        }),
      });
      if (res.ok) {
        const updated = (await res.json()) as GoalData;
        setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
        haptic.success();
        setToast("Cel zaktualizowany.");
        setEditingGoal(null);
        setEditDraft(null);
      } else {
        const err = await res.json().catch(() => ({}));
        haptic.error();
        setToast(typeof err.error === "string" ? err.error : "Nie udało się zapisać celu.");
      }
    } catch {
      haptic.error();
      setToast("Błąd sieci przy zapisie celu.");
    } finally {
      setSavingEdit(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  /* ----------- Delete goal ----------- */

  const requestDeleteGoal = (goal: GoalData) => {
    setConfirmDeleteGoal(goal);
  };

  const confirmDelete = async () => {
    if (!confirmDeleteGoal || deletingGoal) return;
    setDeletingGoal(true);
    try {
      const res = await fetch("/api/goals", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: confirmDeleteGoal.id }),
      });
      if (res.ok) {
        setGoals((prev) => prev.filter((g) => g.id !== confirmDeleteGoal.id));
        // Plans tied to this goal also gone — refresh
        try {
          const plansRes = await fetch("/api/mentor-plans");
          if (plansRes.ok) setPlans(await plansRes.json());
        } catch {
          // ignore
        }
        haptic.warning();
        setToast("Cel usunięty.");
      } else {
        const err = await res.json().catch(() => ({}));
        haptic.error();
        setToast(typeof err.error === "string" ? err.error : "Nie udało się usunąć celu.");
      }
    } catch {
      haptic.error();
      setToast("Błąd sieci przy usuwaniu celu.");
    } finally {
      setDeletingGoal(false);
      setConfirmDeleteGoal(null);
      setTimeout(() => setToast(null), 4000);
    }
  };

  /* ----------- Close / pause / restore a goal ----------- */

  const openCloseSheet = (goal: GoalData, mode: CloseMode) => {
    setActionsForGoal(null);
    setOutcomeDraft(goal.outcome ?? "");
    setCloseTarget({ goal, mode });
  };

  const closeCloseSheet = () => {
    if (closingGoal) return;
    setCloseTarget(null);
    setOutcomeDraft("");
  };

  /** One PATCH for all three exits. Only achieved/abandoned carry an outcome. */
  const confirmClose = async () => {
    if (!closeTarget || closingGoal) return;
    const { goal, mode } = closeTarget;
    const copy = CLOSE_COPY[mode];
    setClosingGoal(true);
    try {
      const res = await fetch("/api/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: goal.id,
          status: mode,
          ...(copy.askOutcome ? { outcome: outcomeDraft.trim() || null } : {}),
        }),
      });
      if (res.ok) {
        const updated = (await res.json()) as GoalData;
        setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
        if (mode === "achieved") {
          haptic.success();
          setCelebrated(goal.title);
        } else {
          haptic.warning();
        }
        setCloseTarget(null);
        setOutcomeDraft("");
        setExpandedGoal((prev) => (prev === goal.id ? null : prev));
        setToast(copy.toast);
        setTimeout(() => setToast(null), 4000);
      } else {
        const err = await res.json().catch(() => ({}));
        haptic.error();
        setToast(typeof err.error === "string" ? err.error : "Nie udało się zamknąć celu.");
        setTimeout(() => setToast(null), 4000);
      }
    } catch {
      haptic.error();
      setToast("Błąd sieci przy zamykaniu celu.");
      setTimeout(() => setToast(null), 4000);
    } finally {
      setClosingGoal(false);
    }
  };

  const restoreGoal = async (goal: GoalData) => {
    if (restoringGoal) return;
    setRestoringGoal(goal.id);
    setActionsForGoal(null);
    try {
      const res = await fetch("/api/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: goal.id, status: "active" }),
      });
      if (res.ok) {
        const updated = (await res.json()) as GoalData;
        setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
        haptic.success();
        setGoalsView("open");
        setToast("Cel wrócił do aktywnych.");
      } else {
        const err = await res.json().catch(() => ({}));
        haptic.error();
        setToast(typeof err.error === "string" ? err.error : "Nie udało się przywrócić celu.");
      }
    } catch {
      haptic.error();
      setToast("Błąd sieci przy przywracaniu celu.");
    } finally {
      setRestoringGoal(null);
      setTimeout(() => setToast(null), 4000);
    }
  };

  // The celebration overlay is decoration, not a dialog: it clears itself.
  useEffect(() => {
    if (!celebrated) return;
    const t = setTimeout(() => setCelebrated(null), 2000);
    return () => clearTimeout(t);
  }, [celebrated]);

  /* ----------- Generate plan (step 1) ----------- */

  const startPlanGeneration = async (goalId: string) => {
    if (generatingPlanForGoal) return;
    if (clarifyingState && clarifyingState.goalId !== goalId) {
      setClarifyingState(null);
    }
    setGeneratingPlanForGoal(goalId);
    setPlanStage("questions");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300_000);
    try {
      // No mentorIds passed — backend reads from goal.mentorIds
      const res = await fetch("/api/goals/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.stage === "questions" && Array.isArray(body.questions)) {
        const questions: ClarifyingQuestion[] = body.questions
          .map((q: unknown) => {
            if (typeof q === "string") {
              return {
                question: q.trim(),
                mentorId: typeof body.mentorId === "string" ? body.mentorId : "",
                mentorName: typeof body.mentorName === "string" ? body.mentorName : "Mentor",
                mentorEmoji: null,
              } as ClarifyingQuestion;
            }
            if (q && typeof q === "object") {
              const obj = q as Record<string, unknown>;
              const text = typeof obj.question === "string" ? obj.question.trim() : "";
              if (!text) return null;
              return {
                question: text,
                mentorId: typeof obj.mentorId === "string" ? obj.mentorId : "",
                mentorName:
                  typeof obj.mentorName === "string" ? obj.mentorName : "Mentor",
                mentorEmoji:
                  typeof obj.mentorEmoji === "string" ? obj.mentorEmoji : null,
              } as ClarifyingQuestion;
            }
            return null;
          })
          .filter((q: ClarifyingQuestion | null): q is ClarifyingQuestion => q !== null);
        // Read mentorIds from response or fallback to goal
        const respMentors = Array.isArray(body.mentors) ? body.mentors : [];
        const respMentorIds = respMentors
          .map((m: { id?: unknown }) => (typeof m.id === "string" ? m.id : ""))
          .filter((s: string) => s.length > 0);
        const goalRow = goals.find((g) => g.id === goalId);
        const mentorIds =
          respMentorIds.length > 0
            ? respMentorIds
            : goalRow?.mentorIds ?? [];
        setClarifyingState({
          goalId,
          questions,
          mentorId: typeof body.mentorId === "string" ? body.mentorId : "",
          mentorName: typeof body.mentorName === "string" ? body.mentorName : "Mentor",
          mentorIds,
          answers: questions.map(() => ""),
        });
        setExpandedGoal(goalId);
      } else {
        const msg =
          typeof body?.error === "string"
            ? body.error
            : `Nie udało się pobrać pytań (HTTP ${res.status}). Sprawdź admin/Mentorzy.`;
        setToast(msg);
        setTimeout(() => setToast(null), 6000);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setToast("Timeout (5 min) podczas pobierania pytań od mentora.");
      } else {
        setToast("Błąd sieci przy pobieraniu pytań od mentora.");
      }
      setTimeout(() => setToast(null), 6000);
    } finally {
      clearTimeout(timeoutId);
      setGeneratingPlanForGoal(null);
      setPlanStage(null);
    }
  };

  const updateClarifyingAnswer = (index: number, value: string) => {
    setClarifyingState((prev) => {
      if (!prev) return prev;
      const next = [...prev.answers];
      next[index] = value;
      return { ...prev, answers: next };
    });
  };

  const cancelClarifying = () => {
    setClarifyingState(null);
    setPlanStage(null);
  };

  /* ----------- Generate plan (step 2) ----------- */

  const submitClarifyingAnswers = async () => {
    if (!clarifyingState || submittingAnswers) return;
    const { goalId, mentorId, mentorIds, questions, answers } = clarifyingState;
    setSubmittingAnswers(true);
    setGeneratingPlanForGoal(goalId);
    setPlanStage("plan");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300_000);
    try {
      const payload = {
        goalId,
        mentorId,
        mentorIds,
        answers: questions.map((q, i) => ({
          question: q.question,
          answer: (answers[i] ?? "").trim(),
        })),
      };
      const res = await fetch("/api/goals/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.success) {
        const planCount = typeof body.planCount === "number" ? body.planCount : 0;
        haptic.success();
        setToast(
          planCount > 0
            ? `Plan wygenerowany! Mentor zaplanował ${planCount} tygodni.`
            : "Plan wygenerowany!"
        );
        setClarifyingState(null);
        try {
          const [goalsRes, plansRes] = await Promise.all([
            fetch("/api/goals?status=all"),
            fetch("/api/mentor-plans"),
          ]);
          if (goalsRes.ok) setGoals(await goalsRes.json());
          if (plansRes.ok) setPlans(await plansRes.json());
        } catch {
          // ignore
        }
        // Auto-switch user to the Plans tab so they immediately see the new plan
        setActiveTab("plans");
      } else {
        const msg =
          typeof body?.error === "string"
            ? body.error
            : `Nie udało się wygenerować planu (HTTP ${res.status}).`;
        haptic.error();
        setToast(msg);
      }
    } catch (err) {
      haptic.error();
      if (err instanceof DOMException && err.name === "AbortError") {
        setToast("Timeout (5 min). Mentor zbyt długo generuje plan — spróbuj ponownie.");
      } else {
        setToast("Błąd sieci przy generowaniu planu. Spróbuj ponownie.");
      }
    } finally {
      clearTimeout(timeoutId);
      setGeneratingPlanForGoal(null);
      setSubmittingAnswers(false);
      setPlanStage(null);
      setTimeout(() => setToast(null), 6000);
    }
  };

  /** Aktywne tab: active + paused. Zamknięte tab: achieved + abandoned (+ legacy). */
  const openGoals = goals.filter(isOpenGoal);
  const closedGoals = goals.filter(isClosedGoal);
  const activeCount = goals.filter((g) => g.status === "active").length;
  const achievedCount = goals.filter(isAchievedGoal).length;
  const avgProgress =
    openGoals.length > 0
      ? Math.round(openGoals.reduce((sum, g) => sum + g.progress, 0) / openGoals.length)
      : 0;
  const goalsTabs = [
    { key: "open" as const, label: `Aktywne (${openGoals.length})` },
    { key: "closed" as const, label: `Zamknięte (${closedGoals.length})` },
  ];
  // Derived, not stored: deleting the last closed goal hides the second tab, and
  // the user must not be left staring at a tab that no longer exists.
  const view = closedGoals.length === 0 ? "open" : goalsView;

  // Plans grouped by goal
  const plansByGoalId = new Map<string, MentorPlanData[]>();
  const orphanPlans: MentorPlanData[] = [];
  for (const p of plans) {
    if (p.goalId) {
      const list = plansByGoalId.get(p.goalId) ?? [];
      list.push(p);
      plansByGoalId.set(p.goalId, list);
    } else {
      orphanPlans.push(p);
    }
  }
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const goalHasPlan = (g: GoalData) => plansByGoalId.has(g.id);

  const anySheetOpen =
    showAddGoal ||
    editingGoal !== null ||
    confirmDeleteGoal !== null ||
    actionsForGoal !== null ||
    closeTarget !== null;

  const renderGoalCard = (goal: GoalData, index: number) => (
    <Reveal key={goal.id} index={index}>
      <GoalCard
        goal={goal}
        hasPlan={goalHasPlan(goal)}
        onAchieve={() => openCloseSheet(goal, "achieved")}
        onOpenActions={() => setActionsForGoal(goal)}
        onRestore={() => restoreGoal(goal)}
        restoring={restoringGoal === goal.id}
        isExpanded={expandedGoal === goal.id}
        onExpand={() => setExpandedGoal(expandedGoal === goal.id ? null : goal.id)}
        onToggleMilestone={toggleMilestone}
        togglingMilestones={togglingMilestones}
        generating={generatingPlanForGoal === goal.id}
        generatingAny={generatingPlanForGoal !== null}
        planStage={generatingPlanForGoal === goal.id ? planStage : null}
        clarifying={
          clarifyingState && clarifyingState.goalId === goal.id ? clarifyingState : null
        }
        onUpdateAnswer={updateClarifyingAnswer}
        onCancelClarifying={cancelClarifying}
        onSubmitAnswers={submitClarifyingAnswers}
        submittingAnswers={submittingAnswers}
        onGeneratePlan={() => startPlanGeneration(goal.id)}
        onStartEdit={() => startEditGoal(goal)}
        onRequestDelete={() => requestDeleteGoal(goal)}
      />
    </Reveal>
  );

  /* ---------------- Panels ---------------- */

  const goalsPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
      {goals.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={"\u{1F3AF}"}
            title="Nie masz jeszcze celów"
            body="Zapisz jeden konkretny cel, a mentor rozpisze go na tygodnie."
            action={{ label: "Dodaj cel", onPress: () => setShowAddGoal(true) }}
          />
        </Card>
      ) : (
        <>
          {/* Aktywne / Zamknięte. Only shown once something has actually been
              closed, so a fresh user never sees an empty second tab. */}
          {closedGoals.length > 0 && (
            <SegmentedTabs
              tabs={goalsTabs}
              active={view}
              onChange={(k) => setGoalsView(k)}
              variant="underline"
              // Not swipeable: this bar sits inside the Cele/Plany SwipeDeck and
              // two horizontal gestures stacked on top of each other fight.
              swipeable={false}
              ariaLabel="Cele aktywne i zamknięte"
            />
          )}

          {view === "open" ? (
            openGoals.length === 0 ? (
              <Card padding="none">
                <EmptyState
                  icon={"\u{1F3AF}"}
                  title="Brak aktywnych celów"
                  body="Wszystko zamknięte. Wyznacz kolejny cel albo przywróć jeden z zamkniętych."
                  action={{ label: "Dodaj cel", onPress: () => setShowAddGoal(true) }}
                  secondaryAction={{
                    label: "Zobacz zamknięte",
                    onPress: () => setGoalsView("closed"),
                  }}
                />
              </Card>
            ) : (
              openGoals.map((goal, i) => renderGoalCard(goal, i))
            )
          ) : closedGoals.length === 0 ? (
            <Card padding="none">
              <EmptyState
                icon={"\u{1F3C1}"}
                title="Nic tu jeszcze nie ma"
                body="Zamknięte i odpuszczone cele trafiają tutaj razem z datą i notatką."
                action={{ label: "Wróć do aktywnych", onPress: () => setGoalsView("open") }}
              />
            </Card>
          ) : (
            closedGoals.map((goal, i) => renderGoalCard(goal, i))
          )}

          {view === "open" && (
            <Button
              variant="secondary"
              size="md"
              fullWidth
              onPress={() => setShowAddGoal(true)}
              style={{ marginTop: T.sp2 }}
            >
              + Dodaj cel
            </Button>
          )}
        </>
      )}
    </div>
  );

  const plansPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp6 }}>
      {plans.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={"\u{1F4CB}"}
            title="Brak planów mentorów"
            body="Wybierz mentorów przy celu i poproś o plan. Rozpisze Ci tygodnie na zadania."
            action={{
              label: "Przejdź do celów",
              onPress: () => setActiveTab("goals"),
            }}
          />
        </Card>
      ) : (
        <>
          {Array.from(plansByGoalId.entries()).map(([goalId, list]) => {
            const goalRow = goalById.get(goalId);
            const title = list[0]?.goal?.title ?? goalRow?.title ?? "Cel";
            const progress = goalRow?.progress ?? list[0]?.goal?.progress ?? null;
            // Plans of a closed goal stay readable but are labelled, so an old
            // plan is never mistaken for something still on the schedule.
            const goalClosed = goalRow ? isClosedGoal(goalRow) : false;
            return (
              <section
                key={goalId}
                style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}
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
                  <div
                    style={{
                      ...TYPO.label,
                      color: T.text3,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {title}
                  </div>
                  <span
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}
                  >
                    {goalClosed && <Chip>Cel zamknięty</Chip>}
                    {typeof progress === "number" && (
                      <span
                        className="num"
                        style={{ ...TYPO.footnote, fontWeight: 700, color: T.text2 }}
                      >
                        {progress}%
                      </span>
                    )}
                  </span>
                </div>

                {list.map((plan, i) => (
                  <Reveal key={plan.id} index={i}>
                    <MentorPlanCard
                      plan={plan}
                      goalProgress={typeof progress === "number" ? progress : null}
                      togglingTasks={togglingTasks}
                      onToggleTask={toggleTask}
                      schedulingTask={schedulingTask}
                      onOpenSchedule={openScheduleForm}
                      scheduleForm={scheduleForm}
                      onScheduleFormChange={setScheduleForm}
                      onSubmitSchedule={submitSchedule}
                      submittingSchedule={submittingSchedule}
                      feedbackForTask={feedbackForTask}
                      feedbackDraft={feedbackDraft}
                      onOpenFeedback={openFeedbackForm}
                      onChangeFeedbackDraft={setFeedbackDraft}
                      onSubmitFeedback={submitFeedback}
                      submittingFeedback={submittingFeedback}
                    />
                  </Reveal>
                ))}
              </section>
            );
          })}

          {/* Legacy / orphaned plans (no goalId) */}
          {orphanPlans.length > 0 && (
            <section style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
              <div style={{ ...TYPO.label, color: T.text3, padding: `0 ${T.sp1}` }}>
                Plany bez powiązanego celu
              </div>

              {orphanPlans.map((plan) => (
                <MentorPlanCard
                  key={plan.id}
                  plan={plan}
                  goalProgress={null}
                  togglingTasks={togglingTasks}
                  onToggleTask={toggleTask}
                  schedulingTask={schedulingTask}
                  onOpenSchedule={openScheduleForm}
                  scheduleForm={scheduleForm}
                  onScheduleFormChange={setScheduleForm}
                  onSubmitSchedule={submitSchedule}
                  submittingSchedule={submittingSchedule}
                  feedbackForTask={feedbackForTask}
                  feedbackDraft={feedbackDraft}
                  onOpenFeedback={openFeedbackForm}
                  onChangeFeedbackDraft={setFeedbackDraft}
                  onSubmitFeedback={submitFeedback}
                  submittingFeedback={submittingFeedback}
                />
              ))}

              {!confirmCleanup ? (
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth
                  style={{ color: T.text3 }}
                  onPress={() => setConfirmCleanup(true)}
                >
                  Wyczyść stare plany ({orphanPlans.length})
                </Button>
              ) : (
                <Card variant="inset" padding="sm">
                  <div style={{ ...TYPO.footnote, color: T.text2, marginBottom: T.sp3 }}>
                    Usunąć {orphanPlans.length} starych planów bez powiązania z celem? Tej operacji
                    nie da się cofnąć.
                  </div>
                  <div style={{ display: "flex", gap: T.sp2 }}>
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onPress={() => setConfirmCleanup(false)}
                    >
                      Zostaw
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      fullWidth
                      onPress={async () => {
                        setConfirmCleanup(false);
                        try {
                          await fetch("/api/mentor-plans/cleanup-orphans", { method: "POST" });
                          fetchData();
                          haptic.warning();
                          setToast("Stare plany usunięte");
                          setTimeout(() => setToast(null), 3000);
                        } catch {
                          haptic.error();
                          setToast("Błąd usuwania");
                          setTimeout(() => setToast(null), 3000);
                        }
                      }}
                    >
                      Usuń
                    </Button>
                  </div>
                </Card>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );

  return (
    <div
      style={{
        padding: `${T.sp6} ${T.gutter} ${T.sp6}`,
        display: "flex",
        flexDirection: "column",
        gap: T.sp5,
      }}
    >
      {/* ---------------- Header ---------------- */}
      <header className="anim-in">
        <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Twój plan gry</div>
        <h1 style={{ ...TYPO.title1, fontWeight: 800, color: T.text, margin: 0 }}>Cele</h1>
        <p style={{ ...TYPO.callout, color: T.text2, margin: `${T.sp1} 0 0` }}>
          {loading
            ? "Cele i tygodniowe plany od mentorów."
            : `${activeCount} ${plural(activeCount, "aktywny cel", "aktywne cele", "aktywnych celów")} · ${achievedCount} ${plural(achievedCount, "osiągnięty", "osiągnięte", "osiągniętych")}`}
        </p>
      </header>

      {/* ---------------- Hero ---------------- */}
      {!loading && openGoals.length > 0 && (
        <section className="card-hero anim-in" style={{ animationDelay: "60ms" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: T.sp3 }}>
            <div style={{ minWidth: 0 }}>
              <AnimatedNumber
                value={avgProgress}
                unit="%"
                duration={800}
                className="hero-num"
                style={{ color: T.text }}
                unitStyle={{ fontSize: 20, fontWeight: 700, color: T.text3 }}
              />
              <div style={{ ...TYPO.callout, color: T.text2, marginTop: T.sp2 }}>
                średni postęp {openGoals.length}{" "}
                {openGoals.length === 1 ? "celu w toku" : "celów w toku"}
              </div>
            </div>
            {achievedCount > 0 && (
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div className="tile-num" style={{ color: T.successOnSurface }}>
                  {achievedCount}
                </div>
                <div style={{ ...TYPO.label, color: T.text3, marginTop: 2 }}>osiągnięte</div>
              </div>
            )}
          </div>

          <div
            role="progressbar"
            aria-valuenow={avgProgress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Średni postęp celów"
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
                width: `${Math.max(avgProgress, 2)}%`,
                height: "100%",
                borderRadius: T.rFull,
                background: "var(--grad-accent)",
                boxShadow: "var(--glow-accent-soft)",
                transition: "width 720ms var(--ease-out)",
              }}
            />
          </div>
        </section>
      )}

      {/* ---------------- Tabs + swipeable deck ---------------- */}
      <SegmentedTabs
        tabs={TABS}
        active={activeTab}
        onChange={(k) => setActiveTab(k)}
        ariaLabel="Cele i plany"
      />

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
          <Card padding="md">
            <Skeleton variant="list" count={3} />
          </Card>
          <Card padding="md">
            <Skeleton variant="list" count={2} />
          </Card>
        </div>
      ) : (
        <SwipeDeck
          index={activeTab === "goals" ? 0 : 1}
          onChange={(i) => setActiveTab(i === 0 ? "goals" : "plans")}
          labels={TABS.map((t) => t.label)}
          ariaLabel="Cele i plany"
          enabled={!anySheetOpen}
          heightPadding={4}
        >
          {goalsPanel}
          {plansPanel}
        </SwipeDeck>
      )}

      {/* ---------------- Add goal sheet ---------------- */}
      <Sheet
        open={showAddGoal}
        onClose={resetAddForm}
        title="Nowy cel"
        size="full"
        footer={
          <div style={{ display: "flex", gap: T.sp2 }}>
            <Button variant="secondary" size="lg" onPress={resetAddForm} disabled={addingGoal}>
              Anuluj
            </Button>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={addingGoal}
              disabled={!newTitle.trim()}
              onPress={addGoal}
            >
              Dodaj cel
            </Button>
          </div>
        }
      >
        <GoalForm
          title={newTitle}
          onTitle={setNewTitle}
          description={newDescription}
          onDescription={setNewDescription}
          mentorIds={newMentorIds}
          onToggleMentor={toggleNewMentor}
          targetDate={newTargetDate}
          onTargetDate={setNewTargetDate}
          mentorsList={mentorsList}
          disabled={addingGoal}
          autoFocus
        />
      </Sheet>

      {/* ---------------- Edit goal sheet ---------------- */}
      <Sheet
        open={editingGoal !== null && editDraft !== null}
        onClose={cancelEditGoal}
        title="Edytuj cel"
        size="full"
        footer={
          <div style={{ display: "flex", gap: T.sp2 }}>
            <Button variant="secondary" size="lg" onPress={cancelEditGoal} disabled={savingEdit}>
              Anuluj
            </Button>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={savingEdit}
              disabled={!editDraft?.title.trim()}
              onPress={saveEditGoal}
            >
              Zapisz
            </Button>
          </div>
        }
      >
        {editDraft && (
          <GoalForm
            title={editDraft.title}
            onTitle={(v) => setEditDraft({ ...editDraft, title: v })}
            description={editDraft.description}
            onDescription={(v) => setEditDraft({ ...editDraft, description: v })}
            mentorIds={editDraft.mentorIds}
            onToggleMentor={toggleEditMentor}
            targetDate={editDraft.targetDate}
            onTargetDate={(v) => setEditDraft({ ...editDraft, targetDate: v })}
            mentorsList={mentorsList}
            disabled={savingEdit}
          />
        )}
      </Sheet>

      {/* ---------------- Delete confirmation sheet ---------------- */}
      <Sheet
        open={confirmDeleteGoal !== null}
        onClose={() => {
          if (!deletingGoal) setConfirmDeleteGoal(null);
        }}
        title="Usunąć cel?"
        dismissOnBackdrop={!deletingGoal}
        footer={
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
            <Button
              variant="danger"
              size="lg"
              fullWidth
              loading={deletingGoal}
              onPress={confirmDelete}
            >
              Usuń cel i plany
            </Button>
            <Button
              variant="ghost"
              size="md"
              fullWidth
              disabled={deletingGoal}
              onPress={() => setConfirmDeleteGoal(null)}
            >
              Zostaw
            </Button>
          </div>
        }
      >
        <p style={{ ...TYPO.callout, color: T.text2, margin: 0 }}>
          Cel <b style={{ color: T.text }}>„{confirmDeleteGoal?.title}”</b> zniknie razem ze
          wszystkimi planami mentorów do tego celu. Tej operacji nie da się cofnąć.
        </p>
      </Sheet>

      {/* ---------------- Goal actions menu ---------------- */}
      <Sheet
        open={actionsForGoal !== null}
        onClose={() => setActionsForGoal(null)}
        title="Co zrobić z celem?"
        size="auto"
      >
        {actionsForGoal && (
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp1 }}>
            <div
              style={{
                ...TYPO.footnote,
                color: T.text3,
                marginBottom: T.sp2,
                overflowWrap: "anywhere",
              }}
            >
              „{actionsForGoal.title}”
            </div>

            <ListRow
              minHeight={ROW_H}
              leading={<MenuGlyph emoji={"\u{1F3C6}"} />}
              title="Cel osiągnięty"
              subtitle="Zamyka cel, znika z planu dnia"
              onPress={() => openCloseSheet(actionsForGoal, "achieved")}
              divider
            />

            {actionsForGoal.status === "paused" ? (
              <ListRow
                minHeight={ROW_H}
                leading={<MenuGlyph emoji={"\u{25B6}\u{FE0F}"} />}
                title="Wznów cel"
                subtitle="Wraca do planu dnia i do mentorów"
                onPress={() => restoreGoal(actionsForGoal)}
                divider
              />
            ) : (
              <ListRow
                minHeight={ROW_H}
                leading={<MenuGlyph emoji={"\u{23F8}\u{FE0F}"} />}
                title="Wstrzymaj"
                subtitle="Zostaje na liście, ale nie wraca codziennie"
                onPress={() => openCloseSheet(actionsForGoal, "paused")}
                divider
              />
            )}

            <ListRow
              minHeight={ROW_H}
              leading={<MenuGlyph emoji={"\u{1F343}"} />}
              title="Odpuszczam ten cel"
              subtitle="Trafia do zamkniętych, bez oceniania"
              onPress={() => openCloseSheet(actionsForGoal, "abandoned")}
            />
          </div>
        )}
      </Sheet>

      {/* ---------------- Close goal confirmation ---------------- */}
      <Sheet
        open={closeTarget !== null}
        onClose={closeCloseSheet}
        title={closeTarget ? CLOSE_COPY[closeTarget.mode].sheetTitle : undefined}
        size="auto"
        dismissOnBackdrop={!closingGoal}
        footer={
          closeTarget ? (
            <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
              <Button
                variant={CLOSE_COPY[closeTarget.mode].danger ? "danger" : "primary"}
                size="lg"
                fullWidth
                loading={closingGoal}
                haptic={CLOSE_COPY[closeTarget.mode].danger ? "warning" : "success"}
                onPress={confirmClose}
              >
                {CLOSE_COPY[closeTarget.mode].confirm}
              </Button>
              <Button
                variant="ghost"
                size="md"
                fullWidth
                disabled={closingGoal}
                onPress={closeCloseSheet}
              >
                Jeszcze nie
              </Button>
            </div>
          ) : undefined
        }
      >
        {closeTarget && (
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp5 }}>
            <p style={{ ...TYPO.callout, color: T.text2, margin: 0 }}>
              <b style={{ color: T.text }}>„{closeTarget.goal.title}”</b>
              <br />
              {CLOSE_COPY[closeTarget.mode].lead}
            </p>

            {CLOSE_COPY[closeTarget.mode].askOutcome && (
              <Field label="Jak poszło?" labelTrailing="opcjonalnie">
                <VoiceTextarea
                  value={outcomeDraft}
                  onChange={setOutcomeDraft}
                  placeholder="Jedno zdanie: co się udało, czego się nauczyłeś."
                  minHeight={88}
                  disabled={closingGoal}
                />
              </Field>
            )}
          </div>
        )}
      </Sheet>

      {/* ---------------- Celebration ----------------
          Decoration only: no focus trap, no pointer events, clears itself after 2 s. */}
      {celebrated && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: T.gutter,
            pointerEvents: "none",
          }}
        >
          <div
            className="anim-pop"
            style={{
              maxWidth: 320,
              textAlign: "center",
              padding: `${T.sp6} ${T.sp6} ${T.sp5}`,
              borderRadius: T.rXl,
              background: T.surface,
              border: `1px solid ${T.border}`,
              boxShadow: T.elev4,
            }}
          >
            <div aria-hidden="true" style={{ fontSize: 44, lineHeight: 1 }}>
              {"\u{1F3C6}"}
            </div>
            <div style={{ ...TYPO.title3, color: T.text, marginTop: T.sp3 }}>Cel osiągnięty</div>
            <div
              style={{
                ...TYPO.footnote,
                color: T.text2,
                marginTop: 4,
                overflowWrap: "anywhere",
              }}
            >
              {celebrated}
            </div>
            <div style={{ marginTop: T.sp4 }}>
              <AnimatedNumber
                value={achievedCount}
                duration={700}
                style={{ ...TYPO.metric, color: T.successOnSurface }}
              />
              <div style={{ ...TYPO.label, color: T.text3, marginTop: 2 }}>
                {plural(achievedCount, "osiągnięty cel", "osiągnięte cele", "osiągniętych celów")}
              </div>
            </div>
          </div>
        </div>
      )}

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
/*  GoalForm — shared by the add and the edit sheet                    */
/* ------------------------------------------------------------------ */

function GoalForm({
  title,
  onTitle,
  description,
  onDescription,
  mentorIds,
  onToggleMentor,
  targetDate,
  onTargetDate,
  mentorsList,
  disabled,
  autoFocus = false,
}: {
  title: string;
  onTitle: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
  mentorIds: string[];
  onToggleMentor: (id: string) => void;
  targetDate: string;
  onTargetDate: (v: string) => void;
  mentorsList: AvailableMentor[];
  disabled: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp6 }}>
      <Field label="Tytuł celu">
        <VoiceInput
          value={title}
          onChange={onTitle}
          placeholder="np. Przebiec półmaraton"
          autoFocus={autoFocus}
          disabled={disabled}
        />
      </Field>

      <Field label="Opis" labelTrailing="opcjonalnie">
        <VoiceTextarea
          value={description}
          onChange={onDescription}
          placeholder="Dlaczego ten cel jest ważny?"
          minHeight={80}
          disabled={disabled}
        />
      </Field>

      <Field label="Mentorzy" labelTrailing={`wybrano ${mentorIds.length}`}>
        <MentorCheckboxList
          mentorsList={mentorsList}
          selected={mentorIds}
          onToggle={onToggleMentor}
          disabled={disabled}
        />
      </Field>

      <Field label="Termin" labelTrailing="opcjonalnie">
        {(p) => (
          <input
            {...p}
            type="date"
            value={targetDate}
            onChange={(e) => onTargetDate(e.target.value)}
            style={fieldControlStyle}
          />
        )}
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  GoalCard                                                           */
/* ------------------------------------------------------------------ */

function GoalCard({
  goal,
  hasPlan,
  isExpanded,
  onExpand,
  onToggleMilestone,
  togglingMilestones,
  generating,
  generatingAny,
  planStage,
  clarifying,
  onUpdateAnswer,
  onCancelClarifying,
  onSubmitAnswers,
  submittingAnswers,
  onGeneratePlan,
  onStartEdit,
  onRequestDelete,
  onAchieve,
  onOpenActions,
  onRestore,
  restoring,
}: {
  goal: GoalData;
  hasPlan: boolean;
  isExpanded: boolean;
  onExpand: () => void;
  onToggleMilestone: (id: string) => void;
  togglingMilestones: Set<string>;
  generating: boolean;
  generatingAny: boolean;
  planStage: "questions" | "plan" | null;
  clarifying: ClarifyingState | null;
  onUpdateAnswer: (index: number, value: string) => void;
  onCancelClarifying: () => void;
  onSubmitAnswers: () => void;
  submittingAnswers: boolean;
  onGeneratePlan: () => void;
  onStartEdit: () => void;
  onRequestDelete: () => void;
  onAchieve: () => void;
  onOpenActions: () => void;
  onRestore: () => void;
  restoring: boolean;
}) {
  const isClosed = isClosedGoal(goal);
  const isAchieved = isAchievedGoal(goal);
  const isPaused = goal.status === "paused";
  const hasMentors = (goal.mentors?.length ?? 0) > 0 || (goal.mentorIds?.length ?? 0) > 0;
  const canExpand = goal.milestones.length > 0 || Boolean(goal.description);
  const doneMilestones = goal.milestones.filter((m) => m.completed).length;
  const closedOn = formatCloseDate(goal.achievedAt);

  return (
    <Card
      variant={isExpanded ? "elevated" : "default"}
      padding="md"
      style={{
        opacity: isClosed ? 0.82 : 1,
        boxShadow: isExpanded ? "var(--glow-accent-soft), var(--elev-3)" : undefined,
        transition: "box-shadow 220ms var(--ease-out)",
      }}
    >
      {/* --- header: ring + title + chips --- */}
      <Pressable
        as="div"
        press="none"
        haptic="tap"
        onPress={canExpand ? onExpand : undefined}
        ariaExpanded={canExpand ? isExpanded : undefined}
        noMinSize
        disabled={!canExpand}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: T.sp3,
          width: "100%",
          minHeight: T.tapMin,
          cursor: canExpand ? "pointer" : "default",
        }}
      >
        <ProgressRing value={goal.progress} id={goal.id} done={isAchieved} />

        <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <span
            style={{
              display: "block",
              ...TYPO.title3,
              color: isClosed ? T.text3 : T.text,
              // Struck through only when it was actually achieved. An abandoned
              // goal is not a finished one, it just stopped being current.
              textDecoration: isAchieved ? "line-through" : "none",
              overflowWrap: "anywhere",
            }}
          >
            {goal.title}
          </span>

          <span
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginTop: 6,
              alignItems: "center",
            }}
          >
            {isAchieved && (
              <Chip tone="success">
                {closedOn ? `Osiągnięty ${closedOn}` : "Osiągnięty"}
              </Chip>
            )}
            {goal.status === "abandoned" && (
              <Chip>{closedOn ? `Odpuszczony ${closedOn}` : "Odpuszczony"}</Chip>
            )}
            {isPaused && <Chip>Wstrzymany</Chip>}
            {goal.mentors?.slice(0, 2).map((m) => (
              <Chip key={m.id}>
                <span aria-hidden="true" style={{ fontSize: 14 }}>
                  {m.avatarEmoji ?? MENTOR_FALLBACK_EMOJI}
                </span>
                {m.name}
              </Chip>
            ))}
            {goal.mentors && goal.mentors.length > 2 && (
              <Chip>+{goal.mentors.length - 2}</Chip>
            )}
            {hasPlan && <Chip tone="accent">Plan gotowy</Chip>}
            {goal.milestones.length > 0 && (
              <span
                className="num"
                style={{ ...TYPO.footnote, fontWeight: 600, color: T.text3 }}
              >
                {doneMilestones}/{goal.milestones.length} kroków
              </span>
            )}
          </span>
        </span>

        {canExpand && (
          <span
            aria-hidden="true"
            style={{
              flexShrink: 0,
              color: T.text3,
              display: "inline-flex",
              transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 220ms var(--ease-out)",
            }}
          >
            <Icon path={ChevronPath} />
          </span>
        )}
      </Pressable>

      {/* --- closed goal: outcome + the one way back --- */}
      {isClosed ? (
        <div style={{ marginTop: T.sp4 }}>
          {goal.outcome && (
            <Card variant="inset" padding="sm" style={{ marginBottom: T.sp3 }}>
              <div style={{ ...TYPO.label, color: T.text3, marginBottom: 4 }}>Jak poszło</div>
              <div style={{ ...TYPO.footnote, color: T.text2, lineHeight: 1.45 }}>
                {goal.outcome}
              </div>
            </Card>
          )}
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            loading={restoring}
            onPress={onRestore}
          >
            Przywróć do aktywnych
          </Button>
          <div style={{ display: "flex", marginTop: T.sp2 }}>
            <Button
              variant="ghost"
              size="sm"
              onPress={onRequestDelete}
              style={{ color: T.dangerOnSurface, marginLeft: "auto" }}
              iconLeft={<Icon path={TrashPath} size={18} />}
            >
              Usuń
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* --- primary action ---
              Exactly one primary button per card (DESIGN-SPEC): before there is a
              plan the star is "wygeneruj plan", after that it is closing the goal. */}
          {!clarifying && (
            <div style={{ marginTop: T.sp4, display: "flex", flexDirection: "column", gap: T.sp2 }}>
              <Button
                variant={hasPlan ? "secondary" : "primary"}
                size="sm"
                fullWidth
                loading={generating}
                disabled={!hasMentors || (generatingAny && !generating)}
                onPress={onGeneratePlan}
              >
                {generating
                  ? planStage === "plan"
                    ? "Mentor pisze plan..."
                    : "Mentor analizuje cel..."
                  : !hasMentors
                    ? "Najpierw wybierz mentorów"
                    : hasPlan
                      ? "Przegeneruj plan"
                      : "Wygeneruj plan z mentorem"}
              </Button>

              <Button
                variant={hasPlan ? "primary" : "secondary"}
                size="sm"
                fullWidth
                haptic="success"
                disabled={generating}
                onPress={onAchieve}
              >
                Cel osiągnięty
              </Button>

              {!hasMentors && (
                <div style={{ ...TYPO.footnote, color: T.text3, textAlign: "center" }}>
                  Otwórz „Edytuj” i zaznacz mentorów.
                </div>
              )}
            </div>
          )}

          {/* --- quiet actions: 44 px each, never 28 px icons --- */}
          <div style={{ display: "flex", gap: T.sp2, marginTop: T.sp2 }}>
            <Button
              variant="ghost"
              size="sm"
              onPress={onStartEdit}
              iconLeft={<Icon path={PencilPath} size={18} />}
            >
              Edytuj
            </Button>
            <Button variant="ghost" size="sm" onPress={onOpenActions} style={{ color: T.text2 }}>
              Więcej
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={onRequestDelete}
              style={{ color: T.dangerOnSurface, marginLeft: "auto" }}
              iconLeft={<Icon path={TrashPath} size={18} />}
            >
              Usuń
            </Button>
          </div>
        </>
      )}

      {/* --- clarifying questions --- */}
      {clarifying && (
        <div style={{ marginTop: T.sp4, display: "flex", flexDirection: "column", gap: T.sp4 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: T.sp2,
            }}
          >
            <div style={{ ...TYPO.label, color: T.text3 }}>Mentorzy pytają</div>
            <Button
              variant="ghost"
              size="sm"
              disabled={submittingAnswers}
              onPress={onCancelClarifying}
              style={{ color: T.text3 }}
            >
              Anuluj
            </Button>
          </div>

          {clarifying.questions.map((q, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: T.sp3 }}>
                <span
                  aria-hidden="true"
                  className="num"
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: T.rFull,
                    background: T.primarySoft,
                    color: T.primaryOnSurface,
                    border: `1px solid var(--border-accent, transparent)`,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    ...TYPO.footnote,
                    fontWeight: 700,
                  }}
                >
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ ...TYPO.body, fontWeight: 500, color: T.text }}>{q.question}</div>
                  <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>
                    {q.mentorEmoji ? `${q.mentorEmoji} ` : ""}
                    {q.mentorName}
                  </div>
                </div>
              </div>
              <VoiceTextarea
                value={clarifying.answers[i] ?? ""}
                onChange={(v) => onUpdateAnswer(i, v)}
                placeholder="Twoja odpowiedź..."
                minHeight={88}
                disabled={submittingAnswers}
              />
            </div>
          ))}

          <Button
            variant="primary"
            size="md"
            fullWidth
            loading={submittingAnswers}
            onPress={onSubmitAnswers}
          >
            Wyślij odpowiedzi
          </Button>
        </div>
      )}

      {/* --- expanded: description + milestones --- */}
      {isExpanded && canExpand && (
        <div className="reveal" style={{ marginTop: T.sp4 }}>
          {goal.description && (
            <Card variant="inset" padding="sm" style={{ marginBottom: T.sp3 }}>
              <div style={{ ...TYPO.callout, color: T.text2 }}>{goal.description}</div>
            </Card>
          )}
          {goal.milestones.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: T.sp1 }}>
              {goal.milestones.map((m) => (
                <ListRow
                  key={m.id}
                  minHeight={ROW_H}
                  leading={
                    <CheckBox
                      checked={m.completed}
                      disabled={togglingMilestones.has(m.id)}
                      label={m.title}
                      onToggle={() => onToggleMilestone(m.id)}
                    />
                  }
                  title={m.title}
                  done={m.completed}
                  dimmed={togglingMilestones.has(m.id)}
                  onPress={() => {
                    if (!togglingMilestones.has(m.id)) onToggleMilestone(m.id);
                  }}
                  haptic={false}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}


/* ------------------------------------------------------------------ */
/*  MentorPlanCard                                                     */
/* ------------------------------------------------------------------ */

function MentorPlanCard({
  plan,
  goalProgress,
  togglingTasks,
  onToggleTask,
  schedulingTask,
  onOpenSchedule,
  scheduleForm,
  onScheduleFormChange,
  onSubmitSchedule,
  submittingSchedule,
  feedbackForTask,
  feedbackDraft,
  onOpenFeedback,
  onChangeFeedbackDraft,
  onSubmitFeedback,
  submittingFeedback,
}: {
  plan: MentorPlanData;
  goalProgress: number | null;
  togglingTasks: Set<string>;
  onToggleTask: (planId: string, taskIndex: number) => void;
  schedulingTask: string | null;
  onOpenSchedule: (planId: string, taskIndex: number) => void;
  scheduleForm: { date: string; time: string; durationMin: number };
  onScheduleFormChange: (s: { date: string; time: string; durationMin: number }) => void;
  onSubmitSchedule: (planId: string, taskIndex: number) => void;
  submittingSchedule: boolean;
  feedbackForTask: string | null;
  feedbackDraft: string;
  onOpenFeedback: (planId: string, taskIndex: number, current: string | undefined) => void;
  onChangeFeedbackDraft: (v: string) => void;
  onSubmitFeedback: (planId: string, taskIndex: number) => void;
  submittingFeedback: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const tasks = Array.isArray(plan.tasks) ? (plan.tasks as PlanTask[]) : [];
  const doneCount = tasks.filter((t) => t.done).length;
  const pct = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0;

  return (
    <Card variant={expanded ? "elevated" : "default"} padding="md">
      <Pressable
        as="div"
        press="none"
        haptic="tap"
        onPress={() => setExpanded((v) => !v)}
        ariaExpanded={expanded}
        noMinSize
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: T.sp3,
          width: "100%",
          minHeight: T.tapMin,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: T.rFull,
            background: T.surface2,
            border: `1px solid ${T.border}`,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            lineHeight: 1,
          }}
        >
          {plan.mentor.avatarEmoji ?? MENTOR_FALLBACK_EMOJI}
        </span>

        <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <span style={{ display: "block", ...TYPO.title3, color: T.text }}>
            {plan.mentor.name}
          </span>
          <span style={{ display: "block", ...TYPO.footnote, color: T.text3, marginTop: 2 }}>
            Tydzień {plan.weekNumber} · Faza {plan.phase}
            {typeof goalProgress === "number" ? ` · cel ${goalProgress}%` : ""}
          </span>
        </span>

        <span
          className="num"
          style={{
            flexShrink: 0,
            ...TYPO.footnote,
            fontWeight: 700,
            color: doneCount === tasks.length && tasks.length > 0 ? T.successOnSurface : T.text2,
          }}
        >
          {doneCount}/{tasks.length}
        </span>

        <span
          aria-hidden="true"
          style={{
            flexShrink: 0,
            color: T.text3,
            display: "inline-flex",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 220ms var(--ease-out)",
          }}
        >
          <Icon path={ChevronPath} />
        </span>
      </Pressable>

      {/* thin progress line, always visible: the plan's own completion */}
      <div
        style={{
          marginTop: T.sp3,
          height: 6,
          borderRadius: T.rFull,
          background: T.surface3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: T.rFull,
            background: pct === 100 ? T.success : "var(--grad-accent)",
            transition: "width 720ms var(--ease-out)",
          }}
        />
      </div>

      {expanded && (
        <div className="reveal" style={{ marginTop: T.sp4 }}>
          {plan.notes && (
            <Card variant="inset" padding="sm" style={{ marginBottom: T.sp3 }}>
              <div style={{ ...TYPO.callout, color: T.text2, fontStyle: "italic" }}>
                {plan.notes}
              </div>
            </Card>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
            {tasks.map((task, i) => {
              const key = `${plan.id}:${i}`;
              const toggling = togglingTasks.has(key);
              const isScheduling = schedulingTask === key;
              const isGivingFeedback = feedbackForTask === key;
              return (
                <div key={i} style={{ opacity: toggling ? 0.6 : 1, transition: "opacity 150ms ease" }}>
                  <ListRow
                    minHeight={ROW_H}
                    leading={
                      <CheckBox
                        checked={Boolean(task.done)}
                        disabled={toggling}
                        label={task.title}
                        onToggle={() => onToggleTask(plan.id, i)}
                      />
                    }
                    title={task.title}
                    subtitle={task.description}
                    done={Boolean(task.done)}
                    onPress={() => {
                      if (!toggling) onToggleTask(plan.id, i);
                    }}
                    haptic={false}
                  />

                  {task.frequency && (
                    <div style={{ paddingLeft: 56, marginTop: 2 }}>
                      <Chip>{task.frequency}</Chip>
                    </div>
                  )}

                  {task.feedback && task.feedback.trim().length > 0 && (
                    // indent via a wrapper: `marginLeft` on a width:100% Card would
                    // push it 56 px past the card edge
                    <div style={{ paddingLeft: 56, marginTop: T.sp2 }}>
                      <Card variant="inset" padding="sm">
                        <div style={{ ...TYPO.label, color: T.text3, marginBottom: 4 }}>
                          Twoja uwaga
                        </div>
                        <div style={{ ...TYPO.footnote, color: T.text2, lineHeight: 1.45 }}>
                          {task.feedback}
                        </div>
                      </Card>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: T.sp2, paddingLeft: T.sp2, marginTop: 2 }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => onOpenSchedule(plan.id, i)}
                      style={{ color: isScheduling ? T.text3 : T.primaryOnSurface }}
                    >
                      {isScheduling ? "Zamknij" : "Zaplanuj"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => onOpenFeedback(plan.id, i, task.feedback)}
                      style={{ color: isGivingFeedback ? T.text3 : T.text2 }}
                    >
                      {isGivingFeedback
                        ? "Zamknij"
                        : task.feedback && task.feedback.trim().length > 0
                          ? "Zmień uwagę"
                          : "Dodaj uwagę"}
                    </Button>
                  </div>

                  {/* Inline feedback form */}
                  {isGivingFeedback && (
                    <Card variant="inset" padding="sm" className="reveal" style={{ marginTop: T.sp2 }}>
                      <div style={{ ...TYPO.footnote, color: T.text3, marginBottom: T.sp2 }}>
                        Mentor zobaczy tę uwagę przy kolejnym planie.
                      </div>
                      <VoiceTextarea
                        value={feedbackDraft}
                        onChange={onChangeFeedbackDraft}
                        placeholder="np. za trudne, zrobione z modyfikacją..."
                        minHeight={72}
                        disabled={submittingFeedback}
                      />
                      <Button
                        variant="primary"
                        size="sm"
                        fullWidth
                        loading={submittingFeedback}
                        onPress={() => onSubmitFeedback(plan.id, i)}
                        style={{ marginTop: T.sp2 }}
                      >
                        {feedbackDraft.trim().length === 0 ? "Usuń uwagę" : "Zapisz uwagę"}
                      </Button>
                    </Card>
                  )}

                  {/* Inline schedule form */}
                  {isScheduling && (
                    <Card variant="inset" padding="sm" className="reveal" style={{ marginTop: T.sp2 }}>
                      <div style={{ display: "flex", gap: T.sp2, flexWrap: "wrap" }}>
                        {/* width:auto so the Field's own width:100% does not beat flex-basis */}
                        <Field label="Data" style={{ flex: "1 1 132px", width: "auto", minWidth: 132 }}>
                          {(p) => (
                            <input
                              {...p}
                              type="date"
                              value={scheduleForm.date}
                              onChange={(e) =>
                                onScheduleFormChange({ ...scheduleForm, date: e.target.value })
                              }
                              style={fieldControlStyle}
                            />
                          )}
                        </Field>
                        <Field label="Godzina" style={{ flex: "1 1 108px", width: "auto", minWidth: 108 }}>
                          {(p) => (
                            <input
                              {...p}
                              type="time"
                              value={scheduleForm.time}
                              onChange={(e) =>
                                onScheduleFormChange({ ...scheduleForm, time: e.target.value })
                              }
                              style={fieldControlStyle}
                            />
                          )}
                        </Field>
                        <Field label="Czas (min)" style={{ flex: "1 1 100px", width: "auto", minWidth: 100 }}>
                          {(p) => (
                            <input
                              {...p}
                              type="number"
                              inputMode="numeric"
                              min={5}
                              max={300}
                              value={scheduleForm.durationMin}
                              onChange={(e) =>
                                onScheduleFormChange({
                                  ...scheduleForm,
                                  durationMin: parseInt(e.target.value, 10) || 30,
                                })
                              }
                              style={fieldControlStyle}
                            />
                          )}
                        </Field>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        fullWidth
                        loading={submittingSchedule}
                        onPress={() => onSubmitSchedule(plan.id, i)}
                        style={{ marginTop: T.sp3 }}
                      >
                        Dodaj do dashboard
                      </Button>
                    </Card>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
