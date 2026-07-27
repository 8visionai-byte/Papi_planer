import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { estimateCalories } from "@/lib/ai/calorie-calculator";
import { estimateMacros } from "@/lib/ai/meal-estimator";
import { getCurrentBodyMetrics } from "@/lib/ai/body-metrics";
import { habitDateForLog } from "@/lib/habits/link";

const FOLLOW_UP_TYPES = new Set(["training", "exercise", "workout", "sport", "practice"]);

const MEAL_KEYWORDS = [
  "śniadanie",
  "drugie śniadanie",
  "obiad",
  "kolacja",
  "posiłek",
  "podwieczorek",
  "przekąska",
];

function detectMealType(name: string): string | null {
  const lower = name.toLowerCase();
  // Match longer keywords first so "drugie śniadanie" wins over "śniadanie"
  const sorted = [...MEAL_KEYWORDS].sort((a, b) => b.length - a.length);
  for (const kw of sorted) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { activityId, customMeal } = body as {
    activityId?: string;
    customMeal?: {
      name?: string;
      calories?: number;
      protein?: number | null;
      carbs?: number | null;
      fat?: number | null;
      description?: string | null;
    } | null;
  };
  if (!activityId || typeof activityId !== "string") {
    return NextResponse.json({ error: "activityId required" }, { status: 400 });
  }

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    // `date` is loaded because a habit completion belongs to the day of the plan that
    // was ticked, not to whatever day it happens to be while ticking it.
    include: { dailyLog: { select: { id: true, userId: true, date: true } } },
  });

  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  if (activity.dailyLog.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Auto-kalkulacja kalorii przy oznaczeniu jako ukończone
  const newCompleted = !activity.completed;
  let calories: number | null = null;
  let weight = 80;

  if (newCompleted && activity.durationMin) {
    // Live weight (7-day average of WeightEntry), not the frozen profile value.
    const bodyMetrics = await getCurrentBodyMetrics(session.user.id);
    weight = bodyMetrics.weightKg;
    calories = estimateCalories(activity.type, activity.name, activity.durationMin, weight);
  }

  const existingMetrics = (activity.metrics as { caloriesBurned?: number; weightUsed?: number } | null) || {};
  // Toggle off → clear caloriesBurned so stats decrement immediately
  // Toggle on → set new burn estimate
  const newMetrics = newCompleted
    ? calories
      ? { ...existingMetrics, caloriesBurned: calories, weightUsed: weight }
      : existingMetrics
    : { ...existingMetrics, caloriesBurned: 0 };

  const updated = await prisma.activity.update({
    where: { id: activityId },
    data: {
      completed: newCompleted,
      metrics: newMetrics,
    },
  });

  // ---- Habit auto-sync ----
  // This slot IS a habit: the match was made once, when the plan was written, and
  // stored in Activity.habitId. Ticking it here therefore has to write the very
  // HabitCompletion row the habits screen reads, and un-ticking has to remove it —
  // otherwise the same act shows as done in one place and open in the other.
  //
  // Runs BEFORE the meal block on purpose: the custom-meal branch below returns early,
  // and a breakfast habit ticked with a custom meal must sync too.
  let habitSync: { habitId: string; habitCompleted: boolean } | null = null;
  if (activity.habitId) {
    try {
      const habit = await prisma.habit.findUnique({
        where: { id: activity.habitId },
        select: { id: true, userId: true },
      });
      // A habit could have been reassigned or deleted since the plan was generated.
      if (habit && habit.userId === session.user.id) {
        const habitDate = habitDateForLog(activity.dailyLog.date);
        if (newCompleted) {
          // Upsert on [habitId, date]: double taps update one row, they never duplicate.
          await prisma.habitCompletion.upsert({
            where: { habitId_date: { habitId: habit.id, date: habitDate } },
            update: { completed: true },
            create: {
              habitId: habit.id,
              userId: session.user.id,
              date: habitDate,
              completed: true,
            },
          });
          habitSync = { habitId: habit.id, habitCompleted: true };
        } else {
          // One habit can sit in the plan more than once ("Trening" matching both the
          // bag work and the gym block). Un-ticking one of them must not wipe the habit
          // while another copy is still ticked off, so the row only goes when nothing
          // is left standing.
          const stillDone = await prisma.activity.count({
            where: {
              habitId: habit.id,
              completed: true,
              id: { not: activity.id },
              dailyLog: { userId: session.user.id, date: activity.dailyLog.date },
            },
          });
          if (stillDone === 0) {
            // deleteMany, not delete: no row for that day is a normal state, not an error.
            await prisma.habitCompletion.deleteMany({
              where: { habitId: habit.id, date: habitDate },
            });
          }
          habitSync = { habitId: habit.id, habitCompleted: stillDone > 0 };
        }
      }
    } catch {
      // Never lose the activity toggle because the habit mirror failed.
      habitSync = null;
    }
  }

  let followUp = null;

  if (updated.completed && activity.lifeAreaId && FOLLOW_UP_TYPES.has(activity.type)) {
    const mentor = await prisma.mentor.findFirst({
      where: {
        userId: session.user.id,
        active: true,
        lifeAreas: { some: { id: activity.lifeAreaId } },
      },
      select: { id: true, name: true, avatarEmoji: true, role: true },
    });

    if (mentor) {
      followUp = {
        // activityId lets the client save the answer against this training
        // (POST /api/activities/follow-up) instead of throwing it away.
        activityId: activity.id,
        mentorId: mentor.id,
        mentorName: mentor.name,
        mentorEmoji: mentor.avatarEmoji,
        activityName: activity.name,
        prompt: `Swietnie, ze ukonczyles "${activity.name}"! Opowiedz mi jak poszlo — czas, intensywnosc, samopoczucie?`,
      };
    }
  }

  // ---- Meal auto-sync ----
  let mealAdded: {
    name: string;
    calories: number;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
  } | null = null;
  let mealRemoved: { name: string } | null = null;

  // Toggle OFF a meal-type activity → remove the auto-created meal entry
  if (!newCompleted) {
    try {
      const mealType = detectMealType(activity.name);
      if (mealType) {
        const dailyLogId = activity.dailyLog.id;
        const time = activity.scheduledAt || "";
        // Heuristic: a meal auto-created from this activity has matching
        // name + scheduledAt time. Manual user entries usually use current time.
        const autoMeal = await prisma.meal.findFirst({
          where: { dailyLogId, name: activity.name, time },
        });
        if (autoMeal) {
          await prisma.meal.delete({ where: { id: autoMeal.id } });
          mealRemoved = { name: autoMeal.name };
        }
      }
    } catch {
      // Don't break toggle on meal removal errors
    }
  }

  if (newCompleted) {
    try {
      const mealType = detectMealType(activity.name);
      if (mealType) {
        const dailyLogId = activity.dailyLog.id;
        const time = activity.scheduledAt || "";

        // Branch: user provided their own custom meal (ate something different).
        // Skip the auto-estimate-from-notes path and use user-provided data.
        if (customMeal && typeof customMeal === "object") {
          const customName = (customMeal.name || activity.name).trim() || activity.name;
          const customCalories = Math.max(0, Math.round(Number(customMeal.calories) || 0));
          const customProtein =
            customMeal.protein != null && !Number.isNaN(Number(customMeal.protein))
              ? Math.max(0, Number(customMeal.protein))
              : null;
          const customCarbs =
            customMeal.carbs != null && !Number.isNaN(Number(customMeal.carbs))
              ? Math.max(0, Number(customMeal.carbs))
              : null;
          const customFat =
            customMeal.fat != null && !Number.isNaN(Number(customMeal.fat))
              ? Math.max(0, Number(customMeal.fat))
              : null;
          const customDescription = customMeal.description?.trim() || null;

          // Remove any prior auto-meal for this slot (dedup heuristic: same time)
          const priorAutoMeal = await prisma.meal.findFirst({
            where: { dailyLogId, name: activity.name, time },
          });
          if (priorAutoMeal) {
            await prisma.meal.delete({ where: { id: priorAutoMeal.id } });
          }

          const newMeal = await prisma.meal.create({
            data: {
              dailyLogId,
              time,
              name: customName,
              calories: customCalories,
              protein: customProtein,
              carbs: customCarbs,
              fat: customFat,
              description: customDescription,
            },
          });
          mealAdded = {
            name: newMeal.name,
            calories: newMeal.calories ?? 0,
            protein: newMeal.protein,
            carbs: newMeal.carbs,
            fat: newMeal.fat,
          };
          return NextResponse.json({
            activity: updated,
            followUp,
            mealAdded,
            mealRemoved,
            habitId: habitSync?.habitId ?? null,
            habitCompleted: habitSync?.habitCompleted ?? null,
          });
        }

        const notes = activity.notes?.trim() ?? "";
        const hasNotes = notes.length > 3;

        const existingMeal = await prisma.meal.findFirst({
          where: { dailyLogId, name: activity.name },
        });

        let estimated: {
          calories: number;
          protein: number;
          carbs: number;
          fat: number;
        } | null = null;

        if (hasNotes) {
          try {
            const result = await estimateMacros(notes);
            estimated = {
              calories: result.calories,
              protein: result.protein,
              carbs: result.carbs,
              fat: result.fat,
            };
          } catch {
            estimated = null;
          }
        }

        if (existingMeal) {
          // Re-estimate only if existing has 0 calories and we now have notes
          if (estimated && (existingMeal.calories ?? 0) === 0) {
            const updatedMeal = await prisma.meal.update({
              where: { id: existingMeal.id },
              data: {
                calories: estimated.calories,
                protein: estimated.protein,
                carbs: estimated.carbs,
                fat: estimated.fat,
                description: notes,
              },
            });
            mealAdded = {
              name: updatedMeal.name,
              calories: updatedMeal.calories ?? 0,
              protein: updatedMeal.protein,
              carbs: updatedMeal.carbs,
              fat: updatedMeal.fat,
            };
          }
        } else {
          const newMeal = await prisma.meal.create({
            data: {
              dailyLogId,
              time,
              name: activity.name,
              calories: estimated?.calories ?? 0,
              protein: estimated?.protein ?? null,
              carbs: estimated?.carbs ?? null,
              fat: estimated?.fat ?? null,
              description: hasNotes ? notes : null,
            },
          });
          mealAdded = {
            name: newMeal.name,
            calories: newMeal.calories ?? 0,
            protein: newMeal.protein,
            carbs: newMeal.carbs,
            fat: newMeal.fat,
          };
        }
      }
    } catch {
      // Don't break toggle on meal sync errors
      mealAdded = null;
    }
  }

  // ---- Plan task auto-sync ----
  // If activity was scheduled from a mentor plan task, mark the matching
  // plan task as done/undone to keep goal progress in sync.
  //
  // Primary match: stable IDs (Activity.sourcePlanId + sourceTaskIndex), written
  // by /api/mentor-plans/schedule-task. Renaming a task no longer breaks progress.
  // Fallback: the old title match, for rows created before those columns existed.
  let planTaskUpdated: {
    goalProgress: number;
    mentorName: string;
    goalId: string | null;
    goalStatus: string | null;
    // True only on the tick that pushes progress to 100 on a still-active goal.
    // The UI may offer "zamknij cel"; the goal itself stays open until the user says so.
    goalReadyToClose: boolean;
  } | null = null;
  const hasSourceIds =
    typeof activity.sourcePlanId === "string" && typeof activity.sourceTaskIndex === "number";
  if (hasSourceIds || (activity.notes && activity.notes.includes("Z planu mentora"))) {
    try {
      interface PlanTaskJSON {
        title: string;
        description?: string;
        frequency?: string;
        done?: boolean;
      }
      type PlanMatch = {
        planId: string;
        mentorId: string;
        mentorName: string;
        goalId: string | null;
        taskIndex: number;
        tasks: PlanTaskJSON[];
      };

      const matches: PlanMatch[] = [];

      if (hasSourceIds) {
        const plan = await prisma.mentorPlan.findUnique({
          where: { id: activity.sourcePlanId as string },
          include: { mentor: { select: { id: true, name: true } } },
        });
        const idx = activity.sourceTaskIndex as number;
        if (plan && plan.userId === session.user.id) {
          const ts = Array.isArray(plan.tasks) ? (plan.tasks as unknown as PlanTaskJSON[]) : [];
          if (idx >= 0 && idx < ts.length) {
            matches.push({
              planId: plan.id,
              mentorId: plan.mentorId,
              mentorName: plan.mentor.name,
              goalId: plan.goalId,
              taskIndex: idx,
              tasks: ts,
            });
          }
        }
      }

      // Legacy fallback — only when no ID match was found.
      if (matches.length === 0) {
        const userPlans = await prisma.mentorPlan.findMany({
          where: { userId: session.user.id },
          include: { mentor: { select: { id: true, name: true } } },
        });

        for (const p of userPlans) {
          const ts = Array.isArray(p.tasks) ? (p.tasks as unknown as PlanTaskJSON[]) : [];
          for (let i = 0; i < ts.length; i++) {
            if (ts[i].title === activity.name) {
              matches.push({
                planId: p.id,
                mentorId: p.mentorId,
                mentorName: p.mentor.name,
                goalId: p.goalId,
                taskIndex: i,
                tasks: ts,
              });
            }
          }
        }
      }

      // Only sync when match is unambiguous
      if (matches.length === 1) {
        const m = matches[0];
        const newTasks = m.tasks.map((t, i) =>
          i === m.taskIndex ? { ...t, done: newCompleted } : t
        );
        await prisma.mentorPlan.update({
          where: { id: m.planId },
          data: { tasks: newTasks as unknown as object },
        });

        // Goal-scoped progress (modern plans) or mentor-wide (legacy)
        const allPlans = m.goalId
          ? await prisma.mentorPlan.findMany({
              where: { goalId: m.goalId, userId: session.user.id },
            })
          : await prisma.mentorPlan.findMany({
              where: {
                mentorId: m.mentorId,
                userId: session.user.id,
                goalId: null,
              },
            });
        let totalTasks = 0;
        let doneTasks = 0;
        for (const p of allPlans) {
          const ts =
            p.id === m.planId
              ? (newTasks as PlanTaskJSON[])
              : Array.isArray(p.tasks)
              ? (p.tasks as unknown as PlanTaskJSON[])
              : [];
          totalTasks += ts.length;
          doneTasks += ts.filter((t) => t.done).length;
        }
        const goalProgress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

        const goal = m.goalId
          ? await prisma.goal.findFirst({
              where: { id: m.goalId, userId: session.user.id },
            })
          : await prisma.goal.findFirst({
              where: {
                userId: session.user.id,
                mentorId: m.mentorId,
                status: "active",
              },
            });
        // Progress only. Completing an activity must never close the goal.
        //
        // Closing a goal is the user's own decision, taken with the "Cel osiągnięty"
        // button on the goals screen (PATCH /api/goals, which also stamps achievedAt
        // and stores the one-line outcome). A closed goal drops out of every mentor
        // prompt and out of the day plan, because src/lib/ai/user-context.ts and the
        // plan generator filter strictly on status === "active". Auto-closing here
        // meant that ticking off one training silently deleted the goal from the AI,
        // and un-ticking it did not restore it.
        if (goal) {
          await prisma.goal.update({
            where: { id: goal.id },
            data: { progress: goalProgress },
          });
        }

        // Advisory flag for the UI, nothing is written because of it: progress has
        // just crossed into 100 on a goal that is still open. `goal.progress` still
        // holds the pre-update value, so this fires on the transition only.
        const goalReadyToClose =
          !!goal && goalProgress === 100 && goal.progress < 100 && goal.status === "active";

        planTaskUpdated = {
          goalProgress,
          mentorName: m.mentorName,
          goalId: goal?.id ?? null,
          // Returned so the client never has to infer the status from the percentage.
          goalStatus: goal?.status ?? null,
          goalReadyToClose,
        };
      }
    } catch {
      // Don't break toggle if plan sync fails
    }
  }

  return NextResponse.json({
    activity: updated,
    followUp,
    mealAdded,
    mealRemoved,
    planTaskUpdated,
    // Null when this activity is not a habit. The habits screen uses these two to
    // agree with the plan without refetching everything.
    habitId: habitSync?.habitId ?? null,
    habitCompleted: habitSync?.habitCompleted ?? null,
  });
}
