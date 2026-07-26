"use client";

/**
 * "Moja energia" - the screen ENERGIA-SPEC calls the most important one in the app.
 *
 * Three tabs (Dziś / Trend / Ustawienia) driven by SegmentedTabs + SwipeDeck, so the
 * screen behaves like the rest of the app: you can swipe it with a thumb.
 *
 * Data flow, on purpose:
 * - the screen owns the optimistic state. A tap on "+" repaints the ring immediately
 *   and the PATCH leaves ~500 ms later, batched, so holding a stepper cannot fire
 *   twenty requests.
 * - the last payload the SERVER confirmed is kept in a ref. A failed save rolls the
 *   screen back to that, shows one sentence and buzzes once.
 * - the API is built in parallel by another agent. Every endpoint is treated as
 *   possibly-missing: the screen shows a loading state and then a readable message,
 *   never a white page. The settings tab even falls back to the pillar data from
 *   GET /api/energy when GET /api/energy/config is not there yet.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Skeleton,
  T,
  TYPO,
  MOTION,
  fieldControlStyle,
} from "@/components/ui";
import { SegmentedTabs, SwipeDeck } from "@/components/motion";
import { useChartTheme } from "@/components/tracking/useChartTheme";
import { haptic } from "@/lib/haptics";
import { EnergyRing, energyColor, energyTextColor } from "@/components/energy/EnergyRing";
import { PillarBar } from "@/components/energy/PillarBar";
import {
  ComponentField,
  ToggleSwitch,
  componentPercent,
  decimalsFor,
  formatNumber,
  hasNoTarget,
  isAuto,
  type EnergyComponentDTO,
} from "@/components/energy/ComponentField";
import {
  CALORIES_COMPONENT_KEY,
  CALORIE_DEFICIT_MAX,
  CALORIE_DEFICIT_WARN,
  PROTEIN_COMPONENT_KEY,
  SUPPLEMENT_DISCLAIMER,
  SUPPLEMENT_PILLAR_KEY,
  WATER_COMPONENT_KEY,
} from "@/lib/energy/constants";

/* ------------------------------------------------------------------ */
/*  API contract (ENERGIA-SPEC section 4)                              */
/* ------------------------------------------------------------------ */

interface EnergyPillarDTO {
  key: string;
  name: string;
  emoji: string;
  /** Share of the day in percent. */
  weight: number;
  /** 0-100 fill of the pillar. */
  percent: number;
  components: EnergyComponentDTO[];
}

interface EnergyDayDTO {
  date: string;
  total: number;
  feltEnergy: number | null;
  note: string | null;
  pillars: EnergyPillarDTO[];
}

interface TrendDayDTO {
  date: string;
  total: number;
  feltEnergy: number | null;
  pillars: Record<string, number>;
}

interface TrendDTO {
  days: TrendDayDTO[];
  averages: { total: number; pillars: Record<string, number> };
  weakest: { key: string; name: string; percent: number } | null;
  insights: Array<{ text: string; kind?: string }>;
  /**
   * Why there are no insights yet, in the server's own words. ENERGIA-SPEC section 4
   * asks for that message explicitly ("pusta lista i komunikat, że dane jeszcze
   * rosną"), and the server knows how many rated days are really missing.
   */
  note?: string | null;
}

/** GET /api/energy/config. `active` may be missing - then the row counts as active. */
interface ConfigComponentDTO extends EnergyComponentDTO {
  active?: boolean;
}

interface ConfigPillarDTO {
  key: string;
  name: string;
  emoji: string;
  weight: number;
  active?: boolean;
  components: ConfigComponentDTO[];
}

/** Body of PATCH /api/energy/config. Everything is addressed by `key`, never by id. */
interface ConfigSavePayload {
  pillars: Array<{ key: string; weight: number }>;
  components: Array<{
    key: string;
    target: number | null;
    tolerance: number | null;
    active: boolean;
  }>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TABS = [
  { key: "dzis", label: "Dziś" },
  { key: "trend", label: "Trend" },
  { key: "ustawienia", label: "Ustawienia" },
] as const;

/** How long a stepper burst is collected before one PATCH leaves. */
const SAVE_DEBOUNCE_MS = 500;
/** Below this the trend chart is noise, so we say how many days are still missing. */
const MIN_CHART_DAYS = 3;
/** ENERGIA-SPEC section 4: insights need five rated days. */
const MIN_RATED_DAYS = 5;
const TREND_DAYS = 30;

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Weighted average of the components, then the day total, per spec sections 1 and 2.
 *
 * Mirrors `scorePillar` / `scoreDay` on the server: components without a computable
 * target are skipped entirely (they must not drag the pillar down), the divisor is
 * the weight that actually took part, and the day total is divided by the real sum of
 * pillar weights instead of a hardcoded 100.
 */
function recalc(day: EnergyDayDTO): EnergyDayDTO {
  const pillars = day.pillars.map((pillar) => {
    let weightSum = 0;
    let filled = 0;
    for (const c of pillar.components) {
      if (hasNoTarget(c)) continue;
      const weight = c.weight ?? 0;
      if (weight <= 0) continue;
      weightSum += weight;
      filled += c.percent * weight;
    }
    return { ...pillar, percent: weightSum > 0 ? filled / weightSum : 0 };
  });

  let pillarWeight = 0;
  let dayFilled = 0;
  for (const p of pillars) {
    const weight = p.weight ?? 0;
    if (weight <= 0) continue;
    pillarWeight += weight;
    dayFilled += p.percent * weight;
  }
  const total = pillarWeight > 0 ? dayFilled / pillarWeight : 0;
  return { ...day, pillars, total };
}

/** Optimistic write of one manual component, followed by a full recalculation. */
function applyValue(day: EnergyDayDTO, key: string, value: number): EnergyDayDTO {
  const pillars = day.pillars.map((pillar) => ({
    ...pillar,
    components: pillar.components.map((c) =>
      c.key === key ? { ...c, value, percent: componentPercent(c, value) } : c,
    ),
  }));
  return recalc({ ...day, pillars });
}

/** "2026-07-26" -> "26.07". No locale call, so server and client agree. */
function shortDate(iso: string): string {
  if (typeof iso !== "string" || iso.length < 10) return iso ?? "";
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

/**
 * "1 składowa" / "3 składowe" / "5 składowych". Polish counts in three forms, and
 * "4 składowych" reads like a machine wrote it.
 */
function componentCountLabel(n: number): string {
  if (n === 1) return "1 składowa";
  const last = n % 10;
  const lastTwo = n % 100;
  const few = last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14);
  return `${n} ${few ? "składowe" : "składowych"}`;
}

/** One readable Polish sentence out of any failed response. */
async function readError(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json();
    if (data && typeof data === "object") {
      const record = data as Record<string, unknown>;
      if (typeof record.error === "string" && record.error) return record.error;
      if (typeof record.message === "string" && record.message) return record.message;
    }
  } catch {
    /* body was not JSON - fall through to the status based message */
  }
  if (res.status === 401) return "Sesja wygasła. Zaloguj się ponownie.";
  if (res.status === 404) return "Ta część aplikacji nie jest jeszcze gotowa.";
  return `Nie udało się zapisać (błąd ${res.status}).`;
}

/* ------------------------------------------------------------------ */
/*  Screen                                                             */
/* ------------------------------------------------------------------ */

export default function EnergyPage() {
  const [tab, setTab] = useState(0);

  /* ---- day ---- */
  const [day, setDay] = useState<EnergyDayDTO | null>(null);
  const [dayLoading, setDayLoading] = useState(true);
  const [dayError, setDayError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [openPillar, setOpenPillar] = useState<string | null>(null);

  /* ---- trend ---- */
  const [trend, setTrend] = useState<TrendDTO | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [trendError, setTrendError] = useState<string | null>(null);
  /** "a load was already started for this tab". Never reset on failure, otherwise a
      dead endpoint would be retried on every render for as long as the tab is open. */
  const trendRequestedRef = useRef(false);

  /* ---- config ---- */
  const [config, setConfig] = useState<ConfigPillarDTO[] | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaveError, setConfigSaveError] = useState<string | null>(null);
  const configRequestedRef = useRef(false);

  /* ---- optimistic save machinery ---- */
  /** Last payload the server confirmed. The rollback target. */
  const serverDayRef = useRef<EnergyDayDTO | null>(null);
  const pendingValuesRef = useRef<Record<string, number>>({});
  const pendingFeltRef = useRef<number | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dateRef = useRef<string | null>(null);

  useEffect(() => {
    dateRef.current = day?.date ?? null;
  }, [day?.date]);

  /* ---------------- fetching ---------------- */

  /* No setState before the first await on purpose: this one is called straight from a
     mount effect, and a synchronous setState there cascades an extra render. The
     spinner is switched on by the caller (`retryDay`), the initial state already is
     "loading". */
  const loadDay = useCallback(async () => {
    try {
      const res = await fetch("/api/energy", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      const json = (await res.json()) as EnergyDayDTO;
      const safe: EnergyDayDTO = { ...json, pillars: Array.isArray(json.pillars) ? json.pillars : [] };
      serverDayRef.current = safe;
      setDay(safe);
      setDayError(null);
    } catch (e) {
      setDayError(e instanceof Error ? e.message : "Nie udało się wczytać energii.");
    } finally {
      setDayLoading(false);
    }
  }, []);

  /** Retry from the empty state: this one runs in an event handler, so it may show the spinner. */
  const retryDay = useCallback(() => {
    setDayLoading(true);
    setDayError(null);
    void loadDay();
  }, [loadDay]);

  const loadTrend = useCallback(async () => {
    setTrendLoading(true);
    setTrendError(null);
    try {
      const res = await fetch(`/api/energy/trend?days=${TREND_DAYS}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      const json = (await res.json()) as TrendDTO;
      setTrend({
        days: Array.isArray(json.days) ? json.days : [],
        averages: json.averages ?? { total: 0, pillars: {} },
        weakest: json.weakest ?? null,
        insights: Array.isArray(json.insights) ? json.insights : [],
        note: typeof json.note === "string" ? json.note : null,
      });
    } catch (e) {
      setTrendError(e instanceof Error ? e.message : "Nie udało się wczytać trendu.");
    } finally {
      setTrendLoading(false);
    }
  }, []);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const res = await fetch("/api/energy/config", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res));
      const json = (await res.json()) as { pillars?: ConfigPillarDTO[] } | ConfigPillarDTO[];
      const pillars = Array.isArray(json) ? json : (json.pillars ?? []);
      setConfig(pillars);
    } catch {
      /* The config endpoint may not exist yet. The day payload carries the same
         weights, targets and tolerances, so the tab stays usable and only the save
         can fail - with the server's own message. */
      const fallback = serverDayRef.current?.pillars;
      if (fallback && fallback.length > 0) {
        setConfig(
          fallback.map((p) => ({
            key: p.key,
            name: p.name,
            emoji: p.emoji,
            weight: p.weight,
            active: true,
            components: p.components.map((c) => ({ ...c, active: true })),
          })),
        );
        setConfigError(null);
      } else {
        setConfigError("Nie udało się wczytać ustawień.");
      }
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  /* Tabs load their data the first time they are opened, not on mount. The guard is a
     ref set BEFORE the request, so a failing endpoint is asked once and then only on
     an explicit "Spróbuj ponownie". */
  useEffect(() => {
    if (tab === 1 && !trendRequestedRef.current) {
      trendRequestedRef.current = true;
      void loadTrend();
    }
    if (tab === 2 && !configRequestedRef.current) {
      configRequestedRef.current = true;
      void loadConfig();
    }
  }, [tab, loadTrend, loadConfig]);

  /* ---------------- saving ---------------- */

  const sendPatch = useCallback(async () => {
    const values = pendingValuesRef.current;
    const felt = pendingFeltRef.current;
    pendingValuesRef.current = {};
    pendingFeltRef.current = null;

    const hasValues = Object.keys(values).length > 0;
    if (!hasValues && felt == null) return;

    try {
      const res = await fetch("/api/energy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(dateRef.current ? { date: dateRef.current } : null),
          ...(hasValues ? { values } : null),
          ...(felt != null ? { feltEnergy: felt } : null),
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      const json = (await res.json()) as EnergyDayDTO;
      const safe: EnergyDayDTO = { ...json, pillars: Array.isArray(json.pillars) ? json.pillars : [] };
      serverDayRef.current = safe;
      setSaveError(null);
      // If the user kept tapping while this request was in flight, the screen already
      // shows newer numbers. Keep them and let the next flush confirm.
      const stillPending =
        Object.keys(pendingValuesRef.current).length > 0 || pendingFeltRef.current != null;
      if (!stillPending) setDay(safe);
      // today changed, so the trend has to be fetched again next time it is opened
      trendRequestedRef.current = false;
    } catch (e) {
      if (serverDayRef.current) setDay(serverDayRef.current);
      setSaveError(e instanceof Error ? e.message : "Nie udało się zapisać.");
      haptic.error();
    }
  }, []);

  /* Saves are chained, never parallel. PATCH /api/energy is a read-modify-write of one
     JSON blob, so two requests in flight at once can drop whichever value lost the
     race - on a slow connection that means a tap that visibly "did not save". */
  const inFlightRef = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(() => {
    const next = inFlightRef.current.then(sendPatch, sendPatch);
    inFlightRef.current = next;
    return next;
  }, [sendPatch]);

  const schedule = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      void flush();
    }, SAVE_DEBOUNCE_MS);
  }, [flush]);

  /* Leaving the screen must not eat the last tap. */
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      void flush();
    };
  }, [flush]);

  const handleValue = useCallback(
    (key: string, value: number) => {
      setDay((prev) => (prev ? applyValue(prev, key, value) : prev));
      pendingValuesRef.current[key] = value;
      schedule();
    },
    [schedule],
  );

  const handleFelt = useCallback(
    (value: number) => {
      setDay((prev) => (prev ? { ...prev, feltEnergy: value } : prev));
      pendingFeltRef.current = value;
      schedule();
    },
    [schedule],
  );

  /** Returns true when the server accepted the change, so the tab can drop its drafts. */
  const handleConfigSave = useCallback(
    async (payload: ConfigSavePayload): Promise<boolean> => {
      setConfigSaving(true);
      setConfigSaveError(null);
      try {
        const res = await fetch("/api/energy/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await readError(res));
        haptic.success();
        // new weights change every score, so both the day and the trend are stale
        trendRequestedRef.current = false;
        await Promise.all([loadDay(), loadConfig()]);
        return true;
      } catch (e) {
        setConfigSaveError(e instanceof Error ? e.message : "Nie udało się zapisać ustawień.");
        haptic.error();
        return false;
      } finally {
        setConfigSaving(false);
      }
    },
    [loadDay, loadConfig],
  );

  /* ---------------- derived ---------------- */

  const pillarMeta = useMemo(() => {
    const map: Record<string, { name: string; emoji: string }> = {};
    for (const p of day?.pillars ?? []) map[p.key] = { name: p.name, emoji: p.emoji };
    for (const p of config ?? []) map[p.key] = { name: p.name, emoji: p.emoji };
    return map;
  }, [day, config]);

  return (
    <div
      style={{
        padding: `${T.sp6} ${T.gutter} ${T.sp6}`,
        display: "flex",
        flexDirection: "column",
        gap: T.sp5,
      }}
    >
      <header className="anim-in">
        <div style={{ ...TYPO.label, color: T.text3, marginBottom: 6 }}>Twój poziom energii</div>
        <h1 style={{ ...TYPO.title1, color: T.text, margin: 0 }}>Moja energia</h1>
        <p style={{ ...TYPO.callout, color: T.text2, margin: `${T.sp1} 0 0` }}>
          Siedem filarów, jedna liczba. Zaznaczaj w ciągu dnia, a zależności zobaczysz w trendzie.
        </p>
      </header>

      <SegmentedTabs
        tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
        active={TABS[tab].key}
        onChange={(key) => {
          const next = TABS.findIndex((t) => t.key === key);
          if (next >= 0) setTab(next);
        }}
        ariaLabel="Sekcje ekranu energii"
      />

      {saveError ? (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: T.sp3,
            padding: T.sp3,
            borderRadius: T.rMd,
            background: T.dangerSoft,
            border: `1px solid ${T.danger}`,
            color: T.dangerOnSurface,
            ...TYPO.footnote,
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{saveError}</span>
          <Button variant="ghost" size="sm" onPress={() => setSaveError(null)}>
            Ukryj
          </Button>
        </div>
      ) : null}

      <SwipeDeck
        index={tab}
        onChange={setTab}
        labels={TABS.map((t) => t.label)}
        ariaLabel="Sekcje ekranu energii"
      >
        <TodayPanel
          day={day}
          loading={dayLoading}
          error={dayError}
          onRetry={retryDay}
          openPillar={openPillar}
          onTogglePillar={(key) => setOpenPillar((prev) => (prev === key ? null : key))}
          onValue={handleValue}
          onFelt={handleFelt}
        />

        <TrendPanel
          trend={trend}
          loading={trendLoading}
          error={trendError}
          onRetry={loadTrend}
          pillarMeta={pillarMeta}
        />

        <SettingsPanel
          config={config}
          loading={configLoading}
          error={configError}
          onRetry={loadConfig}
          onSave={handleConfigSave}
          saving={configSaving}
          saveError={configSaveError}
        />
      </SwipeDeck>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 1: Dziś                                                        */
/* ------------------------------------------------------------------ */

function TodayPanel({
  day,
  loading,
  error,
  onRetry,
  openPillar,
  onTogglePillar,
  onValue,
  onFelt,
}: {
  day: EnergyDayDTO | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  openPillar: string | null;
  onTogglePillar: (key: string) => void;
  onValue: (key: string, value: number) => void;
  onFelt: (value: number) => void;
}) {
  if (loading && !day) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
        <Skeleton variant="block" height={260} radius={28} />
        <Skeleton variant="block" height={92} radius={20} />
        <Skeleton variant="block" height={92} radius={20} />
        <Skeleton variant="block" height={92} radius={20} />
      </div>
    );
  }

  if (error && !day) {
    return (
      <Card>
        <EmptyState
          icon="⚡"
          title="Nie udało się wczytać energii"
          body={error}
          action={{ label: "Spróbuj ponownie", onPress: onRetry }}
        />
      </Card>
    );
  }

  if (!day || day.pillars.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="⚡"
          title="Filary jeszcze nie są gotowe"
          body="Zaraz po pierwszym otwarciu aplikacja zakłada siedem filarów. Odśwież za chwilę."
          action={{ label: "Odśwież", onPress: onRetry }}
        />
      </Card>
    );
  }

  const total = Math.round(day.total ?? 0);
  const weakest = [...day.pillars].sort((a, b) => a.percent - b.percent)[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
      {/* ---- hero ring ---- */}
      <div
        className="card-hero"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: T.sp3,
          padding: T.sp6,
        }}
      >
        <EnergyRing value={day.total ?? 0} size={200} caption="energia dnia" />
        <div style={{ ...TYPO.callout, color: T.text2, textAlign: "center" }}>
          {total >= 70
            ? "Dobry dzień. Trzymaj to tempo."
            : total >= 40
              ? "Jest połowa. Najwięcej zyskasz na najsłabszym filarze."
              : "Dziś nisko. Wybierz jedną rzecz i podnieś ją."}
        </div>
        {weakest ? (
          <div
            style={{
              ...TYPO.footnote,
              color: energyTextColor(weakest.percent),
              background: T.surface2,
              borderRadius: T.rFull,
              padding: `${T.sp2} ${T.sp4}`,
            }}
          >
            Najsłabszy filar: {weakest.emoji} {weakest.name} {Math.round(weakest.percent)}%
          </div>
        ) : null}
      </div>

      {/* ---- pillars ---- */}
      <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
        {day.pillars.map((pillar) => (
          <PillarBar
            key={pillar.key}
            emoji={pillar.emoji}
            name={pillar.name}
            percent={pillar.percent}
            weight={pillar.weight}
            expanded={openPillar === pillar.key}
            onToggle={() => onTogglePillar(pillar.key)}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              {pillar.components.map((component, index) => (
                <div
                  key={component.key}
                  style={{
                    borderTop: index === 0 ? "none" : `1px solid ${T.border}`,
                  }}
                >
                  <ComponentField component={component} onChange={onValue} />
                </div>
              ))}
              {pillar.components.length === 0 ? (
                <div style={{ ...TYPO.footnote, color: T.text3, padding: `${T.sp3} 0` }}>
                  Ten filar nie ma jeszcze składowych.
                </div>
              ) : null}

              {/* ENERGIA-SPEC, Suplementacja: this exact sentence has to stand under
                  the list of supplements. The app tracks regularity, it does not
                  prescribe. */}
              {pillar.key === SUPPLEMENT_PILLAR_KEY ? (
                <div
                  style={{
                    ...TYPO.footnote,
                    color: T.text2,
                    background: T.surface2,
                    borderRadius: T.rMd,
                    padding: T.sp3,
                    margin: `${T.sp2} 0`,
                  }}
                >
                  {SUPPLEMENT_DISCLAIMER}
                </div>
              ) : null}
            </div>
          </PillarBar>
        ))}
      </div>

      {/* ---- felt energy ---- */}
      <FeltEnergyCard value={day.feltEnergy} onChange={onFelt} />
    </div>
  );
}

/** "Jak się dziś czujesz?" - the only input that lets the app find dependencies. */
function FeltEnergyCard({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number) => void;
}) {
  return (
    <Card variant="elevated" padding="lg">
      <div style={{ ...TYPO.title3, color: T.text }}>Jak się dziś czujesz?</div>
      <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 4 }}>
        Twoja ocena, nie wyliczenie. To po niej aplikacja szuka zależności.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: T.sp4, marginTop: T.sp4 }}>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={value ?? 5}
          aria-label="Odczuwana energia w skali od 1 do 10"
          onChange={(e) => {
            haptic.selection();
            onChange(Number(e.target.value));
          }}
          style={{
            flex: 1,
            minWidth: 0,
            height: T.tapMin,
            accentColor: T.primary,
            background: "transparent",
            cursor: "pointer",
          }}
        />
        <div
          style={{
            ...TYPO.title2,
            color: value == null ? T.text3 : T.text,
            fontVariantNumeric: "tabular-nums",
            minWidth: 56,
            textAlign: "right",
          }}
        >
          {value == null ? "brak" : `${value}/10`}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: T.sp1 }}>
        <span style={{ ...TYPO.footnote, color: T.text3 }}>1 słabo</span>
        <span style={{ ...TYPO.footnote, color: T.text3 }}>10 świetnie</span>
      </div>

      {value == null ? (
        <div style={{ ...TYPO.footnote, color: T.text3, marginTop: T.sp3 }}>
          Przesuń suwak, żeby zapisać dzisiejszą ocenę.
        </div>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 2: Trend                                                       */
/* ------------------------------------------------------------------ */

function TrendPanel({
  trend,
  loading,
  error,
  onRetry,
  pillarMeta,
}: {
  trend: TrendDTO | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  pillarMeta: Record<string, { name: string; emoji: string }>;
}) {
  const chart = useChartTheme();

  if (loading && !trend) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
        <Skeleton variant="block" height={240} radius={20} />
        <Skeleton variant="block" height={200} radius={20} />
      </div>
    );
  }

  if (error && !trend) {
    return (
      <Card>
        <EmptyState
          icon="📈"
          title="Nie udało się wczytać trendu"
          body={error}
          action={{ label: "Spróbuj ponownie", onPress: onRetry }}
        />
      </Card>
    );
  }

  if (!trend) return null;

  const days = trend.days ?? [];
  const rated = days.filter((d) => d.feltEnergy != null).length;
  const chartData = days.map((d) => ({
    label: shortDate(d.date),
    total: Math.round(d.total ?? 0),
    felt: d.feltEnergy,
  }));

  const averages = Object.entries(trend.averages?.pillars ?? {})
    .map(([key, percent]) => ({
      key,
      percent: Number(percent) || 0,
      name: pillarMeta[key]?.name ?? key,
      emoji: pillarMeta[key]?.emoji ?? "",
    }))
    .sort((a, b) => a.percent - b.percent);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
      {/* ---- chart ---- */}
      <Card>
        <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp3 }}>
          Ostatnie {TREND_DAYS} dni
        </div>

        {days.length < MIN_CHART_DAYS ? (
          <div style={{ ...TYPO.callout, color: T.text2, padding: `${T.sp5} 0` }}>
            Wykres pojawi się po {MIN_CHART_DAYS} dniach z wpisem. Masz {days.length}, brakuje{" "}
            {MIN_CHART_DAYS - days.length}.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: T.sp4, marginBottom: T.sp2 }}>
              <LegendDot color={chart.accent} label="energia policzona" />
              <LegendDot color={chart.accent2} label="energia odczuwana" />
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 8, right: 4, bottom: 0, left: -22 }}>
                <CartesianGrid stroke={chart.border} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 12, fill: chart.axis }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={18}
                />
                <YAxis
                  yAxisId="pct"
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tick={{ fontSize: 12, fill: chart.axis }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="felt"
                  orientation="right"
                  domain={[0, 10]}
                  ticks={[0, 5, 10]}
                  tick={{ fontSize: 12, fill: chart.axis }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ stroke: chart.grid, strokeWidth: 1 }}
                  contentStyle={{
                    background: chart.surface,
                    border: `1px solid ${chart.border}`,
                    borderRadius: 14,
                    fontSize: 13,
                    color: chart.text,
                  }}
                  labelStyle={{ color: chart.text2 }}
                  itemStyle={{ color: chart.text }}
                />
                <Line
                  yAxisId="pct"
                  type="monotone"
                  dataKey="total"
                  name="Policzona"
                  unit="%"
                  stroke={chart.accent}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, fill: chart.accent }}
                  animationDuration={720}
                />
                <Line
                  yAxisId="felt"
                  type="monotone"
                  dataKey="felt"
                  name="Odczuwana"
                  unit="/10"
                  stroke={chart.accent2}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  activeDot={{ r: 5, fill: chart.accent2 }}
                  connectNulls
                  animationDuration={720}
                />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </Card>

      {/* ---- pillar averages ---- */}
      <Card>
        <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp3 }}>
          Średnie po filarach
        </div>
        {averages.length === 0 ? (
          <div style={{ ...TYPO.callout, color: T.text2 }}>
            Średnie policzą się po pierwszych wpisach.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
            {averages.map((row) => {
              const percent = Math.max(0, Math.min(100, Math.round(row.percent)));
              return (
                <div key={row.key}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: T.sp2,
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ ...TYPO.callout, color: T.text, flex: 1, minWidth: 0 }}>
                      {row.emoji} {row.name}
                    </span>
                    <span
                      style={{
                        ...TYPO.footnote,
                        color: energyTextColor(percent),
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {percent}%
                    </span>
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: T.rFull,
                      background: T.surface2,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${percent}%`,
                        borderRadius: T.rFull,
                        background: energyColor(percent),
                        transition: `width ${MOTION.slow} ${MOTION.easeOut}`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {trend.weakest ? (
          <div style={{ ...TYPO.footnote, color: T.text2, marginTop: T.sp4 }}>
            Najsłabszy filar okresu: {trend.weakest.name} {Math.round(trend.weakest.percent)}%.
          </div>
        ) : null}
      </Card>

      {/* ---- insights ---- */}
      <Card>
        <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp3 }}>Co widać w danych</div>
        {trend.insights.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
            {trend.insights.map((insight, index) => (
              <div
                key={index}
                style={{
                  ...TYPO.callout,
                  color: T.text,
                  background: T.surface2,
                  borderRadius: T.rMd,
                  padding: T.sp3,
                }}
              >
                {insight.text}
              </div>
            ))}
          </div>
        ) : (
          /* The server's own sentence wins: it knows whether the blocker is too few
             rated days, or ratings that are all alike, or nothing separating the
             pillars yet. The local sentence is only the fallback. */
          <div style={{ ...TYPO.callout, color: T.text2 }}>
            {trend.note ??
              `Zależności policzę po ${MIN_RATED_DAYS} dniach z oceną samopoczucia. Masz ${rated}${
                rated < MIN_RATED_DAYS ? `, brakuje ${MIN_RATED_DAYS - rated}.` : "."
              }`}
          </div>
        )}
      </Card>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        aria-hidden="true"
        style={{ width: 10, height: 10, borderRadius: T.rFull, background: color }}
      />
      <span style={{ ...TYPO.footnote, color: T.text3 }}>{label}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Tab 3: Ustawienia                                                  */
/* ------------------------------------------------------------------ */

interface ComponentDraft {
  target: number | null;
  tolerance: number | null;
  active: boolean;
}

/**
 * Three components store a RULE in `target`, not a goal, so the settings field cannot
 * simply say "Cel (kcal)" - the user would type 2100 where the app expects 300.
 * ENERGIA-SPEC: the calorie row holds the deficit, protein holds grams per kilogram,
 * water holds millilitres per kilogram.
 */
function targetFieldLabel(component: ConfigComponentDTO): string {
  switch (component.key) {
    case CALORIES_COMPONENT_KEY:
      return "Deficyt (kcal na dzień)";
    case PROTEIN_COMPONENT_KEY:
      return "Białko (g na kg masy ciała)";
    case WATER_COMPONENT_KEY:
      return "Woda (ml na kg masy ciała)";
    default:
      return `Cel${component.unit ? ` (${component.unit})` : ""}`;
  }
}

/** One sentence under the field, so the number above it makes sense. */
function targetFieldHint(component: ConfigComponentDTO): string | undefined {
  switch (component.key) {
    case CALORIES_COMPONENT_KEY:
      return `Cel to TDEE minus ten deficyt, liczony codziennie z twojej wagi. Zakres 0 do ${CALORIE_DEFICIT_MAX}.`;
    case PROTEIN_COMPONENT_KEY:
      return "Mnożnik razy twoja aktualna waga. Standard przy redukcji to 2.";
    case WATER_COMPONENT_KEY:
      return "Mnożnik razy twoja aktualna waga. Trening dokłada 500 ml, upał kolejne 500 ml.";
    default:
      return undefined;
  }
}

function SettingsPanel({
  config,
  loading,
  error,
  onRetry,
  onSave,
  saving,
  saveError,
}: {
  config: ConfigPillarDTO[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSave: (payload: ConfigSavePayload) => Promise<boolean>;
  saving: boolean;
  saveError: string | null;
}) {
  /* Only what the USER changed lives in state. Everything else is read straight from
     `config` while rendering. No effect mirrors props into state, so a reload after a
     save cannot race the drafts, and there is no state written during render either
     (React 19 drops that pattern when the parent updates in the same event). */
  const [weightEdits, setWeightEdits] = useState<Record<string, number>>({});
  const [componentEdits, setComponentEdits] = useState<Record<string, ComponentDraft>>({});
  const [openPillar, setOpenPillar] = useState<string | null>(null);

  const weightOf = (pillar: ConfigPillarDTO): number =>
    weightEdits[pillar.key] ?? Math.round(pillar.weight ?? 0);

  const draftOf = (component: ConfigComponentDTO): ComponentDraft =>
    componentEdits[component.key] ?? {
      target: component.target ?? null,
      tolerance: component.tolerance ?? null,
      active: component.active !== false,
    };

  const patchDraft = (component: ConfigComponentDTO, patch: Partial<ComponentDraft>) => {
    const current = draftOf(component);
    setComponentEdits((prev) => ({ ...prev, [component.key]: { ...current, ...patch } }));
  };

  if (loading && !config) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
        <Skeleton variant="block" height={200} radius={20} />
        <Skeleton variant="block" height={200} radius={20} />
      </div>
    );
  }

  if (!config || config.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="⚙️"
          title="Nie udało się wczytać ustawień"
          body={error ?? "Filary nie są jeszcze założone. Otwórz zakładkę Dziś i wróć tutaj."}
          action={{ label: "Spróbuj ponownie", onPress: onRetry }}
        />
      </Card>
    );
  }

  /* Only ACTIVE pillars count, exactly like the server rule. Counting a switched-off
     pillar here would demand a sum the API refuses, and the save button would never
     unlock. */
  const sum = config.reduce(
    (acc, pillar) => acc + (pillar.active === false ? 0 : weightOf(pillar)),
    0,
  );
  const balanced = sum === 100;
  const sumMessage = balanced
    ? "Suma wag: 100% dnia."
    : sum < 100
      ? `Brakuje ${100 - sum} punktów do 100.`
      : `Jest ${sum - 100} punktów za dużo.`;

  const submit = async () => {
    const ok = await onSave({
      pillars: config.map((pillar) => ({ key: pillar.key, weight: weightOf(pillar) })),
      components: config.flatMap((pillar) =>
        (pillar.components ?? []).map((component) => ({
          key: component.key,
          ...draftOf(component),
        })),
      ),
    });
    // The server answered and the parent already refetched the config, so the drafts
    // have nothing left to say. On failure they stay, and the user keeps their work.
    if (ok) {
      setWeightEdits({});
      setComponentEdits({});
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
      <Card>
        <div style={{ ...TYPO.label, color: T.text3, marginBottom: T.sp3 }}>Wagi filarów</div>
        <div style={{ ...TYPO.footnote, color: T.text3, marginBottom: T.sp4 }}>
          Ile procent dnia waży każdy filar. Razem musi wyjść dokładnie 100.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: T.sp4 }}>
          {config.map((pillar) => {
            const weight = weightOf(pillar);
            return (
              <div key={pillar.key}>
                <div style={{ display: "flex", alignItems: "baseline", gap: T.sp2 }}>
                  <span style={{ ...TYPO.callout, color: T.text, flex: 1, minWidth: 0 }}>
                    {pillar.emoji} {pillar.name}
                  </span>
                  <span
                    style={{
                      ...TYPO.bodyBold,
                      color: T.text,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {weight}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={weight}
                  disabled={saving}
                  aria-label={`Waga filaru ${pillar.name} w procentach dnia`}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setWeightEdits((prev) => ({ ...prev, [pillar.key]: next }));
                  }}
                  style={{
                    width: "100%",
                    height: T.tapMin,
                    accentColor: T.primary,
                    background: "transparent",
                    cursor: "pointer",
                  }}
                />
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: T.sp3,
            marginTop: T.sp4,
            padding: T.sp3,
            borderRadius: T.rMd,
            background: balanced ? T.successSoft : T.warningSoft,
            color: balanced ? T.successOnSurface : T.warningOnSurface,
            ...TYPO.footnote,
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{sumMessage}</span>
          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{sum}%</span>
        </div>
      </Card>

      {/* ---- components per pillar ---- */}
      {config.map((pillar) => {
        const open = openPillar === pillar.key;
        return (
          <Card key={pillar.key} padding="none">
            <button
              type="button"
              onClick={() => {
                haptic.tap();
                setOpenPillar((prev) => (prev === pillar.key ? null : pillar.key));
              }}
              aria-expanded={open}
              style={{
                display: "flex",
                alignItems: "center",
                gap: T.sp3,
                width: "100%",
                minHeight: 56,
                padding: T.sp4,
                border: "none",
                background: "transparent",
                color: T.text,
                cursor: "pointer",
                textAlign: "left",
                font: "inherit",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span style={{ ...TYPO.bodyBold, flex: 1, minWidth: 0 }}>
                {pillar.emoji} {pillar.name}
              </span>
              <span style={{ ...TYPO.footnote, color: T.text3 }}>
                {componentCountLabel((pillar.components ?? []).length)}
              </span>
            </button>

            {open ? (
              <div style={{ padding: `0 ${T.sp4} ${T.sp4}` }}>
                {(pillar.components ?? []).map((component) => {
                  const draft = draftOf(component);
                  const decimals = decimalsFor(component);
                  // The protein rule is a multiplier (2 g/kg), so it needs one decimal
                  // place even though its unit ("g") normally means whole numbers.
                  const targetDecimals =
                    component.key === PROTEIN_COMPONENT_KEY ? 1 : decimals;
                  // ENERGIA-SPEC: "Powyżej 500 pokazujemy ostrzeżenie, że to już nie
                  // jest tempo, które da się utrzymać."
                  const deficitTooDeep =
                    component.key === CALORIES_COMPONENT_KEY &&
                    draft.target != null &&
                    draft.target > CALORIE_DEFICIT_WARN;
                  return (
                    <div
                      key={component.key}
                      style={{
                        borderTop: `1px solid ${T.border}`,
                        padding: `${T.sp3} 0`,
                        display: "flex",
                        flexDirection: "column",
                        gap: T.sp3,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: T.sp3 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ ...TYPO.callout, color: T.text, fontWeight: 600 }}>
                            {component.label}
                          </div>
                          <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>
                            waga {Math.round(component.weight ?? 0)}% filaru
                            {isAuto(component) ? " · liczone automatycznie" : ""}
                          </div>
                        </div>
                        <ToggleSwitch
                          checked={draft.active}
                          disabled={saving}
                          ariaLabel={`Składowa aktywna: ${component.label}`}
                          onChange={(next) => patchDraft(component, { active: next })}
                        />
                      </div>

                      {component.kind !== "bool" ? (
                        <div style={{ display: "flex", gap: T.sp3 }}>
                          <Field
                            label={targetFieldLabel(component)}
                            hint={targetFieldHint(component)}
                            style={{ flex: 1, minWidth: 0 }}
                          >
                            {(props) => (
                              <input
                                {...props}
                                type="text"
                                inputMode={targetDecimals > 0 ? "decimal" : "numeric"}
                                disabled={saving}
                                value={
                                  draft.target == null
                                    ? ""
                                    : formatNumber(draft.target, targetDecimals)
                                }
                                onChange={(e) => {
                                  const raw = e.target.value.replace(",", ".").trim();
                                  const parsed = raw === "" ? null : Number(raw);
                                  patchDraft(component, {
                                    target:
                                      parsed == null || !Number.isFinite(parsed) ? null : parsed,
                                  });
                                }}
                                style={fieldControlStyle}
                              />
                            )}
                          </Field>

                          {component.kind === "window" ? (
                            <Field label="Tolerancja" style={{ flex: 1, minWidth: 0 }}>
                              {(props) => (
                                <input
                                  {...props}
                                  type="text"
                                  inputMode={decimals > 0 ? "decimal" : "numeric"}
                                  disabled={saving}
                                  value={
                                    draft.tolerance == null
                                      ? ""
                                      : formatNumber(draft.tolerance, decimals)
                                  }
                                  onChange={(e) => {
                                    const raw = e.target.value.replace(",", ".").trim();
                                    const parsed = raw === "" ? null : Number(raw);
                                    patchDraft(component, {
                                      tolerance:
                                        parsed == null || !Number.isFinite(parsed) ? null : parsed,
                                    });
                                  }}
                                  style={fieldControlStyle}
                                />
                              )}
                            </Field>
                          ) : null}
                        </div>
                      ) : null}

                      {deficitTooDeep ? (
                        <div
                          role="alert"
                          style={{
                            ...TYPO.footnote,
                            color: T.warningOnSurface,
                            background: T.warningSoft,
                            borderRadius: T.rMd,
                            padding: T.sp3,
                          }}
                        >
                          Deficyt powyżej {CALORIE_DEFICIT_WARN} kcal to już nie jest tempo, które
                          da się utrzymać. Schudniesz szybciej, ale oddasz to energią i mięśniami.
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </Card>
        );
      })}

      {saveError ? (
        <div
          role="alert"
          style={{
            padding: T.sp3,
            borderRadius: T.rMd,
            background: T.dangerSoft,
            border: `1px solid ${T.danger}`,
            color: T.dangerOnSurface,
            ...TYPO.footnote,
          }}
        >
          {saveError}
        </div>
      ) : null}

      <Button
        size="lg"
        fullWidth
        disabled={!balanced || saving}
        loading={saving}
        onPress={() => {
          void submit();
        }}
        haptic="impact"
      >
        Zapisz ustawienia
      </Button>

      {!balanced ? (
        <div style={{ ...TYPO.footnote, color: T.text3, textAlign: "center" }}>
          Zapis odblokuje się, gdy wagi filarów dadzą razem 100.
        </div>
      ) : null}
    </div>
  );
}
