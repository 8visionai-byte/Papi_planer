import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { anthropic, MODELS, DEFAULTS } from "@/lib/ai/claude";
import { buildUserContext } from "@/lib/ai/user-context";
import { startOfDay, format } from "date-fns";
import { pl } from "date-fns/locale";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const results: { userId: string; status: string }[] = [];

  for (const user of users) {
    try {
      const result = await generateDailyPlan(user.id, user.name ?? "");
      results.push({ userId: user.id, status: result });
    } catch (err) {
      results.push({
        userId: user.id,
        status: `error: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  return NextResponse.json({ results });
}

async function generateDailyPlan(userId: string, userName: string): Promise<string> {
  const today = startOfDay(new Date());
  const dayOfWeek = new Date().getDay();

  const existing = await prisma.dailyLog.findUnique({
    where: { userId_date: { userId, date: today } },
  });
  if (existing) return "already_exists";

  // Context source: src/lib/ai/user-context.ts (scope "day-plan").
  // Replaces the profile JSON dump + hand-rolled goals/plans/recent-days blocks
  // that used to live in this file — the 5th copy of the user context.
  const [userCtx, schedule, goals] = await Promise.all([
    buildUserContext(userId, { scope: "day-plan" }),
    prisma.schedule.findMany({
      where: { userId, dayOfWeek },
      orderBy: { time: "asc" },
      include: { lifeArea: { select: { name: true } } },
    }),
    prisma.goal.findMany({
      where: { userId, status: "active" },
      select: {
        title: true,
        description: true,
        milestones: { select: { title: true, completed: true } },
      },
    }),
  ]);

  const todayStr = format(today, "EEEE, d MMMM yyyy", { locale: pl });
  const dayTypes = ["niedziela", "poniedzialek", "wtorek", "sroda", "czwartek", "piatek", "sobota"];

  const contextParts: string[] = [];
  contextParts.push(`# Plan dnia: ${todayStr} (${dayTypes[dayOfWeek]})`);
  contextParts.push(`Uzytkownik: ${userName}`);
  contextParts.push(`\n${userCtx.text}`);

  if (schedule.length > 0) {
    const scheduleStr = schedule
      .map((s) => `- ${s.time} ${s.activityName}${s.lifeArea ? ` [${s.lifeArea.name}]` : ""}${s.notes ? ` — ${s.notes}` : ""}`)
      .join("\n");
    contextParts.push(`\n## Staly harmonogram na ${dayTypes[dayOfWeek]}\n${scheduleStr}`);
  }

  // Goal descriptions + milestones — the only goal detail the shared context omits.
  if (goals.length > 0) {
    const goalsStr = goals
      .map((g) => {
        const done = g.milestones.filter((m) => m.completed).length;
        const desc = g.description?.trim() ? ` — ${g.description.trim()}` : "";
        return `- ${g.title} (${done}/${g.milestones.length} kamieni milowych)${desc}`;
      })
      .join("\n");
    contextParts.push(`\n## Aktywne cele — opisy\n${goalsStr}`);
  }

  const systemPrompt = `Jestes plannerem dnia dla systemu transformacji osobistej. Na podstawie danych wygeneruj optymalny plan dnia.

ZASADY:
- Uzyj stalego harmonogramu jako bazy
- Dodaj aktywnosci wspierajace aktywne cele
- Uwzglednij plany mentorow
- Dostosuj intensywnosc do ostatnich wynikow energii
- Kazda aktywnosc musi miec: name, type, scheduledAt (HH:MM), durationMin, notes (krotka instrukcja)
- type moze byc: training, exercise, study, work, health, mindset, nutrition, rest, scheduled
- Sortuj po godzinie

Odpowiedz TYLKO jako JSON array:
[{"name":"...","type":"...","scheduledAt":"HH:MM","durationMin":30,"notes":"...","lifeAreaHint":"..."}]`;

  const response = await anthropic.messages.create({
    model: MODELS.CHAT,
    max_tokens: DEFAULTS.BRIEFING_MAX_TOKENS,
    temperature: DEFAULTS.ANALYSIS_TEMPERATURE,
    system: systemPrompt,
    messages: [{ role: "user", content: contextParts.join("\n") }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return "no_response";

  let activities: {
    name: string;
    type: string;
    scheduledAt: string;
    durationMin: number;
    notes?: string;
  }[];

  try {
    const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return "no_json";
    activities = JSON.parse(jsonMatch[0]);
  } catch {
    return "parse_error";
  }

  const lifeAreas = await prisma.lifeArea.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const areaMap = new Map(lifeAreas.map((a) => [a.name.toLowerCase(), a.id]));

  await prisma.dailyLog.create({
    data: {
      userId,
      date: today,
      activities: {
        create: activities.map((act) => {
          const lifeAreaId =
            areaMap.get((act as { lifeAreaHint?: string }).lifeAreaHint?.toLowerCase() ?? "") ?? null;
          return {
            name: act.name,
            type: act.type || "scheduled",
            scheduledAt: act.scheduledAt,
            durationMin: act.durationMin || null,
            notes: act.notes || null,
            completed: false,
            lifeAreaId,
          };
        }),
      },
    },
  });

  return "created";
}
