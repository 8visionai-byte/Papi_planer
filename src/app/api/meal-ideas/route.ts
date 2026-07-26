import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

/**
 * The user's meal library.
 *
 * GET  /api/meal-ideas?filter=all|favorite|liked
 * POST /api/meal-ideas   -> save one idea (own recipe, or an AI proposal the user just rated)
 *
 * POST is an UPSERT on the unique (userId, title) pair. That is deliberate: the
 * same dish gets proposed again weeks later, and the user rating it a second
 * time must land on the existing row instead of throwing a unique violation or
 * creating a twin. Counters (timesCooked / lastCookedAt) are never touched here,
 * only PATCH /api/meal-ideas/[id] moves them.
 */

type Filter = "all" | "favorite" | "liked";

const SOURCES = new Set(["ai", "web", "user"]);

function parseFilter(v: string | null): Filter {
  return v === "favorite" || v === "liked" ? v : "all";
}

/** Optional non-negative number, or null when absent / unusable. */
function optNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function optInt(v: unknown): number | null {
  const n = optNum(v);
  return n === null ? null : Math.round(n);
}

function strList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max);
}

function clampRating(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  if (n === 1) return 1;
  if (n === -1) return -1;
  return 0;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }
  const userId = session.user.id;

  const filter = parseFilter(new URL(req.url).searchParams.get("filter"));

  const where =
    filter === "favorite"
      ? { userId, favorite: true }
      : filter === "liked"
        ? { userId, OR: [{ rating: 1 }, { favorite: true }] }
        : { userId };

  try {
    const ideas = await prisma.mealIdea.findMany({
      where,
      orderBy: [{ favorite: "desc" }, { rating: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    return NextResponse.json({ ideas, filter });
  } catch (err) {
    console.error("[meal-ideas] GET failed", err);
    return NextResponse.json({ error: "Nie udało się wczytać pomysłów" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "Tytuł jest wymagany" }, { status: 400 });
  }

  const description = typeof body.description === "string" ? body.description.trim() : "";
  const ingredients = strList(body.ingredients, 20);
  const steps = strList(body.steps, 12);
  const tags = strList(body.tags, 8).map((t) => t.toLowerCase());
  const rawSource = typeof body.source === "string" ? body.source : "user";
  const source = SOURCES.has(rawSource) ? rawSource : "user";
  const sourceUrl = typeof body.sourceUrl === "string" && body.sourceUrl.trim()
    ? body.sourceUrl.trim()
    : null;
  const rating = clampRating(body.rating);
  const favorite = body.favorite === true;

  const shared = {
    description: description || null,
    ingredients: ingredients.length > 0 ? ingredients : undefined,
    steps: steps.length > 0 ? steps : undefined,
    prepMinutes: optInt(body.prepMinutes),
    calories: optInt(body.calories),
    protein: optNum(body.protein),
    carbs: optNum(body.carbs),
    fat: optNum(body.fat),
    tags,
    source,
    sourceUrl,
  };

  try {
    const idea = await prisma.mealIdea.upsert({
      where: { userId_title: { userId, title } },
      create: { userId, title, rating, favorite, ...shared },
      // Re-rating an old dish must not reset how many times it was cooked.
      update: { rating, favorite, ...shared },
    });
    return NextResponse.json({ idea });
  } catch (err) {
    console.error("[meal-ideas] POST failed", err);
    return NextResponse.json({ error: "Nie udało się zapisać pomysłu" }, { status: 500 });
  }
}
