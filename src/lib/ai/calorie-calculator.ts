/**
 * Estymacja kalorii spalonych na podstawie typu aktywności, czasu trwania i wagi.
 * Wartości METs (Metabolic Equivalents) z Compendium of Physical Activities.
 * Wzór: kcal = METs * waga_kg * czas_h
 */

const METS_BY_TYPE: Record<string, number> = {
  // Wysoka intensywność
  training: 8,        // siłownia / trening obwodowy
  workout: 8,
  hiit: 12,
  crossfit: 12,

  // Sporty
  karate: 10,
  boxing: 12,
  martial_arts: 10,
  practice: 7,        // praktyka sportowa
  sport: 8,

  // Cardio
  running: 9.8,
  cycling: 7.5,
  swimming: 8,        // średnie tempo
  rowing: 7,

  // Średnia intensywność
  exercise: 6,
  walking: 3.5,
  yoga: 3,
  pilates: 4,
  stretching: 2.5,

  // Niska intensywność
  meditation: 1.5,
  mindset: 1.5,
  study: 1.5,
  work: 1.8,
  reading: 1.3,

  // Inne
  health: 2,
  nutrition: 1.5,
  rest: 1,
  scheduled: 2.5,
};

/**
 * Nazwa (po polsku) -> klucz typu z METS_BY_TYPE.
 * Kolejność ma znaczenie: dłuższe / bardziej szczegółowe frazy najpierw.
 */
const TYPE_BY_NAME_KEYWORD: Array<[string[], string]> = [
  [["bieg", "running", "trucht"], "running"],
  [["pływan", "plywan", "basen", "swim"], "swimming"],
  [["rower", "kolarstwo", "cycling", "spinning"], "cycling"],
  [["karate", "kata", "kumite"], "karate"],
  [["boks", "boxing"], "boxing"],
  [["hiit", "interwał", "interwal"], "hiit"],
  [["crossfit"], "crossfit"],
  [["wioślar", "wioslar", "ergometr", "rowing"], "rowing"],
  [["siłown", "silown", "siłowy", "silowy", "ciężary", "ciezary", "kalisten", "street workout"], "training"],
  [["joga", "yoga"], "yoga"],
  [["pilates"], "pilates"],
  [["rozciąga", "rozciaga", "stretch", "mobility"], "stretching"],
  [["medytacja", "medytowa", "vipassana", "oddech"], "meditation"],
  [["spacer", "marsz", "chodzenie"], "walking"],
  [["nauka", "czytanie", "czytałem", "czytalem", "kurs"], "study"],
  [["trening", "ćwicz", "cwicz", "workout"], "training"],
];

/**
 * Wykryj typ aktywności z nazwy. Zwraca klucz z METS_BY_TYPE albo `fallback`.
 * Używane m.in. przy wpisie głosowym, gdzie analizator nie podaje typu
 * (przedtem leciało "manual", które nie ma współczynnika MET).
 */
export function detectActivityType(name: string, fallback: string = "scheduled"): string {
  const n = (name || "").toLowerCase();
  for (const [keywords, type] of TYPE_BY_NAME_KEYWORD) {
    if (keywords.some((k) => n.includes(k))) return type;
  }
  return fallback;
}

/**
 * Wyciągnij czas trwania (minuty) z tekstu typu "bieganie 45 min",
 * "trening 1,5h", "medytacja 20 minut". Zwraca null, gdy nic nie znaleziono.
 */
export function parseDurationMinutes(text: string): number | null {
  if (!text) return null;
  const n = text.toLowerCase().replace(",", ".");

  // hours: "1.5 h", "2 godziny", "pół godziny"
  if (/(pół|pol)\s*(godz|h\b)/.test(n)) return 30;
  const hourMatch = n.match(/(\d+(?:\.\d+)?)\s*(?:h\b|godz)/);
  if (hourMatch) {
    const hours = parseFloat(hourMatch[1]);
    if (Number.isFinite(hours) && hours > 0 && hours <= 12) return Math.round(hours * 60);
  }

  // minutes: "45 min", "30 minut"
  const minMatch = n.match(/(\d+(?:\.\d+)?)\s*(?:min)/);
  if (minMatch) {
    const mins = parseFloat(minMatch[1]);
    if (Number.isFinite(mins) && mins > 0 && mins <= 600) return Math.round(mins);
  }

  return null;
}

function detectFromName(name: string): number | null {
  const type = detectActivityType(name, "");
  if (!type) return null;
  return METS_BY_TYPE[type] ?? null;
}

export function estimateCalories(
  type: string,
  name: string,
  durationMin: number | null | undefined,
  weightKg: number = 80 // default 80kg jeśli nie ma profilu
): number | null {
  if (!durationMin || durationMin <= 0) return null;

  const typeMets = METS_BY_TYPE[type?.toLowerCase()] ?? null;
  const nameMets = detectFromName(name);
  const mets = typeMets ?? nameMets ?? METS_BY_TYPE.scheduled;

  const hours = durationMin / 60;
  const kcal = mets * weightKg * hours;

  return Math.round(kcal);
}
