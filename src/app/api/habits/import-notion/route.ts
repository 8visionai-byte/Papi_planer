import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

// Hardcoded list extracted from user's Notion export "Baza Nawyków" CSV.
// Pora Dania → timeOfDay mapping: Rano=morning, Południe/Popołudnie=afternoon, Wieczór=evening
const NOTION_HABITS: Array<{ name: string; timeOfDay: string }> = [
  { name: "Poranny Trening 15 min", timeOfDay: "morning" },
  { name: "Poranna Medytacja", timeOfDay: "morning" },
  { name: "Poranna Higiena - zęby, twarz", timeOfDay: "morning" },
  { name: "Wyjście na Świeże Powietrze", timeOfDay: "morning" },
  { name: "Wieczorna Medytacja", timeOfDay: "evening" },
  { name: "Wieczorna Higiena", timeOfDay: "evening" },
  { name: "Przerwy Pomodoro w pracy", timeOfDay: "afternoon" },
  { name: "Powolne Jedzenie (rano)", timeOfDay: "morning" },
  { name: "Powolne Jedzenie (popołudnie)", timeOfDay: "afternoon" },
  { name: "Nie jedz na noc — wszystko kiśnie", timeOfDay: "evening" },
  { name: "Trening 1h Sport", timeOfDay: "afternoon" },
  { name: "Nie jedz Cukru", timeOfDay: "afternoon" },
  { name: "Głodówka", timeOfDay: "morning" },
  { name: "Nauka Hiszpańskiego", timeOfDay: "afternoon" },
  { name: "Nauka Angielskiego", timeOfDay: "afternoon" },
  { name: "Zadzwoń Do Rodziców", timeOfDay: "afternoon" },
  { name: "Rozciąganie zamiast filmu", timeOfDay: "evening" },
  { name: "Zadania z Centrum Dowodzenia", timeOfDay: "afternoon" },
  { name: "Poniżej 2 Min Rób TO", timeOfDay: "morning" },
  { name: "Zasada 2 Minut (popołudnie)", timeOfDay: "afternoon" },
  { name: "Zasada 2 Minut (wieczór)", timeOfDay: "evening" },
  { name: "Architekci AI 15 Min", timeOfDay: "afternoon" },
  { name: "Ogranicz Youtube", timeOfDay: "afternoon" },
  { name: "Tabata 5 min", timeOfDay: "afternoon" },
  { name: "Sprzątaj Biuro 15 min", timeOfDay: "afternoon" },
  { name: "Spacer 30 min", timeOfDay: "afternoon" },
  { name: "Rozmawiaj na Stojąco", timeOfDay: "afternoon" },
  { name: "Zadania w Notion od SFAI", timeOfDay: "afternoon" },
];

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const existing = await prisma.habit.findMany({
    where: { userId },
    select: { name: true, timeOfDay: true },
  });
  const existingKeys = new Set(existing.map((h) => `${h.name}::${h.timeOfDay}`));

  let created = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (let i = 0; i < NOTION_HABITS.length; i++) {
    const h = NOTION_HABITS[i];
    const key = `${h.name}::${h.timeOfDay}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    try {
      await prisma.habit.create({
        data: {
          userId,
          name: h.name,
          timeOfDay: h.timeOfDay,
          active: true,
          sortOrder: i,
        },
      });
      created++;
    } catch (err) {
      failures.push(h.name);
      console.error(`[habits/import-notion] failed to create "${h.name}":`, err);
    }
  }

  return NextResponse.json({
    total: NOTION_HABITS.length,
    created,
    skipped,
    failures,
  });
}
