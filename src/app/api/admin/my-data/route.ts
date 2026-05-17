import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth/config";
import { prisma } from "@/lib/db/prisma";
import {
  calculateBMR,
  calculateTDEE,
  calculateTargetCalories,
  getActivityFactor,
} from "@/lib/ai/bmr-calculator";

// ─── Typed biometric / goal field keys (kept on UserProfile.data) ───
const TYPED_KEYS = [
  "gender",
  "age",
  "heightCm",
  "weightKg",
  "bodyFatPct",
  "activityLevel",
  "goal",
  "weeklyTargetKg",
  "targetCalories",
] as const;

type TypedKey = (typeof TYPED_KEYS)[number];

const GENDER_VALUES = ["male", "female"] as const;
const ACTIVITY_VALUES = ["sedentary", "light", "moderate", "high", "very_high"] as const;
const GOAL_VALUES = ["cut", "maintain", "bulk"] as const;

const ACTIVITY_LABELS_PL: Record<string, string> = {
  sedentary: "Siedzący",
  light: "Lekka",
  moderate: "Średnia",
  high: "Duża",
  very_high: "Bardzo duża",
};

const GOAL_LABELS_PL: Record<string, string> = {
  cut: "Redukcja",
  maintain: "Utrzymanie",
  bulk: "Masa",
};

const GENDER_LABELS_PL: Record<string, string> = {
  male: "Mężczyzna",
  female: "Kobieta",
};

// ─── Field labels for Markdown export (Polish) ───
const FIELD_LABELS: Record<string, string> = {
  // Typed (biometric)
  gender: "Płeć",
  age: "Wiek",
  heightCm: "Wzrost (cm)",
  weightKg: "Waga (kg)",
  bodyFatPct: "Tkanka tłuszczowa (%)",
  activityLevel: "Poziom aktywności",
  goal: "Cel",
  weeklyTargetKg: "Tempo (kg/tydzień)",
  targetCalories: "Limit kalorii (override)",
  // Legacy / free-form
  bodyFat: "Tkanka tłuszczowa (%)",
  height: "Wzrost (cm)",
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

function formatTypedValue(key: TypedKey, v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (key === "gender" && typeof v === "string") return GENDER_LABELS_PL[v] || v;
  if (key === "activityLevel" && typeof v === "string") return ACTIVITY_LABELS_PL[v] || v;
  if (key === "goal" && typeof v === "string") return GOAL_LABELS_PL[v] || v;
  if (key === "age" && typeof v === "number") return `${v} lat`;
  if (key === "heightCm" && typeof v === "number") return `${v} cm`;
  if (key === "weightKg" && typeof v === "number") return `${v} kg`;
  if (key === "bodyFatPct" && typeof v === "number") return `${v}%`;
  if (key === "weeklyTargetKg" && typeof v === "number") return `${v} kg/tydz.`;
  if (key === "targetCalories" && typeof v === "number") return `${v} kcal`;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

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

interface ComputedMetrics {
  bmr: number | null;
  tdee: number | null;
  targetCalories: number | null;
  activityFactor: number | null;
}

function hasMinimumBmrData(data: Record<string, unknown>): boolean {
  return (
    typeof data.gender === "string" &&
    typeof data.age === "number" &&
    typeof data.heightCm === "number" &&
    typeof data.weightKg === "number"
  );
}

function computeMetrics(data: Record<string, unknown>): ComputedMetrics {
  if (!hasMinimumBmrData(data)) {
    return { bmr: null, tdee: null, targetCalories: null, activityFactor: null };
  }
  const bmr = calculateBMR({
    weightKg: data.weightKg as number,
    heightCm: data.heightCm as number,
    age: data.age as number,
    gender: data.gender as string,
  });
  const activityLevel = typeof data.activityLevel === "string" ? data.activityLevel : undefined;
  const activityFactor = getActivityFactor(activityLevel);
  const tdee = calculateTDEE(bmr, activityLevel);

  let targetCalories: number;
  if (typeof data.targetCalories === "number" && data.targetCalories > 0) {
    targetCalories = data.targetCalories;
  } else {
    const goal = typeof data.goal === "string" ? data.goal : "maintain";
    const weeklyTargetKg =
      typeof data.weeklyTargetKg === "number" ? data.weeklyTargetKg : undefined;
    targetCalories = calculateTargetCalories(tdee, goal, weeklyTargetKg);
  }

  return { bmr, tdee, targetCalories, activityFactor };
}

function buildMarkdown(
  data: Record<string, unknown>,
  user: { name: string | null; email: string },
  metrics: ComputedMetrics
): string {
  const lines: string[] = [];
  lines.push(`# Profil użytkownika`);
  lines.push("");
  lines.push(`**Imię:** ${user.name || "—"}`);
  lines.push(`**Email:** ${user.email}`);
  lines.push("");

  const usedKeys = new Set<string>();

  // Biometric section (typed)
  const biometricLines: string[] = [];
  for (const k of TYPED_KEYS) {
    if (k in data && data[k] !== null && data[k] !== undefined && data[k] !== "") {
      const formatted = formatTypedValue(k, data[k]);
      if (formatted) {
        biometricLines.push(`- **${fieldLabel(k)}:** ${formatted}`);
        usedKeys.add(k);
      }
    }
  }
  if (metrics.bmr !== null) {
    biometricLines.push(`- **BMR:** ${metrics.bmr} kcal/dzień`);
  }
  if (metrics.tdee !== null) {
    biometricLines.push(`- **TDEE:** ${metrics.tdee} kcal/dzień`);
  }
  if (metrics.targetCalories !== null) {
    biometricLines.push(`- **Cel kaloryczny:** ${metrics.targetCalories} kcal/dzień`);
  }

  if (biometricLines.length > 0) {
    lines.push(`## Dane biometryczne`);
    lines.push("");
    lines.push(...biometricLines);
    lines.push("");
  }

  // Other sections (free-form)
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
  const metrics = computeMetrics(data);
  const markdown = buildMarkdown(data, userInfo, metrics);

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
    metrics,
    markdown,
  };
}

// ─── Validation for typed fields ───

interface ValidationError {
  key: string;
  message: string;
}

const NUMERIC_RANGES: Record<string, { min: number; max: number; label: string }> = {
  age: { min: 10, max: 100, label: "Wiek" },
  heightCm: { min: 100, max: 250, label: "Wzrost" },
  weightKg: { min: 30, max: 250, label: "Waga" },
  bodyFatPct: { min: 5, max: 50, label: "Tkanka tłuszczowa" },
  weeklyTargetKg: { min: 0, max: 2, label: "Tempo (kg/tydzień)" },
  targetCalories: { min: 800, max: 8000, label: "Limit kalorii" },
};

/**
 * Validate + coerce typed fields in place.
 * Returns errors (empty array = valid). Mutates `out` to convert numeric strings → numbers,
 * drop empty strings / null values for typed keys, and reject out-of-range / invalid enums.
 */
function validateAndCoerceTyped(
  out: Record<string, unknown>
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Gender
  if ("gender" in out) {
    const v = out.gender;
    if (v === "" || v === null || v === undefined) {
      delete out.gender;
    } else if (typeof v !== "string" || !GENDER_VALUES.includes(v as (typeof GENDER_VALUES)[number])) {
      errors.push({ key: "gender", message: "Płeć: dozwolone wartości to 'male' lub 'female'" });
    }
  }

  // Activity level
  if ("activityLevel" in out) {
    const v = out.activityLevel;
    if (v === "" || v === null || v === undefined) {
      delete out.activityLevel;
    } else if (
      typeof v !== "string" ||
      !ACTIVITY_VALUES.includes(v as (typeof ACTIVITY_VALUES)[number])
    ) {
      errors.push({
        key: "activityLevel",
        message: "Poziom aktywności: nieprawidłowa wartość",
      });
    }
  }

  // Goal
  if ("goal" in out) {
    const v = out.goal;
    if (v === "" || v === null || v === undefined) {
      delete out.goal;
    } else if (typeof v !== "string" || !GOAL_VALUES.includes(v as (typeof GOAL_VALUES)[number])) {
      errors.push({ key: "goal", message: "Cel: dozwolone wartości to 'cut', 'maintain' lub 'bulk'" });
    }
  }

  // Numeric fields
  for (const [key, range] of Object.entries(NUMERIC_RANGES)) {
    if (!(key in out)) continue;
    const v = out[key];
    if (v === "" || v === null || v === undefined) {
      delete out[key];
      continue;
    }
    let n: number;
    if (typeof v === "number") n = v;
    else if (typeof v === "string") {
      const parsed = parseFloat(v.replace(",", "."));
      if (!Number.isFinite(parsed)) {
        errors.push({ key, message: `${range.label}: musi być liczbą` });
        continue;
      }
      n = parsed;
    } else {
      errors.push({ key, message: `${range.label}: musi być liczbą` });
      continue;
    }
    if (n < range.min || n > range.max) {
      errors.push({
        key,
        message: `${range.label}: zakres ${range.min}–${range.max}`,
      });
      continue;
    }
    out[key] = n;
  }

  return errors;
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

  const incomingObj = { ...(incoming as Record<string, unknown>) };
  const errors = validateAndCoerceTyped(incomingObj);
  if (errors.length > 0) {
    return NextResponse.json(
      { error: errors.map((e) => e.message).join("; "), errors },
      { status: 400 }
    );
  }

  const existing = await prisma.userProfile.findUnique({ where: { userId: session.user.id } });
  const existingData =
    existing?.data && typeof existing.data === "object" && !Array.isArray(existing.data)
      ? (existing.data as Record<string, unknown>)
      : {};

  const merged = { ...existingData, ...incomingObj };
  // For typed keys: if incoming explicitly omitted them by sending an empty value
  // (handled above by validateAndCoerceTyped deleting them from incomingObj),
  // we preserve existing values. If they want to clear, they send undefined/empty + explicit removal —
  // out of scope here; spread merge keeps existing.
  const mergedJson = merged as Prisma.InputJsonValue;

  await prisma.userProfile.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, data: mergedJson },
    update: { data: mergedJson },
  });

  const payload = await getPayload(session.user.id);
  return NextResponse.json(payload);
}
