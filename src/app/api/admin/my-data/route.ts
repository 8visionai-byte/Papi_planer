import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";

// ─── Field labels for Markdown export (Polish) ───
const FIELD_LABELS: Record<string, string> = {
  weightKg: "Waga (kg)",
  heightCm: "Wzrost (cm)",
  height: "Wzrost (cm)",
  age: "Wiek",
  gender: "Płeć",
  bodyFat: "Tkanka tłuszczowa (%)",
  shortTermGoals: "Cele krótkoterminowe",
  longTermGoals: "Cele długoterminowe",
  medicalConditions: "Choroby / ograniczenia",
  injuries: "Kontuzje",
  allergies: "Alergie",
  medications: "Leki",
  trainingPreferences: "Preferencje treningowe",
  trainingFrequency: "Częstotliwość treningów",
  trainingExperience: "Doświadczenie treningowe",
  supplementation: "Suplementacja",
  diet: "Dieta",
  sleepHours: "Sen (godz./dobę)",
  experience: "Doświadczenie",
  notes: "Inne notatki",
  other: "Inne",
};

// ─── Section grouping for Markdown ───
const SECTIONS: { title: string; keys: string[] }[] = [
  {
    title: "Podstawowe dane",
    keys: ["weightKg", "heightCm", "height", "age", "gender", "bodyFat"],
  },
  { title: "Cele krótkoterminowe", keys: ["shortTermGoals"] },
  { title: "Cele długoterminowe", keys: ["longTermGoals"] },
  {
    title: "Choroby / ograniczenia",
    keys: ["medicalConditions", "injuries", "allergies", "medications"],
  },
  {
    title: "Preferencje treningowe",
    keys: ["trainingPreferences", "trainingFrequency"],
  },
  { title: "Suplementacja", keys: ["supplementation", "diet"] },
  {
    title: "Doświadczenie",
    keys: ["experience", "trainingExperience", "sleepHours"],
  },
  { title: "Inne notatki", keys: ["notes", "other"] },
];

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) {
    return v
      .map((item) => `- ${typeof item === "object" ? JSON.stringify(item) : String(item)}`)
      .join("\n");
  }
  if (typeof v === "object") {
    return "```json\n" + JSON.stringify(v, null, 2) + "\n```";
  }
  return String(v);
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] || key;
}

function buildMarkdown(
  data: Record<string, unknown>,
  user: { name: string | null; email: string }
): string {
  const lines: string[] = [];
  lines.push(`# Profil użytkownika`);
  lines.push("");
  lines.push(`**Imię:** ${user.name || "—"}`);
  lines.push(`**Email:** ${user.email}`);
  lines.push("");

  const usedKeys = new Set<string>();

  for (const section of SECTIONS) {
    const sectionValues: { key: string; value: unknown }[] = [];
    for (const k of section.keys) {
      if (k in data && data[k] !== null && data[k] !== undefined && data[k] !== "") {
        sectionValues.push({ key: k, value: data[k] });
        usedKeys.add(k);
      }
    }
    if (sectionValues.length === 0) continue;

    lines.push(`## ${section.title}`);
    lines.push("");
    for (const { key, value } of sectionValues) {
      const formatted = formatValue(value);
      if (formatted.includes("\n")) {
        lines.push(`**${fieldLabel(key)}:**`);
        lines.push(formatted);
      } else {
        lines.push(`- **${fieldLabel(key)}:** ${formatted}`);
      }
    }
    lines.push("");
  }

  // Any extra fields not in known sections
  const extraKeys = Object.keys(data).filter(
    (k) => !usedKeys.has(k) && data[k] !== null && data[k] !== undefined && data[k] !== ""
  );
  if (extraKeys.length > 0) {
    lines.push(`## Dodatkowe pola`);
    lines.push("");
    for (const k of extraKeys) {
      const formatted = formatValue(data[k]);
      if (formatted.includes("\n")) {
        lines.push(`**${fieldLabel(k)}:**`);
        lines.push(formatted);
      } else {
        lines.push(`- **${fieldLabel(k)}:** ${formatted}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

async function getPayload(userId: string) {
  const [user, profile, goalsCount, activitiesCount, trainingLogsCount, dailyLogsCount, briefingsCount] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      }),
      prisma.userProfile.findUnique({ where: { userId } }),
      prisma.goal.count({ where: { userId } }),
      prisma.activity.count({ where: { dailyLog: { userId } } }),
      prisma.trainingLog.count({ where: { userId } }),
      prisma.dailyLog.count({ where: { userId } }),
      prisma.briefing.count({ where: { userId } }),
    ]);

  const data =
    profile?.data && typeof profile.data === "object" && !Array.isArray(profile.data)
      ? (profile.data as Record<string, unknown>)
      : {};

  const userInfo = { name: user?.name || null, email: user?.email || "" };
  const markdown = buildMarkdown(data, userInfo);

  return {
    user: userInfo,
    data,
    counts: {
      goals: goalsCount,
      activities: activitiesCount,
      trainingLogs: trainingLogsCount,
      dailyLogs: dailyLogsCount,
      briefings: briefingsCount,
    },
    markdown,
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 403 });
  }

  const payload = await getPayload(session.user.id);
  return NextResponse.json(payload);
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Brak uprawnień" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const incoming = body?.data;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return NextResponse.json({ error: "Pole 'data' musi być obiektem" }, { status: 400 });
  }

  const existing = await prisma.userProfile.findUnique({ where: { userId: session.user.id } });
  const existingData =
    existing?.data && typeof existing.data === "object" && !Array.isArray(existing.data)
      ? (existing.data as Record<string, unknown>)
      : {};

  const merged = { ...existingData, ...(incoming as Record<string, unknown>) };
  const mergedJson = merged as Prisma.InputJsonValue;

  await prisma.userProfile.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, data: mergedJson },
    update: { data: mergedJson },
  });

  const payload = await getPayload(session.user.id);
  return NextResponse.json(payload);
}
