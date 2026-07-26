import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { suggestMealIdeas } from "@/lib/ai/meal-ideas";

/**
 * POST /api/meal-ideas/suggest
 * Body: { mealType?: string, count?: number, useWeb?: boolean }
 *
 * Generates proposals and returns them WITHOUT saving. A row is only written
 * once the user rates or saves a card (POST /api/meal-ideas), so a tap on
 * "Podrzuc pomysly" never pollutes the library with dishes he did not want.
 */

// Measured on the live API: three ideas with web search took ~106 s. The other
// AI routes in this app (plan/generate, goals/generate-plan) also use 300.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine: all options have defaults.
  }

  const mealType = typeof body.mealType === "string" ? body.mealType.trim() : undefined;
  const rawCount = typeof body.count === "number" ? body.count : parseInt(String(body.count), 10);
  const count = Number.isFinite(rawCount) ? rawCount : undefined;
  const useWeb = body.useWeb === false ? false : true;

  try {
    const result = await suggestMealIdeas(userId, { mealType, count, useWeb });

    if (result.ideas.length === 0) {
      return NextResponse.json(
        { error: "Dietetyk nie zwrócił żadnej propozycji. Spróbuj jeszcze raz." },
        { status: 502 }
      );
    }

    // `webNote` stays server side on purpose: a failed search must never reach
    // the user as an error, the ideas simply come back without sources.
    if (result.webNote) {
      console.warn("[meal-ideas/suggest] web search note:", result.webNote);
    }

    return NextResponse.json({ ideas: result.ideas, usedWeb: result.usedWeb });
  } catch (err) {
    console.error("[meal-ideas/suggest] failed", err);
    return NextResponse.json(
      { error: "Nie udało się wygenerować pomysłów. Spróbuj za chwilę." },
      { status: 500 }
    );
  }
}
