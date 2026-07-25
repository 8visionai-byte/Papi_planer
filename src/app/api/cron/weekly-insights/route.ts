/**
 * Sunday-evening cron: refreshes the long-term memory of every user.
 *
 * For each user, in order:
 *  1. summary of the ISO week that just ended  -> UserInsight kind "weekly_summary"
 *  2. behavioural patterns over 28 days        -> UserInsight kind "pattern"
 *  3. preferences over 60 days                 -> UserInsight kind "preference"
 *  4. retire insights older than 90 days       -> active = false
 *
 * Steps 2 and 3 deactivate the previous batch of the same kind before writing the
 * new one, so "zastapione nowszymi tego samego kind" is handled inside the
 * generator, not here. Nothing is ever hard-deleted.
 *
 * Auth mirrors src/app/api/cron/daily-plan/route.ts: `Authorization: Bearer $CRON_SECRET`.
 *
 * Schedule (documented in STATUS.md):
 *   curl -X POST https://app.papishop.pl/api/cron/weekly-insights \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *   cron: 0 21 * * 0   (Sunday 21:00)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  generateWeeklySummary,
  detectPatterns,
  inferPreferences,
  deactivateStaleInsights,
  previousIsoWeekLabel,
} from "@/lib/ai/insight-generator";

/** Three model calls per user; the loop is sequential, so give it room. */
export const maxDuration = 300;

/** Insights older than this are retired on every run. */
const MAX_INSIGHT_AGE_DAYS = 90;

interface UserResult {
  userId: string;
  weeklySummary: "created" | "skipped" | "error";
  patterns: number;
  preferences: number;
  deactivated: number;
  error?: string;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional override, so a failed Sunday can be re-run for a specific week:
  // { "isoWeek": "2026-W30" }
  let isoWeek: string | undefined;
  try {
    const body = await req.json();
    if (body && typeof body.isoWeek === "string") isoWeek = body.isoWeek;
  } catch {
    // no body is the normal case for a cron ping
  }
  const period = isoWeek ?? previousIsoWeekLabel();

  const users = await prisma.user.findMany({ select: { id: true } });
  const results: UserResult[] = [];

  for (const user of users) {
    const result: UserResult = {
      userId: user.id,
      weeklySummary: "skipped",
      patterns: 0,
      preferences: 0,
      deactivated: 0,
    };

    try {
      const summary = await generateWeeklySummary(user.id, period);
      result.weeklySummary = summary ? "created" : "skipped";
    } catch (err) {
      result.weeklySummary = "error";
      result.error = err instanceof Error ? err.message : "unknown";
    }

    // Patterns and preferences are independent of the summary: one failing must
    // not cost the user the other two.
    try {
      result.patterns = (await detectPatterns(user.id)).length;
    } catch (err) {
      result.error = `${result.error ?? ""} patterns: ${err instanceof Error ? err.message : "unknown"}`.trim();
    }

    try {
      result.preferences = (await inferPreferences(user.id)).length;
    } catch (err) {
      result.error = `${result.error ?? ""} preferences: ${err instanceof Error ? err.message : "unknown"}`.trim();
    }

    try {
      result.deactivated = await deactivateStaleInsights(user.id, MAX_INSIGHT_AGE_DAYS);
    } catch (err) {
      result.error = `${result.error ?? ""} cleanup: ${err instanceof Error ? err.message : "unknown"}`.trim();
    }

    results.push(result);
  }

  return NextResponse.json({
    period,
    users: users.length,
    maxInsightAgeDays: MAX_INSIGHT_AGE_DAYS,
    results,
  });
}
