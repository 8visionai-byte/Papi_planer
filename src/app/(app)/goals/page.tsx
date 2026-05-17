"use client";

import { useState, useEffect, useCallback } from "react";
import VoiceInput from "@/components/forms/VoiceInput";
import VoiceTextarea from "@/components/forms/VoiceTextarea";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MentorRef {
  id: string;
  name: string;
  avatarEmoji: string | null;
  role: string;
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
  status: string;
  progress: number;
  targetDate: string | null;
  mentor: MentorRef | null;
  lifeArea: LifeAreaRef | null;
  milestones: Milestone[];
}

interface MentorPlanData {
  id: string;
  weekNumber: number;
  phase: number;
  tasks: PlanTask[];
  notes: string | null;
  mentor: MentorRef;
}

interface PlanTask {
  title: string;
  description?: string;
  frequency?: string;
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
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function GoalsPage() {
  const [goals, setGoals] = useState<GoalData[]>([]);
  const [plans, setPlans] = useState<MentorPlanData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"goals" | "plans">("goals");
  const [expandedGoal, setExpandedGoal] = useState<string | null>(null);
  const [togglingMilestones, setTogglingMilestones] = useState<Set<string>>(new Set());

  const [showAddGoal, setShowAddGoal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [addingGoal, setAddingGoal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [generatingPlanForGoal, setGeneratingPlanForGoal] = useState<string | null>(null);
  const [planStage, setPlanStage] = useState<"questions" | "plan" | null>(null);
  const [clarifyingState, setClarifyingState] = useState<{
    goalId: string;
    questions: string[];
    mentorId: string;
    mentorName: string;
    answers: string[];
  } | null>(null);
  const [submittingAnswers, setSubmittingAnswers] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [goalsRes, plansRes] = await Promise.all([
        fetch("/api/goals"),
        fetch("/api/mentor-plans"),
      ]);
      if (goalsRes.ok) setGoals(await goalsRes.json());
      if (plansRes.ok) setPlans(await plansRes.json());
    } catch {
      // keep empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleMilestone = async (milestoneId: string) => {
    if (togglingMilestones.has(milestoneId)) return;
    setTogglingMilestones((prev) => new Set(prev).add(milestoneId));

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
        const { goalProgress } = await res.json();
        setGoals((prev) =>
          prev.map((g) => {
            const hasMilestone = g.milestones.some((m) => m.id === milestoneId);
            if (!hasMilestone) return g;
            return {
              ...g,
              progress: goalProgress,
              status: goalProgress === 100 ? "completed" : "active",
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
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as GoalData & {
          generatedPlanCount?: number;
          mentorId?: string;
        };
        const generatedPlanCount = body.generatedPlanCount;
        // Strip server-only flags before storing in goals list
        const goal: GoalData = {
          id: body.id,
          title: body.title,
          description: body.description,
          status: body.status,
          progress: body.progress,
          targetDate: body.targetDate,
          mentor: body.mentor,
          lifeArea: body.lifeArea,
          milestones: body.milestones,
        };
        setGoals((prev) => [goal, ...prev]);
        setNewTitle("");
        setNewDescription("");
        setShowAddGoal(false);

        if (generatedPlanCount && generatedPlanCount > 0) {
          setToast(
            `Cel utworzony! Mentor wygenerował plan na ${generatedPlanCount} tygodni.`
          );
          // Refresh plans list so the new MentorPlan rows appear in the Plans tab
          try {
            const plansRes = await fetch("/api/mentor-plans");
            if (plansRes.ok) setPlans(await plansRes.json());
          } catch {
            // ignore
          }
        } else {
          setToast("Cel utworzony.");
        }
        setTimeout(() => setToast(null), 4000);
      }
    } catch {
      // ignore
    } finally {
      setAddingGoal(false);
    }
  };

  // Step 1: ask mentor for clarifying questions
  const generatePlanForGoal = async (goalId: string) => {
    if (generatingPlanForGoal) return;
    // If a clarifying flow is already open for another goal, cancel it
    if (clarifyingState && clarifyingState.goalId !== goalId) {
      setClarifyingState(null);
    }
    setGeneratingPlanForGoal(goalId);
    setPlanStage("questions");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300_000);
    try {
      const res = await fetch("/api/goals/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body?.stage === "questions" && Array.isArray(body.questions)) {
        const questions: string[] = body.questions.filter(
          (q: unknown) => typeof q === "string" && q.trim().length > 0
        );
        setClarifyingState({
          goalId,
          questions,
          mentorId: typeof body.mentorId === "string" ? body.mentorId : "",
          mentorName: typeof body.mentorName === "string" ? body.mentorName : "Mentor",
          answers: questions.map(() => ""),
        });
        // Auto-expand goal card so questions appear in context
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

  // Step 2: send answers, mentor generates plan
  const submitClarifyingAnswers = async () => {
    if (!clarifyingState || submittingAnswers) return;
    const { goalId, mentorId, questions, answers } = clarifyingState;
    setSubmittingAnswers(true);
    setGeneratingPlanForGoal(goalId);
    setPlanStage("plan");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300_000);
    try {
      const payload = {
        goalId,
        mentorId,
        answers: questions.map((q, i) => ({
          question: q,
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
        setToast(
          planCount > 0
            ? `Plan wygenerowany! Mentor zaplanował ${planCount} tygodni.`
            : "Plan wygenerowany!"
        );
        setClarifyingState(null);
        try {
          const [goalsRes, plansRes] = await Promise.all([
            fetch("/api/goals"),
            fetch("/api/mentor-plans"),
          ]);
          if (goalsRes.ok) setGoals(await goalsRes.json());
          if (plansRes.ok) setPlans(await plansRes.json());
        } catch {
          // ignore
        }
      } else {
        const msg =
          typeof body?.error === "string"
            ? body.error
            : `Nie udało się wygenerować planu (HTTP ${res.status}).`;
        setToast(msg);
      }
    } catch (err) {
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

  const activeGoals = goals.filter((g) => g.status === "active");
  const completedGoals = goals.filter((g) => g.status === "completed");

  const mentorIdsWithPlans = new Set(plans.map((p) => p.mentor.id));
  const goalHasPlan = (g: GoalData) =>
    !!g.mentor && mentorIdsWithPlans.has(g.mentor.id);

  const mentorGroups = new Map<string, { mentor: MentorRef; goals: GoalData[] }>();
  for (const g of activeGoals) {
    const key = g.mentor?.id ?? "_none";
    if (!mentorGroups.has(key)) {
      mentorGroups.set(key, {
        mentor: g.mentor ?? { id: "_none", name: "Bez mentora", avatarEmoji: "\u{1F3AF}", role: "" },
        goals: [],
      });
    }
    mentorGroups.get(key)!.goals.push(g);
  }

  return (
    <div style={{ padding: "20px 16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--foreground)", margin: 0 }}>
          Moje Cele
        </h1>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: "4px 0 0" }}>
          Cele i plany mentorów
        </p>
      </div>

      {/* Tab pills */}
      <div style={{ display: "flex", gap: 4 }}>
        {(["goals", "plans"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 16px",
              borderRadius: 9999,
              border: "none",
              background: activeTab === tab ? "var(--primary)" : "transparent",
              color: activeTab === tab ? "#fff" : "var(--muted)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 200ms ease",
            }}
          >
            {tab === "goals" ? "Cele" : "Plany mentorów"}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={cardStyle}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: 14,
                width: `${50 + i * 15}%`,
                borderRadius: 7,
                background: "var(--border)",
                marginBottom: 10,
                animation: "pulse 1.5s ease-in-out infinite",
              }}
            />
          ))}
        </div>
      )}

      {/* Goals tab */}
      {!loading && activeTab === "goals" && (
        <>
          {/* Add goal button */}
          {!showAddGoal ? (
            <button
              onClick={() => setShowAddGoal(true)}
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
                transition: "all 150ms ease",
              }}
            >
              + Dodaj cel
            </button>
          ) : (
            <div style={cardStyle}>
              <VoiceInput
                value={newTitle}
                onChange={setNewTitle}
                placeholder="Nazwa celu..."
                autoFocus
              />
              <div style={{ marginTop: 8 }}>
                <VoiceTextarea
                  value={newDescription}
                  onChange={setNewDescription}
                  placeholder="Opis (opcjonalnie)..."
                  minHeight={80}
                />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  onClick={addGoal}
                  disabled={!newTitle.trim() || addingGoal}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: 10,
                    border: "none",
                    background: "var(--primary)",
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: addingGoal ? "not-allowed" : "pointer",
                    opacity: !newTitle.trim() || addingGoal ? 0.5 : 1,
                  }}
                >
                  {addingGoal ? "Mentor generuje plan..." : "Dodaj"}
                </button>
                <button
                  onClick={() => {
                    setShowAddGoal(false);
                    setNewTitle("");
                    setNewDescription("");
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

          {/* Empty state */}
          {activeGoals.length === 0 && completedGoals.length === 0 && (
            <div style={{ ...cardStyle, textAlign: "center", padding: "40px 16px" }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>{"\u{1F3AF}"}</div>
              <div style={{ fontSize: 16, fontWeight: 500, color: "var(--foreground)" }}>
                Brak celow
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                Dodaj cel lub poczekaj az mentor zaproponuje cele
              </div>
            </div>
          )}

          {/* Active goals grouped by mentor */}
          {Array.from(mentorGroups.values()).map(({ mentor, goals: mentorGoals }) => (
            <div key={mentor.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px" }}>
                <span style={{ fontSize: 20 }}>{mentor.avatarEmoji}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>
                  {mentor.name}
                </span>
                {mentor.role && (
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>· {mentor.role}</span>
                )}
              </div>
              {mentorGoals.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  hasPlan={goalHasPlan(goal)}
                  isExpanded={expandedGoal === goal.id}
                  onExpand={() => setExpandedGoal(expandedGoal === goal.id ? null : goal.id)}
                  onToggleMilestone={toggleMilestone}
                  togglingMilestones={togglingMilestones}
                  onGeneratePlan={generatePlanForGoal}
                  generating={generatingPlanForGoal === goal.id}
                  generatingAny={generatingPlanForGoal !== null}
                  planStage={generatingPlanForGoal === goal.id ? planStage : null}
                  clarifying={
                    clarifyingState && clarifyingState.goalId === goal.id
                      ? clarifyingState
                      : null
                  }
                  onUpdateAnswer={updateClarifyingAnswer}
                  onCancelClarifying={cancelClarifying}
                  onSubmitAnswers={submitClarifyingAnswers}
                  submittingAnswers={submittingAnswers}
                />
              ))}
            </div>
          ))}

          {/* Completed goals */}
          {completedGoals.length > 0 && (
            <div style={{ marginTop: 8 }}>
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
                Ukonczone ({completedGoals.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {completedGoals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    hasPlan={goalHasPlan(goal)}
                    isExpanded={expandedGoal === goal.id}
                    onExpand={() => setExpandedGoal(expandedGoal === goal.id ? null : goal.id)}
                    onToggleMilestone={toggleMilestone}
                    togglingMilestones={togglingMilestones}
                    onGeneratePlan={generatePlanForGoal}
                    generating={generatingPlanForGoal === goal.id}
                    generatingAny={generatingPlanForGoal !== null}
                    planStage={generatingPlanForGoal === goal.id ? planStage : null}
                    clarifying={
                      clarifyingState && clarifyingState.goalId === goal.id
                        ? clarifyingState
                        : null
                    }
                    onUpdateAnswer={updateClarifyingAnswer}
                    onCancelClarifying={cancelClarifying}
                    onSubmitAnswers={submitClarifyingAnswers}
                    submittingAnswers={submittingAnswers}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Plans tab */}
      {!loading && activeTab === "plans" && (
        <>
          {plans.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: "center", padding: "40px 16px" }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>{"\u{1F4CB}"}</div>
              <div style={{ fontSize: 16, fontWeight: 500, color: "var(--foreground)" }}>
                Brak planow mentorów
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                Plany pojawia sie gdy mentorzy zaczna planowac Twoje tygodnie
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {plans.map((plan) => (
                <MentorPlanCard key={plan.id} plan={plan} />
              ))}
            </div>
          )}
        </>
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
/*  GoalCard                                                           */
/* ------------------------------------------------------------------ */

function GoalCard({
  goal,
  hasPlan,
  isExpanded,
  onExpand,
  onToggleMilestone,
  togglingMilestones,
  onGeneratePlan,
  generating,
  generatingAny,
  planStage,
  clarifying,
  onUpdateAnswer,
  onCancelClarifying,
  onSubmitAnswers,
  submittingAnswers,
}: {
  goal: GoalData;
  hasPlan: boolean;
  isExpanded: boolean;
  onExpand: () => void;
  onToggleMilestone: (id: string) => void;
  togglingMilestones: Set<string>;
  onGeneratePlan: (goalId: string) => void;
  generating: boolean;
  generatingAny: boolean;
  planStage: "questions" | "plan" | null;
  clarifying: {
    goalId: string;
    questions: string[];
    mentorId: string;
    mentorName: string;
    answers: string[];
  } | null;
  onUpdateAnswer: (index: number, value: string) => void;
  onCancelClarifying: () => void;
  onSubmitAnswers: () => void;
  submittingAnswers: boolean;
}) {
  const isCompleted = goal.status === "completed";

  return (
    <div
      style={{
        ...cardStyle,
        opacity: isCompleted ? 0.7 : 1,
        border: isExpanded ? "1px solid var(--primary)" : "1px solid transparent",
        transition: "border 200ms ease",
      }}
    >
      <div
        onClick={onExpand}
        style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
      >
        {/* Progress circle */}
        <div style={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle
              cx="20"
              cy="20"
              r="16"
              fill="none"
              stroke="var(--border)"
              strokeWidth="3"
            />
            <circle
              cx="20"
              cy="20"
              r="16"
              fill="none"
              stroke={isCompleted ? "var(--success)" : "var(--primary)"}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(goal.progress / 100) * 100.53} 100.53`}
              transform="rotate(-90 20 20)"
              style={{ transition: "stroke-dasharray 400ms ease" }}
            />
          </svg>
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
              color: "var(--foreground)",
            }}
          >
            {goal.progress}%
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--foreground)",
              textDecoration: isCompleted ? "line-through" : "none",
            }}
          >
            {goal.title}
          </div>
          {goal.lifeArea && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              {goal.lifeArea.name}
            </div>
          )}
          {hasPlan && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginTop: 4,
                padding: "2px 8px",
                borderRadius: 9999,
                background: "var(--primary)",
                color: "#fff",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {"\u{1F4CB}"} Plan dostępny
            </div>
          )}
        </div>

        {goal.milestones.length > 0 && (
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
        )}
      </div>

      {/* Generate plan button - hidden while questions form is open for THIS goal */}
      {!clarifying && (
        <div style={{ marginTop: 10 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onGeneratePlan(goal.id);
            }}
            disabled={generatingAny}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "none",
              background: "var(--primary)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: generatingAny ? "not-allowed" : "pointer",
              opacity: generatingAny && !generating ? 0.4 : generating ? 0.7 : 1,
            }}
          >
            {generating
              ? planStage === "plan"
                ? "Mentor pisze plan..."
                : "Mentor analizuje cel..."
              : "\u{1F9E0} Wygeneruj plan z mentorem"}
          </button>
        </div>
      )}

      {/* Inline clarifying questions section */}
      {clarifying && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            background: "var(--background)",
            border: "1px solid var(--primary)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
              {"\u{1F4AC}"} {clarifying.mentorName} pyta:
            </div>
            <button
              onClick={onCancelClarifying}
              disabled={submittingAnswers}
              style={{
                padding: "4px 10px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--muted)",
                fontSize: 12,
                cursor: submittingAnswers ? "not-allowed" : "pointer",
                opacity: submittingAnswers ? 0.5 : 1,
              }}
            >
              Anuluj
            </button>
          </div>

          {clarifying.questions.map((q, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--foreground)",
                  lineHeight: 1.4,
                }}
              >
                {i + 1}. {q}
              </div>
              <VoiceTextarea
                value={clarifying.answers[i] ?? ""}
                onChange={(v) => onUpdateAnswer(i, v)}
                placeholder="Twoja odpowiedź..."
                minHeight={60}
                disabled={submittingAnswers}
              />
            </div>
          ))}

          <button
            onClick={onSubmitAnswers}
            disabled={submittingAnswers}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              background: "var(--primary)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: submittingAnswers ? "not-allowed" : "pointer",
              opacity: submittingAnswers ? 0.7 : 1,
            }}
          >
            {submittingAnswers ? "Mentor pisze plan..." : "Wyślij odpowiedzi"}
          </button>
        </div>
      )}

      {/* Expanded: description + milestones */}
      {isExpanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          {goal.description && (
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, marginBottom: 10 }}>
              {goal.description}
            </div>
          )}
          {goal.milestones.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {goal.milestones.map((m) => (
                <button
                  key={m.id}
                  onClick={() => onToggleMilestone(m.id)}
                  disabled={togglingMilestones.has(m.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 0",
                    background: "none",
                    border: "none",
                    cursor: togglingMilestones.has(m.id) ? "not-allowed" : "pointer",
                    width: "100%",
                    textAlign: "left",
                    fontFamily: "inherit",
                    opacity: togglingMilestones.has(m.id) ? 0.5 : 1,
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 5,
                      border: m.completed ? "none" : "2px solid var(--border)",
                      background: m.completed ? "var(--success)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      transition: "all 200ms ease",
                    }}
                  >
                    {m.completed && (
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
                      fontSize: 14,
                      color: m.completed ? "var(--muted)" : "var(--foreground)",
                      textDecoration: m.completed ? "line-through" : "none",
                    }}
                  >
                    {m.title}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MentorPlanCard                                                     */
/* ------------------------------------------------------------------ */

function MentorPlanCard({ plan }: { plan: MentorPlanData }) {
  const [expanded, setExpanded] = useState(false);
  const tasks = Array.isArray(plan.tasks) ? (plan.tasks as PlanTask[]) : [];

  return (
    <div style={cardStyle}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
      >
        <span style={{ fontSize: 24 }}>{plan.mentor.avatarEmoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--foreground)" }}>
            {plan.mentor.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Tydzien {plan.weekNumber} · Faza {plan.phase}
          </div>
        </div>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>
          {tasks.length} zadan
        </span>
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
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            opacity: 0.5,
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          {plan.notes && (
            <div
              style={{
                fontSize: 13,
                color: "var(--muted)",
                lineHeight: 1.5,
                marginBottom: 10,
                fontStyle: "italic",
              }}
            >
              {plan.notes}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tasks.map((task, i) => (
              <div
                key={i}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: "var(--background)",
                  fontSize: 14,
                }}
              >
                <div style={{ fontWeight: 500, color: "var(--foreground)" }}>{task.title}</div>
                {task.description && (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                    {task.description}
                  </div>
                )}
                {task.frequency && (
                  <div style={{ fontSize: 11, color: "var(--primary)", marginTop: 3, fontWeight: 500 }}>
                    {task.frequency}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
