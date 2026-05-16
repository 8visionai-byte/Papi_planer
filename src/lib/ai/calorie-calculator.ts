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
 * Spróbuj wykryć typ aktywności z nazwy (po polsku) jeśli typ jest zbyt ogólny.
 */
function detectFromName(name: string): number | null {
  const n = name.toLowerCase();
  if (n.includes("bieg") || n.includes("running")) return 9.8;
  if (n.includes("pływan") || n.includes("basen") || n.includes("swim")) return 8;
  if (n.includes("rower") || n.includes("kolarstwo") || n.includes("cycling")) return 7.5;
  if (n.includes("karate") || n.includes("kata") || n.includes("kumite")) return 10;
  if (n.includes("boks") || n.includes("boxing")) return 12;
  if (n.includes("siłown") || n.includes("siłowy") || n.includes("ciężary")) return 8;
  if (n.includes("kalisten") || n.includes("street workout")) return 8;
  if (n.includes("hiit") || n.includes("interwał")) return 12;
  if (n.includes("joga") || n.includes("yoga")) return 3;
  if (n.includes("rozciąga") || n.includes("stretch")) return 2.5;
  if (n.includes("medytacja") || n.includes("vipassana") || n.includes("oddech")) return 1.5;
  if (n.includes("spacer")) return 3.5;
  if (n.includes("nauka") || n.includes("czytanie")) return 1.5;
  return null;
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
