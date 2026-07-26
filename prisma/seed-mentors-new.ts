// prisma/seed-mentors-new.ts
//
// Installs SELECTED mentors on a live database, without running the full seed.
//
// Why this file exists: `prisma/seed.ts` upserts every mentor, and its update payload
// includes `persona` and `systemPrompt`. The app lets the user rewrite both by hand, so
// running the whole seed just to pick up one new mentor would quietly reset every prompt
// they have tuned. This script touches only the ids it is given, and nothing else in the
// database: no life areas are created, no schedules are deleted, no profile is written.
//
// Usage (inside the container, from /app):
//   npx tsx prisma/seed-mentors-new.ts
//   npx tsx prisma/seed-mentors-new.ts seed-mentor-habits
//
// Default set: the July 2026 round (habit-change psychologist + the neurodidact rewritten
// to also teach languages and run the two courses).

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { MENTOR_DEFS, upsertMentor } from "./mentors";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const DEFAULT_IDS = ["seed-mentor-habits", "seed-mentor-neurodidact"];

async function main() {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_IDS;

  const user = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) {
    console.error("Brak uzytkownika w bazie. Najpierw zaloguj sie w aplikacji.");
    process.exit(1);
  }

  // Life areas are matched by NAME against what already exists. Nothing is created here:
  // a mentor with an unknown area simply gets no link, which is better than inventing
  // rows on a live database.
  const areaRows = await prisma.lifeArea.findMany({
    where: { userId: user.id },
    select: { id: true, name: true },
  });
  const areas: Record<string, string> = {};
  for (const a of areaRows) areas[a.name] = a.id;

  for (const id of ids) {
    const def = MENTOR_DEFS.find((m) => m.id === id);
    if (!def) {
      console.warn(`Pomijam ${id}: brak takiej definicji w seed.ts`);
      continue;
    }
    const before = await prisma.mentor.findUnique({ where: { id }, select: { id: true } });
    await upsertMentor(prisma, def, user.id, areas);
    console.log(`${before ? "Zaktualizowano" : "Dodano"}: ${def.name} (${def.role})`);
  }

  // Informational only. Removing a mentor is the user's decision and happens in the app.
  const strategist = await prisma.mentor.findFirst({
    where: { userId: user.id, OR: [{ name: { contains: "Content", mode: "insensitive" } }, { role: { contains: "strateg", mode: "insensitive" } }] },
    select: { name: true, active: true },
  });
  if (strategist) {
    console.log(
      `Uwaga: mentor "${strategist.name}" nadal istnieje (aktywny: ${strategist.active}). ` +
        "Seed go juz nie wskrzesza, mozesz go usunac w aplikacji: Mentorzy, zakladka Edytuj."
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
