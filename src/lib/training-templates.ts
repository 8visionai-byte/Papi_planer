/**
 * Per-discipline TrainingLog templates.
 *
 * Templates drive the UI form fields for "Dodaj trening" — picked by matching
 * lifeArea name. Standard fields (sets/reps/weightKg/durationMin/distance/
 * exerciseName/notes/rating) map to TrainingLog columns. Extra fields are
 * packed into the metrics JSON column.
 */

export type FieldType = "text" | "number" | "select" | "list" | "duration";

export interface TemplateField {
  /**
   * Storage key. Standard keys (exerciseName, sets, reps, weightKg, durationMin,
   * distance, notes, rating) map to TrainingLog columns. All others go into metrics JSON.
   */
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  unit?: string;
  placeholder?: string;
  /** Min/max for number inputs */
  min?: number;
  max?: number;
  /** Step for number inputs */
  step?: number;
}

export interface TrainingTemplate {
  id: string;
  name: string;
  /** Field order is preserved in UI */
  fields: TemplateField[];
}

/** Keys that map to TrainingLog columns (NOT metrics JSON). */
export const STANDARD_KEYS = new Set([
  "exerciseName",
  "sets",
  "reps",
  "weightKg",
  "durationMin",
  "distance",
  "notes",
  "rating",
]);

/** Keys allowed inside metrics JSON. Server-side whitelist. */
export const METRICS_WHITELIST = new Set([
  "stroke",
  "poolLength",
  "splits",
  "type",
  "techniques",
  "rounds",
  "roundDurationMin",
  "pace",
  "avgHR",
  "route",
  "holdDurationSec",
  "extraWeightKg",
]);

const SWIMMING: TrainingTemplate = {
  id: "swimming",
  name: "Pływanie",
  fields: [
    {
      key: "stroke",
      label: "Styl",
      type: "select",
      options: ["Kraul", "Grzbiet", "Żabka", "Motylek", "Zmienny"],
      required: true,
    },
    {
      key: "distance",
      label: "Dystans",
      type: "number",
      unit: "m",
      placeholder: "np. 1500",
      min: 0,
      step: 25,
    },
    {
      key: "poolLength",
      label: "Basen",
      type: "select",
      options: ["25m", "50m"],
    },
    {
      key: "durationMin",
      label: "Czas",
      type: "number",
      unit: "min",
      min: 0,
    },
    {
      key: "splits",
      label: "Splity / interwały",
      type: "text",
      placeholder: "np. 4×100m po 1:45",
    },
    {
      key: "notes",
      label: "Notatki",
      type: "text",
      placeholder: "Wrażenia, technika...",
    },
    {
      key: "rating",
      label: "Ocena (1-5)",
      type: "number",
      min: 1,
      max: 5,
    },
  ],
};

const KARATE: TrainingTemplate = {
  id: "karate",
  name: "Karate",
  fields: [
    {
      key: "type",
      label: "Typ treningu",
      type: "select",
      options: ["Kata", "Kihon", "Kumite", "Worek", "Sprawnościówka", "Inne"],
      required: true,
    },
    {
      key: "durationMin",
      label: "Czas",
      type: "number",
      unit: "min",
      min: 0,
    },
    {
      key: "techniques",
      label: "Techniki",
      type: "text",
      placeholder: "np. oi-zuki, mae-geri, mawashi-geri",
    },
    {
      key: "rounds",
      label: "Rundy",
      type: "number",
      min: 0,
    },
    {
      key: "roundDurationMin",
      label: "Czas rundy",
      type: "number",
      unit: "min",
      min: 0,
    },
    {
      key: "notes",
      label: "Notatki",
      type: "text",
      placeholder: "Wrażenia, technika...",
    },
    {
      key: "rating",
      label: "Ocena (1-5)",
      type: "number",
      min: 1,
      max: 5,
    },
  ],
};

const GYM: TrainingTemplate = {
  id: "gym",
  name: "Siłownia",
  fields: [
    {
      key: "exerciseName",
      label: "Ćwiczenie",
      type: "text",
      required: true,
      placeholder: "np. Przysiad ze sztangą",
    },
    {
      key: "sets",
      label: "Serie",
      type: "number",
      min: 0,
    },
    {
      key: "reps",
      label: "Powtórzenia",
      type: "number",
      min: 0,
    },
    {
      key: "weightKg",
      label: "Ciężar",
      type: "number",
      unit: "kg",
      min: 0,
      step: 0.5,
    },
    {
      key: "notes",
      label: "Notatki",
      type: "text",
      placeholder: "Wrażenia, technika...",
    },
    {
      key: "rating",
      label: "Ocena (1-5)",
      type: "number",
      min: 1,
      max: 5,
    },
  ],
};

const CALISTHENICS: TrainingTemplate = {
  id: "calisthenics",
  name: "Kalistenika",
  fields: [
    {
      key: "exerciseName",
      label: "Ćwiczenie",
      type: "text",
      required: true,
      placeholder: "np. Podciąganie, plank, pompka",
    },
    {
      key: "sets",
      label: "Serie",
      type: "number",
      min: 0,
    },
    {
      key: "reps",
      label: "Powtórzenia",
      type: "number",
      min: 0,
    },
    {
      key: "holdDurationSec",
      label: "Czas trzymania",
      type: "number",
      unit: "s",
      min: 0,
    },
    {
      key: "extraWeightKg",
      label: "Dodatkowy ciężar",
      type: "number",
      unit: "kg",
      min: 0,
      step: 0.5,
    },
    {
      key: "notes",
      label: "Notatki",
      type: "text",
      placeholder: "Wrażenia, technika...",
    },
    {
      key: "rating",
      label: "Ocena (1-5)",
      type: "number",
      min: 1,
      max: 5,
    },
  ],
};

const RUNNING: TrainingTemplate = {
  id: "running",
  name: "Bieganie",
  fields: [
    {
      key: "distance",
      label: "Dystans",
      type: "number",
      unit: "km",
      min: 0,
      step: 0.1,
      required: true,
    },
    {
      key: "durationMin",
      label: "Czas",
      type: "number",
      unit: "min",
      min: 0,
    },
    {
      key: "pace",
      label: "Tempo",
      type: "text",
      placeholder: "min/km, np. 5:30",
    },
    {
      key: "avgHR",
      label: "Tętno śr.",
      type: "number",
      unit: "bpm",
      min: 0,
    },
    {
      key: "route",
      label: "Trasa",
      type: "text",
      placeholder: "np. park, pętla 5km",
    },
    {
      key: "notes",
      label: "Notatki",
      type: "text",
      placeholder: "Wrażenia...",
    },
    {
      key: "rating",
      label: "Ocena (1-5)",
      type: "number",
      min: 1,
      max: 5,
    },
  ],
};

const GENERIC: TrainingTemplate = {
  id: "generic",
  name: "Trening",
  fields: [
    {
      key: "exerciseName",
      label: "Ćwiczenie",
      type: "text",
      required: true,
      placeholder: "np. Trening",
    },
    {
      key: "sets",
      label: "Serie",
      type: "number",
      min: 0,
    },
    {
      key: "reps",
      label: "Powtórzenia",
      type: "number",
      min: 0,
    },
    {
      key: "weightKg",
      label: "Ciężar",
      type: "number",
      unit: "kg",
      min: 0,
      step: 0.5,
    },
    {
      key: "durationMin",
      label: "Czas",
      type: "number",
      unit: "min",
      min: 0,
    },
    {
      key: "distance",
      label: "Dystans",
      type: "number",
      unit: "km",
      min: 0,
      step: 0.1,
    },
    {
      key: "notes",
      label: "Notatki",
      type: "text",
      placeholder: "Wrażenia, technika...",
    },
    {
      key: "rating",
      label: "Ocena (1-5)",
      type: "number",
      min: 1,
      max: 5,
    },
  ],
};

export const TEMPLATES: Record<string, TrainingTemplate> = {
  swimming: SWIMMING,
  karate: KARATE,
  gym: GYM,
  calisthenics: CALISTHENICS,
  running: RUNNING,
  generic: GENERIC,
};

/**
 * Detect template from lifeArea name using case-insensitive substring matching.
 * Order matters — more specific terms first.
 */
export function getTemplateForLifeArea(lifeAreaName: string): TrainingTemplate {
  const n = (lifeAreaName || "").toLowerCase();

  if (n.includes("pływan") || n.includes("plywan") || n.includes("swimming") || n.includes("basen")) {
    return SWIMMING;
  }
  if (n.includes("karate") || n.includes("kyokushin")) {
    return KARATE;
  }
  if (n.includes("kalisten") || n.includes("calisthenics") || n.includes("street workout")) {
    return CALISTHENICS;
  }
  if (n.includes("siłown") || n.includes("silown") || n.includes("siłka") || n.includes("silka") || n.includes("gym")) {
    return GYM;
  }
  if (n.includes("bieg") || n.includes("running") || n.includes("run ")) {
    return RUNNING;
  }
  return GENERIC;
}

/**
 * Build a short display label for a single field (used in history list pills).
 * Returns null if no value.
 */
export function formatFieldDisplay(
  field: TemplateField,
  value: unknown
): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (field.type === "select" || field.type === "text") {
    return String(value);
  }
  if (field.type === "number") {
    const num = Number(value);
    if (!isFinite(num)) return null;
    return field.unit ? `${num} ${field.unit}` : String(num);
  }
  return String(value);
}

/**
 * Build inline summary pills for a log entry given its template.
 * Returns array of short strings like ["Kraul", "1500 m", "25m basen"].
 * Skips notes and rating (rendered separately).
 */
export function buildLogSummaryPills(
  template: TrainingTemplate,
  log: {
    exerciseName?: string | null;
    sets?: number | null;
    reps?: number | null;
    weightKg?: number | null;
    durationMin?: number | null;
    distance?: number | null;
    metrics?: Record<string, unknown> | null;
  }
): string[] {
  const pills: string[] = [];

  for (const field of template.fields) {
    if (field.key === "notes" || field.key === "rating" || field.key === "exerciseName") {
      continue;
    }

    let value: unknown;
    if (STANDARD_KEYS.has(field.key)) {
      value = (log as Record<string, unknown>)[field.key];
    } else {
      value = log.metrics?.[field.key];
    }

    const formatted = formatFieldDisplay(field, value);
    if (formatted) {
      // Compact composite for sets×reps in gym/calisthenics
      if (field.key === "sets" && log.reps != null) {
        // skip — reps will produce "Sx×R"
        continue;
      }
      if (field.key === "reps" && log.sets != null) {
        pills.push(`${log.sets}×${log.reps}`);
        continue;
      }
      pills.push(formatted);
    }
  }

  return pills;
}
