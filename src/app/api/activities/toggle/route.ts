import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import { estimateCalories } from "@/lib/ai/calorie-calculator";
import { estimateMacros } from "@/lib/ai/meal-estimator";

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
    include: { dailyLog: { select: { id: true, userId: true } } },
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
    const profile = await prisma.userProfile.findUnique({
      where: { userId: session.user.id },
    });
    const profileData = profile?.data as { weightKg?: number } | undefined;
    weight = profileData?.weightKg ?? 80;
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
          return NextResponse.json({ activity: updated, followUp, mealAdded, mealRemoved });
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
  let planTaskUpdated: { goalProgress: number; mentorName: string } | null = null;
  if (activity.notes && activity.notes.includes("Z planu mentora")) {
    try {
      interface PlanTaskJSON {
        title: string;
        description?: string;
        frequency?: string;
        done?: boolean;
      }
      const userPlans = await prisma.mentorPlan.findMany({
        where: { userId: session.user.id },
        include: { mentor: { select: { id: true, name: true } } },
      });

      const matches: Array<{
        planId: string;
        mentorId: string;
        mentorName: string;
        taskIndex: number;
        tasks: PlanTaskJSON[];
      }> = [];

      for (const p of userPlans) {
        const ts = Array.isArray(p.tasks) ? (p.tasks as unknown as PlanTaskJSON[]) : [];
        for (let i = 0; i < ts.length; i++) {
          if (ts[i].title === activity.name) {
            matches.push({
              planId: p.id,
              mentorId: p.mentorId,
              mentorName: p.mentor.name,
              taskIndex: i,
              tasks: ts,
            });
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

        const allPlans = await prisma.mentorPlan.findMany({
          where: { mentorId: m.mentorId, userId: session.user.id },
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

        const goal = await prisma.goal.findFirst({
          where: {
            userId: session.user.id,
            mentorId: m.mentorId,
            status: "active",
          },
        });
        if (goal) {
          await prisma.goal.update({
            where: { id: goal.id },
            data: {
              progress: goalProgress,
              ...(goalProgress === 100 ? { status: "completed" } : {}),
            },
          });
        }

        planTaskUpdated = { goalProgress, mentorName: m.mentorName };
      }
    } catch {
      // Don't break toggle if plan sync fails
    }
  }

  return NextResponse.json({ activity: updated, followUp, mealAdded, mealRemoved, planTaskUpdated });
}
