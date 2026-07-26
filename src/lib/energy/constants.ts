/**
 * Numbers and keys from docs/ENERGIA-SPEC.md that BOTH the server and the browser
 * need.
 *
 * Why a separate file: `score.ts` is pure but `defaults.ts` and `index.ts` import
 * Prisma, so a "use client" screen cannot import from them without dragging the
 * database client into the bundle. Everything here is plain data, safe on both sides,
 * and it stays the single place where these values are written down.
 */

/* ------------------------------------------------------------------ */
/*  Component keys with special rules                                  */
/* ------------------------------------------------------------------ */

export const WATER_COMPONENT_KEY = "woda-ml";
/** Toggle "dziś gorąco". Scores nothing (weight 0), only lifts the water target. */
export const HOT_DAY_COMPONENT_KEY = "upal";
export const CALORIES_COMPONENT_KEY = "kcal";
export const PROTEIN_COMPONENT_KEY = "bialko-g";

/* ------------------------------------------------------------------ */
/*  Water: "Cel wody jest ruchomy"                                     */
/* ------------------------------------------------------------------ */

/**
 *   baza    = 30 ml x waga ciała, zaokrąglone do 100 ml, nie mniej niż 2000 ml
 *   + 500   gdy w danym dniu jest ukończona aktywność ruchowa
 *   + 500   gdy użytkownik zaznaczył "dziś gorąco"
 * The stored `target` of `woda-ml` holds the MULTIPLIER (30), not litres, so the goal
 * follows the body down when the user loses weight.
 */
export const WATER_ML_PER_KG = 30;
export const WATER_TRAINING_BONUS_ML = 500;
export const WATER_HEAT_BONUS_ML = 500;
export const WATER_MIN_ML = 2000;
export const WATER_ROUND_ML = 100;

/* ------------------------------------------------------------------ */
/*  Calories: "Cel kaloryczny liczy się, a nie stoi w profilu"         */
/* ------------------------------------------------------------------ */

/**
 *   waga (żywa) -> BMR -> TDEE -> cel = TDEE - deficyt
 * The stored `target` of `kcal` holds the DEFICIT, never the calorie goal itself.
 *
 * The deficit lives in `UserProfile.data.calorieDeficit` and is read by
 * `lib/ai/body-metrics.ts`, which is the ONLY place the calorie goal is computed.
 * The `kcal` component row keeps a mirror of it for the settings form. These three
 * bounds are imported by body-metrics too, so the range is written down once.
 */
export const CALORIE_DEFICIT_DEFAULT = 300;
export const CALORIE_DEFICIT_MIN = 0;
export const CALORIE_DEFICIT_MAX = 700;
/** Above this the settings screen warns that the pace is not sustainable. */
export const CALORIE_DEFICIT_WARN = 500;

/** Spec, Odżywianie: "Białko: 2 g na kilogram masy ciała, z żywej wagi." */
export const PROTEIN_G_PER_KG = 2;

/* ------------------------------------------------------------------ */
/*  Supplements                                                        */
/* ------------------------------------------------------------------ */

/**
 * Spec, pillar Suplementacja: "To jest punkt wyjścia, nie zalecenie lekarskie... Ten
 * sam tekst, jednym zdaniem, ma stać na ekranie pod listą suplementów."
 * Exported so the screen prints exactly this sentence, not a paraphrase.
 */
export const SUPPLEMENT_DISCLAIMER =
  "To jest punkt wyjścia, nie zalecenie lekarskie. Skład i dawki potwierdź u lekarza albo dietetyka, najlepiej po badaniach krwi.";

/** Pillar the disclaimer belongs under. */
export const SUPPLEMENT_PILLAR_KEY = "suplementacja";
