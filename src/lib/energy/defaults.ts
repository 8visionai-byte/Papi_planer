/**
 * The seven pillars, straight out of docs/ENERGIA-SPEC.md.
 *
 * Every key, label, kind, target, tolerance, weight, unit and hint below is copied
 * from the spec tables. Nothing here is invented: the spec is the contract with the
 * owner, and these numbers are what he dictated on the recording.
 *
 * The numbers are only SEEDS. Once a pillar or a component exists in the database it
 * belongs to the user: `ensureEnergySetup` never touches an existing weight, target
 * or tolerance, it only fills in what is missing.
 */

import { prisma } from "@/lib/db/prisma";
import { CALORIE_DEFICIT_DEFAULT, PROTEIN_G_PER_KG, WATER_ML_PER_KG } from "./constants";
import type { ComponentKind } from "./score";
import type { EnergySource } from "./sources";

export interface ComponentDefault {
  key: string;
  label: string;
  kind: ComponentKind;
  /** null = the user types it in, otherwise a reader from ./sources. */
  source: EnergySource | null;
  target: number;
  tolerance: number | null;
  unit: string | null;
  /** Share of the pillar in percent. Each pillar's components sum to 100. */
  weight: number;
  hint: string | null;
}

export interface PillarDefault {
  key: string;
  name: string;
  emoji: string;
  /** Share of the whole day in percent. All seven sum to 100. */
  weight: number;
  components: ComponentDefault[];
}

/** Every `bool` component stores 1 as "done", so its target is always 1. */
const BOOL_TARGET = 1;

export const ENERGY_DEFAULTS: PillarDefault[] = [
  {
    key: "umysl",
    name: "Umysł",
    emoji: "🧠",
    weight: 20,
    components: [
      {
        key: "vipassana-min",
        label: "Vipassana",
        kind: "up",
        source: "meditation-minutes",
        // Spec: "Cel medytacji to dwie godziny: godzina rano i godzina wieczorem".
        target: 120,
        tolerance: null,
        unit: "min",
        weight: 40,
        hint: "Godzina rano i godzina wieczorem. Liczy się z aktywności i odhaczonych nawyków.",
      },
      {
        key: "nauka-min",
        label: "Nauka",
        kind: "up",
        source: "study-minutes",
        target: 45,
        tolerance: null,
        unit: "min",
        weight: 40,
        hint: "Cyberbezpieczeństwo, narzędzia AI, języki. Liczy się z ukończonych aktywności.",
      },
      {
        key: "skupienie",
        label: "Skupienie w ciągu dnia",
        kind: "up",
        source: null,
        target: 8,
        tolerance: null,
        unit: null,
        weight: 20,
        hint: "Skala 1 do 10. Ile skupienia miałeś dziś w ciągu dnia.",
      },
    ],
  },
  {
    key: "odzywianie",
    name: "Odżywianie",
    emoji: "🍽️",
    weight: 15,
    components: [
      {
        key: "kcal",
        label: "Kalorie",
        kind: "window",
        source: "calories",
        // `target` holds the DEFICIT, not the goal, and it is only a MIRROR: the value
        // that actually decides the goal is `UserProfile.data.calorieDeficit`, written
        // by PATCH /api/energy/config. The goal itself is computed once, in
        // lib/ai/body-metrics.ts, so /energia and /dieta cannot disagree.
        target: CALORIE_DEFICIT_DEFAULT,
        tolerance: 300,
        unit: "kcal",
        weight: 50,
        hint: "Deficyt w kcal. Cel to TDEE minus deficyt, ten sam, który widzisz na ekranie diety. Za dużo liczy się tak samo źle jak za mało.",
      },
      {
        key: "bialko-g",
        label: "Białko",
        kind: "up",
        source: "protein",
        // `target` holds grams per kilogram of body weight, not the total.
        target: PROTEIN_G_PER_KG,
        tolerance: null,
        unit: "g",
        weight: 30,
        hint: "Dwa gramy na kilogram masy ciała, z żywej wagi.",
      },
      {
        key: "posilki-wg-planu",
        label: "Posiłki z planu",
        kind: "bool",
        source: null,
        target: BOOL_TARGET,
        tolerance: null,
        unit: null,
        weight: 20,
        hint: "Zjadłem to, co było zaplanowane.",
      },
    ],
  },
  {
    key: "nawodnienie",
    name: "Nawodnienie",
    emoji: "💧",
    weight: 15,
    components: [
      {
        key: "woda-ml",
        label: "Woda",
        kind: "up",
        source: null,
        // `target` holds millilitres per kilogram of body weight, not litres.
        target: WATER_ML_PER_KG,
        tolerance: null,
        unit: "ml",
        weight: 50,
        hint: "Cel liczy się z wagi ciała. Trening dokłada 500 ml, upał kolejne 500 ml.",
      },
      {
        // Not a task to tick off: weight 0 means it never scores, it only lifts the
        // water goal by 500 ml (spec: "Nie liczy się do procentu, tylko podnosi cel").
        key: "upal",
        label: "Dziś gorąco",
        kind: "bool",
        source: null,
        target: BOOL_TARGET,
        tolerance: null,
        unit: null,
        weight: 0,
        hint: "Podnosi dzisiejszy cel wody o 500 ml. Nie liczy się do procentu.",
      },
      {
        key: "woda-z-sola",
        label: "Woda z solą",
        kind: "bool",
        source: null,
        target: BOOL_TARGET,
        tolerance: null,
        unit: null,
        weight: 25,
        hint: null,
      },
      {
        key: "woda-nawyk",
        label: "Małe łyki, ze szkła",
        kind: "bool",
        source: null,
        target: BOOL_TARGET,
        tolerance: null,
        unit: null,
        weight: 25,
        hint: "Małe łyki przez cały dzień, ze szklanego naczynia.",
      },
    ],
  },
  {
    key: "ruch",
    name: "Ruch",
    emoji: "🏃",
    weight: 15,
    components: [
      {
        key: "ruch-min",
        label: "Minuty ruchu",
        kind: "up",
        source: "activity-minutes",
        target: 90,
        tolerance: null,
        unit: "min",
        weight: 100,
        hint: "Półtorej godziny dziennie. Liczy się z ukończonych aktywności.",
      },
    ],
  },
  {
    key: "sen",
    name: "Sen",
    emoji: "😴",
    weight: 15,
    components: [
      {
        key: "sen-h",
        label: "Długość snu",
        kind: "window",
        source: "sleep-hours",
        target: 7.5,
        tolerance: 1.5,
        unit: "h",
        weight: 40,
        hint: "Liczy się z wpisu dnia.",
      },
      {
        key: "sen-gleboki-min",
        label: "Sen głęboki",
        kind: "up",
        source: null,
        target: 90,
        tolerance: null,
        unit: "min",
        weight: 20,
        hint: "Przepisz z zegarka.",
      },
      {
        key: "sen-pora",
        label: "Poszedłem spać o czasie",
        kind: "bool",
        source: null,
        target: BOOL_TARGET,
        tolerance: null,
        unit: null,
        weight: 15,
        hint: null,
      },
      {
        key: "sen-elektronika",
        label: "Elektronika wyłączona",
        kind: "bool",
        source: null,
        target: BOOL_TARGET,
        tolerance: null,
        unit: null,
        weight: 15,
        hint: null,
      },
      {
        key: "sen-pokoj",
        label: "Przewietrzony pokój",
        kind: "bool",
        source: null,
        target: BOOL_TARGET,
        tolerance: null,
        unit: null,
        weight: 10,
        hint: null,
      },
    ],
  },
  {
    key: "swieze-powietrze",
    name: "Świeże powietrze",
    emoji: "🌤️",
    weight: 15,
    components: [
      {
        key: "dwor-min",
        label: "Czas na dworze",
        kind: "up",
        source: null,
        target: 120,
        tolerance: null,
        unit: "min",
        weight: 40,
        hint: null,
      },
      {
        key: "slonce-min",
        label: "Ekspozycja na słońce",
        kind: "up",
        source: null,
        target: 120,
        tolerance: null,
        unit: "min",
        weight: 40,
        hint: null,
      },
      {
        key: "oddech-min",
        label: "Ćwiczenia oddechowe",
        kind: "up",
        source: null,
        target: 10,
        tolerance: null,
        unit: "min",
        weight: 20,
        hint: null,
      },
    ],
  },
  {
    key: "suplementacja",
    name: "Suplementacja",
    emoji: "💊",
    weight: 5,
    components: [
      {
        key: "supl-kreatyna",
        label: "Kreatyna 5 g",
        kind: "bool",
        source: null,
        target: BOOL_TARGET,
        tolerance: null,
        unit: null,
        weight: 20,
        hint: "Codziennie, pora bez znaczenia.",
      },
      {
        key: "supl-d3k2",
        label: "Witamina D3 z K2",
        kind: "bool",
        source: null,
        target: BOOL_TARGET,
        tolerance: null,
        unit: null,
        weight: 20,
        hint: "Rano, do posiłku z tłuszczem.",
      },
      {
        key: "supl-magnez",
        label: "Magnez",
        kind: "bool",
        source: null,
        target: BOOL_TARGET,
        tolerance: null,
        unit: null,
        weight: 20,
        hint: "Wieczorem, wspiera sen.",
      },
      {
        key: "supl-omega3",
        label: "Omega 3",
        kind: "bool",
        source: null,
        target: BOOL_TARGET,
        tolerance: null,
        unit: null,
        weight: 20,
        hint: "Do posiłku.",
      },
      {
        key: "supl-b",
        label: "Kompleks witamin B",
        kind: "bool",
        source: null,
        target: BOOL_TARGET,
        tolerance: null,
        unit: null,
        weight: 20,
        hint: "Rano, potrafi rozbudzić.",
      },
    ],
  },
];


/** Every component key the app knows about, for validating incoming `values`. */
export const DEFAULT_COMPONENT_KEYS = new Set(
  ENERGY_DEFAULTS.flatMap((p) => p.components.map((c) => c.key))
);

export interface EnsureEnergySetupResult {
  pillarsCreated: number;
  componentsCreated: number;
}

/**
 * Create whatever the user is missing, change nothing he already has.
 *
 * Idempotent by construction:
 *  - pillars go through `upsert` on the [userId, key] unique index with an EMPTY
 *    update block, so a second call is a no-op even if two requests race,
 *  - components are diffed by key inside their pillar and only the absent ones are
 *    inserted.
 *
 * What it deliberately does NOT do: touch `weight`, `target` or `tolerance` of a row
 * that already exists. Those belong to the user the moment he edits them in
 * /energy (Ustawienia), and a "helpful" reset would silently undo his tuning.
 */
export async function ensureEnergySetup(userId: string): Promise<EnsureEnergySetupResult> {
  const existing = await prisma.energyPillar.findMany({
    where: { userId },
    select: { id: true, key: true, components: { select: { key: true } } },
  });

  const existingByKey = new Map(existing.map((p) => [p.key, p]));

  let pillarsCreated = 0;
  let componentsCreated = 0;

  for (let i = 0; i < ENERGY_DEFAULTS.length; i++) {
    const def = ENERGY_DEFAULTS[i];
    const found = existingByKey.get(def.key);

    let pillarId: string;
    let presentComponentKeys: Set<string>;

    if (found) {
      pillarId = found.id;
      presentComponentKeys = new Set(found.components.map((c) => c.key));
    } else {
      const created = await prisma.energyPillar.upsert({
        where: { userId_key: { userId, key: def.key } },
        // Empty on purpose — see the doc comment above.
        update: {},
        create: {
          userId,
          key: def.key,
          name: def.name,
          emoji: def.emoji,
          weight: def.weight,
          sortOrder: i,
        },
        select: { id: true, components: { select: { key: true } } },
      });
      pillarId = created.id;
      presentComponentKeys = new Set(created.components.map((c) => c.key));
      // Counted as created because it was absent from the read above. In the rare
      // race where a parallel request inserted it first, the upsert changed nothing
      // and this counter is one too high — it is a report, not a decision.
      pillarsCreated += 1;
    }

    const missing = def.components.filter((c) => !presentComponentKeys.has(c.key));
    if (missing.length === 0) continue;

    await prisma.energyComponent.createMany({
      data: missing.map((c) => ({
        pillarId,
        key: c.key,
        label: c.label,
        kind: c.kind,
        source: c.source,
        target: c.target,
        tolerance: c.tolerance,
        unit: c.unit,
        weight: c.weight,
        hint: c.hint,
        sortOrder: def.components.indexOf(c),
      })),
    });
    componentsCreated += missing.length;
  }

  return { pillarsCreated, componentsCreated };
}
