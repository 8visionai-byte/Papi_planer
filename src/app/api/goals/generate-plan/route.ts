import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import {
  generateClarifyingQuestions,
  generatePlanFromAnswers,
} from "@/lib/ai/mentor-plan-generator";

export const maxDuration = 300;

type AnswerInput = { question?: unknown; answer?: unknown };

type RequestBody = {
  goalId?: string;
  mentorId?: string;
  mentorIds?: unknown;
  answers?: AnswerInput[];
};

function normalizeMentorIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = raw
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((s) => s.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out.length > 0 ? out : undefined;
}

function normalizeAnswers(
  raw: AnswerInput[] | undefined
): Array<{ question: string; answer: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((a) => {
      if (!a || typeof a !== "object") return null;
      const q = typeof a.question === "string" ? a.question.trim() : "";
      const ans = typeof a.answer === "string" ? a.answer.trim() : "";
      if (!q) return null;
      return { question: q, answer: ans };
    })
    .filter((a): a is { question: string; answer: string } => a !== null);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const goalId = typeof body.goalId === "string" ? body.goalId.trim() : "";
  if (!goalId) {
    return NextResponse.json({ error: "goalId jest wymagany" }, { status: 400 });
  }

  const userId = session.user.id;

  const goal = await prisma.goal.findFirst({
    where: { id: goalId, userId },
    select: { id: true, mentorIds: true, mentorId: true },
  });

  if (!goal) {
    return NextResponse.json({ error: "Nie znaleziono celu" }, { status: 404 });
  }

  // Prefer mentorIds from goal. Caller may override with explicit list (legacy clients).
  const overrideIds = normalizeMentorIds(body.mentorIds);
  const goalMentorIds = (goal.mentorIds && goal.mentorIds.length > 0)
    ? goal.mentorIds
    : (goal.mentorId ? [goal.mentorId] : []);
  const effectiveMentorIds: string[] = overrideIds ?? goalMentorIds;

  if (effectiveMentorIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "Brak wybranych mentorów. Edytuj cel i zaznacz co najmniej jednego mentora.",
      },
      { status: 400 }
    );
  }

  const mentorId = typeof body.mentorId === "string" ? body.mentorId.trim() : "";
  const hasAnswers = Array.isArray(body.answers);

  // ----------------------------------------------------------------
  // Stage 2 — plan generation from answers
  // ----------------------------------------------------------------
  if (mentorId && hasAnswers) {
    const answers = normalizeAnswers(body.answers);

    console.log(
      `[goals/generate-plan] stage=plan goalId=${goalId} userId=${userId} mentorId=${mentorId} mentorIds=${effectiveMentorIds.join(",")} answersCount=${answers.length}`
    );
    const startTime = Date.now();
    try {
      const result = await generatePlanFromAnswers(
        goalId,
        userId,
        mentorId,
        answers,
        effectiveMentorIds
      );
      const elapsed = Date.now() - startTime;
      if (!result) {
        console.log(
          `[goals/generate-plan] stage=plan no result after ${elapsed}ms — mentor returned null JSON`
        );
        return NextResponse.json(
          {
            error:
              "Mentor nie zwrócił poprawnego planu. Spróbuj ponownie lub sprawdź mentora w admin/Mentorzy.",
          },
          { status: 400 }
        );
      }
      console.log(
        `[goals/generate-plan] stage=plan success in ${elapsed}ms: ${result.plans.length} weeks for mentor ${result.mentorId}`
      );
      return NextResponse.json({
        stage: "plan",
        success: true,
        planCount: result.plans.length,
        mentorId: result.mentorId,
      });
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.error(`[goals/generate-plan] stage=plan failed after ${elapsed}ms`, err);
      const message =
        err instanceof Error ? err.message : "Nie udało się wygenerować planu";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // ----------------------------------------------------------------
  // Stage 1 — clarifying questions
  // ----------------------------------------------------------------
  console.log(
    `[goals/generate-plan] stage=questions goalId=${goalId} userId=${userId} mentorIds=${effectiveMentorIds.join(",")}`
  );
  const startTime = Date.now();
  try {
    const result = await generateClarifyingQuestions(
      goalId,
      userId,
      effectiveMentorIds
    );
    const elapsed = Date.now() - startTime;
    if (!result) {
      console.log(
        `[goals/generate-plan] stage=questions no result after ${elapsed}ms — no active mentors or parse failed`
      );
      return NextResponse.json(
        {
          error:
            "Brak aktywnych mentorów lub mentor nie zwrócił poprawnych pytań. Sprawdź admin/Mentorzy.",
        },
        { status: 400 }
      );
    }
    console.log(
      `[goals/generate-plan] stage=questions success in ${elapsed}ms: ${result.questions.length} questions from ${result.mentors.length} mentor(s)`
    );
    return NextResponse.json({
      stage: "questions",
      questions: result.questions,
      mentorId: result.mentorId,
      mentorName: result.mentorName,
      mentors: result.mentors,
    });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`[goals/generate-plan] stage=questions failed after ${elapsed}ms`, err);
    const message =
      err instanceof Error ? err.message : "Nie udało się pobrać pytań od mentora";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
