"use client";

/**
 * /design-preview — visual direction sampler for the owner.
 *
 * Purpose: the owner opens this on his phone and picks ONE of three colour
 * directions in about 30 seconds. Everything shown here is built from the real
 * primitives (src/components/ui) and the real token names (src/app/globals.css),
 * filled with the real Polish copy of the app, so what he approves is what ships.
 *
 * How the repaint works
 * ---------------------
 * globals.css defines light values on :root and dark values as --dark-* on the
 * same :root, mapped onto the real names only under :root[data-theme="dark"].
 * This page never touches data-theme. Instead it writes a flat map of CSS custom
 * properties (light -> nothing to override, dark -> point every name at its
 * --dark-* twin, magenta -> point the primary family at --brand-*).
 *
 * The map is applied in TWO places on purpose:
 *   1. the preview container  — so the sample repaints instantly, no flash,
 *   2. document.documentElement — because Sheet renders through a portal on
 *      document.body and would otherwise keep the default light palette.
 * Both are cleaned up on unmount, so nothing leaks into the rest of the app.
 *
 * This route is public (see PUBLIC_PATHS in src/middleware.ts) and lives outside
 * the (app) group, so it carries no tab bar and no session.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  Field,
  ListRow,
  Pressable,
  Sheet,
  Skeleton,
  Stat,
  fieldControlStyle,
  MOTION,
  T,
  TYPO,
} from "@/components/ui";
import {
  getHapticsEnabled,
  haptic,
  isHapticsSupported,
  setHapticsEnabled,
} from "@/lib/haptics";

/* ================================================================== */
/*  DIRECTIONS                                                        */
/* ================================================================== */

type Direction = "current" | "noir" | "light";

const DIRECTIONS: { id: Direction; name: string; hint: string; dark: boolean }[] = [
  { id: "current", name: "Obecny", hint: "tak jest dziś", dark: false },
  { id: "noir", name: "Neon Noir", hint: "ciemny", dark: true },
  { id: "light", name: "Neon Light", hint: "jasny", dark: false },
];

/**
 * Dark surfaces. Every value points at a --dark-* token that already exists in
 * globals.css, so this page cannot drift away from the design system.
 */
const DARK_VARS: Record<string, string> = {
  "color-scheme": "dark",
  "--bg": "var(--dark-bg)",
  "--bg-elevated": "var(--dark-bg-elevated)",
  "--surface": "var(--dark-surface)",
  "--surface-2": "var(--dark-surface-2)",
  "--surface-3": "var(--dark-surface-3)",
  "--overlay": "var(--dark-overlay)",
  "--text": "var(--dark-text)",
  "--text-2": "var(--dark-text-2)",
  "--text-3": "var(--dark-text-3)",
  "--text-4": "var(--dark-text-4)",
  "--text-inverse": "var(--dark-text-inverse)",
  "--border": "var(--dark-border)",
  "--border-strong": "var(--dark-border-strong)",
  "--primary": "var(--dark-primary)",
  "--primary-hover": "var(--dark-primary-hover)",
  "--primary-soft": "var(--dark-primary-soft)",
  "--primary-text": "var(--dark-primary-text)",
  "--primary-on-surface": "var(--dark-primary-on-surface)",
  "--accent": "var(--dark-accent)",
  "--accent-soft": "var(--dark-accent-soft)",
  "--accent-on-surface": "var(--dark-accent-on-surface)",
  "--highlight": "var(--dark-highlight)",
  "--highlight-soft": "var(--dark-highlight-soft)",
  "--highlight-on-surface": "var(--dark-highlight-on-surface)",
  "--success": "var(--dark-success)",
  "--success-soft": "var(--dark-success-soft)",
  "--success-on-surface": "var(--dark-success-on-surface)",
  "--warning": "var(--dark-warning)",
  "--warning-soft": "var(--dark-warning-soft)",
  "--warning-on-surface": "var(--dark-warning-on-surface)",
  "--danger": "var(--dark-danger)",
  "--danger-soft": "var(--dark-danger-soft)",
  "--danger-on-surface": "var(--dark-danger-on-surface)",
  "--focus-ring-color": "var(--dark-focus-ring-color)",
  "--focus-ring": "var(--dark-focus-ring)",
  "--elev-0": "var(--dark-elev-0)",
  "--elev-1": "var(--dark-elev-1)",
  "--elev-2": "var(--dark-elev-2)",
  "--elev-3": "var(--dark-elev-3)",
  "--elev-4": "var(--dark-elev-4)",
  "--glow-primary": "var(--dark-glow-primary)",
};

/** Brand magenta on light surfaces — the "BRAND SWITCH" block of globals.css. */
const BRAND_LIGHT_VARS: Record<string, string> = {
  "--primary": "var(--brand-primary)",
  "--primary-hover": "var(--brand-primary-hover)",
  "--primary-soft": "var(--brand-primary-soft)",
  "--primary-text": "var(--brand-primary-text)",
  "--primary-on-surface": "var(--brand-on-surface)",
  "--focus-ring-color": "var(--brand-primary)",
  "--focus-ring": "0 0 0 3px rgba(196, 0, 110, 0.35)",
  "--glow-primary": "var(--brand-glow)",
};

/** Brand magenta on dark surfaces. */
const BRAND_DARK_VARS: Record<string, string> = {
  "--primary": "var(--dark-brand-primary)",
  "--primary-hover": "var(--dark-brand-primary-hover)",
  "--primary-soft": "var(--dark-brand-primary-soft)",
  "--primary-text": "var(--dark-brand-primary-text)",
  "--primary-on-surface": "var(--dark-brand-on-surface)",
  "--focus-ring-color": "var(--dark-brand-primary)",
  "--focus-ring": "0 0 0 3px rgba(255, 45, 149, 0.45)",
  "--glow-primary": "var(--dark-brand-glow)",
};

function buildVars(direction: Direction, dark: boolean): Record<string, string> {
  const surfaces = dark ? DARK_VARS : { "color-scheme": "light" };
  if (direction === "current") return { ...surfaces };
  return { ...surfaces, ...(dark ? BRAND_DARK_VARS : BRAND_LIGHT_VARS) };
}

/* ================================================================== */
/*  SMALL PARTS                                                       */
/* ================================================================== */

/** Section heading + one plain-Polish sentence explaining what to look at. */
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
      <div style={{ ...TYPO.label, color: T.text3 }}>{title}</div>
      {note ? (
        <div style={{ ...TYPO.footnote, color: T.text3, marginTop: -4 }}>{note}</div>
      ) : null}
      {children}
    </section>
  );
}

/** 26 px drawing inside a 44 px target — the size fix, made visible. */
function Checkbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Pressable
      stopPropagation
      onPress={onToggle}
      haptic={checked ? "toggleOff" : "toggleOn"}
      role="checkbox"
      ariaChecked={checked}
      ariaLabel={label}
      style={{ width: 44, height: 44, borderRadius: T.rMd, flexShrink: 0 }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: 9,
          border: checked ? "none" : `2px solid ${T.borderStrong}`,
          background: checked ? T.success : "transparent",
          transition: `background-color ${MOTION.base} ${MOTION.easeSpring}, border-color ${MOTION.instant} linear`,
        }}
      >
        {checked ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={T.textInverse}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ animation: "checkmark 220ms cubic-bezier(0.34, 1.56, 0.64, 1)" }}
          >
            <polyline points="4 12 10 18 20 6" />
          </svg>
        ) : null}
      </span>
    </Pressable>
  );
}

/** iOS-style switch, 52x32 inside a 44 px tall target. */
function Switch({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Pressable
      onPress={onToggle}
      haptic={on ? "toggleOff" : "toggleOn"}
      role="switch"
      ariaChecked={on}
      ariaLabel={label}
      noMinSize
      style={{ width: 52, height: 44, flexShrink: 0 }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          display: "block",
          width: 52,
          height: 32,
          borderRadius: T.rFull,
          background: on ? T.primary : T.surface3,
          transition: `background-color ${MOTION.fast} linear`,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: on ? 23 : 3,
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "#FFFFFF",
            boxShadow: "0 1px 3px rgba(0,0,0,0.28)",
            transition: `left ${MOTION.base} ${MOTION.easeSpring}`,
          }}
        />
      </span>
    </Pressable>
  );
}

/** Ring used by the goal card. */
function ProgressRing({ percent, size = 64 }: { percent: number; size?: number }) {
  const r = size / 2 - 5;
  const circumference = 2 * Math.PI * r;
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.surface3} strokeWidth="5" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={T.primary}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: `stroke-dasharray ${MOTION.celebrate} ${MOTION.easeOut}` }}
        />
      </svg>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          ...TYPO.footnote,
          fontWeight: 700,
          color: T.text,
        }}
      >
        {percent}%
      </span>
    </span>
  );
}

/** Soft status pill (DESIGN-SPEC rule 5: status never gets the full colour). */
function Pill({
  children,
  bg,
  fg,
}: {
  children: React.ReactNode;
  bg: string;
  fg: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: `3px ${T.sp2}`,
        borderRadius: T.rFull,
        background: bg,
        color: fg,
        ...TYPO.footnote,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

/* ================================================================== */
/*  DEMO DATA — the real copy of the app                              */
/* ================================================================== */

type DemoActivity = {
  id: string;
  time: string;
  name: string;
  done: boolean;
  notes?: string;
  durationMin?: number;
  kcal?: number;
};

const INITIAL_ACTIVITIES: DemoActivity[] = [
  { id: "a1", time: "06:30", name: "Poranna rutyna + woda", done: true, durationMin: 15 },
  { id: "a2", time: "07:00", name: "Śniadanie: owsianka z bananem", done: true, kcal: 420 },
  {
    id: "a3",
    time: "09:00",
    name: "Trening siłowy — klatka i barki",
    done: false,
    notes:
      "Rozgrzewka 8 min. Wyciskanie sztangi 4x8, rozpiętki 3x12, wyciskanie żołnierskie 4x10, wznosy bokiem 3x15. Między seriami 90 s przerwy.",
    durationMin: 60,
    kcal: 380,
  },
  { id: "a4", time: "13:00", name: "Obiad: kurczak z ryżem i warzywami", done: false, kcal: 620 },
  { id: "a5", time: "20:30", name: "Czytanie 20 stron", done: false, durationMin: 20 },
];

/* ================================================================== */
/*  PAGE                                                              */
/* ================================================================== */

export default function DesignPreviewPage() {
  const [direction, setDirection] = useState<Direction>("noir");
  const [dark, setDark] = useState(true);
  const [vibrations, setVibrations] = useState(true);
  const [hapticsAvailable, setHapticsAvailable] = useState(true);

  const [activities, setActivities] = useState(INITIAL_ACTIVITIES);
  const [expandedId, setExpandedId] = useState<string | null>("a3");
  const [meetingDone, setMeetingDone] = useState(false);
  const [habitDone, setHabitDone] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [recording, setRecording] = useState(false);

  const vars = useMemo(() => buildVars(direction, dark), [direction, dark]);

  /* Portal-safe repaint: Sheet mounts on document.body, so the palette has to
     live on <html> as well. Everything set here is removed on unmount. */
  useEffect(() => {
    const root = document.documentElement;
    const keys = Object.keys(vars);
    for (const key of keys) root.style.setProperty(key, vars[key]);
    return () => {
      for (const key of keys) root.style.removeProperty(key);
    };
  }, [vars]);

  /* Read the saved haptics preference once mounted (localStorage is not
     available during SSR, so the first render must not depend on it). */
  useEffect(() => {
    setHapticsAvailable(isHapticsSupported());
    setVibrations(getHapticsEnabled());
  }, []);

  const pickDirection = useCallback((d: Direction) => {
    setDirection(d);
    const preset = DIRECTIONS.find((x) => x.id === d);
    if (preset) setDark(preset.dark);
    haptic.selection();
  }, []);

  const toggleVibrations = useCallback(() => {
    setVibrations((prev) => {
      const next = !prev;
      setHapticsEnabled(next);
      return next;
    });
  }, []);

  const toggleActivity = useCallback((id: string) => {
    setActivities((prev) =>
      prev.map((a) => (a.id === id ? { ...a, done: !a.done } : a)),
    );
  }, []);

  const fakeGenerate = useCallback((key: string) => {
    setGenerating(key);
    window.setTimeout(() => {
      setGenerating(null);
      haptic.success();
    }, 1400);
  }, []);

  const doneCount = activities.filter((a) => a.done).length;
  const totalCount = activities.length;
  const percent = Math.round((doneCount / totalCount) * 100);
  const burned = activities.reduce((sum, a) => sum + (a.done && a.kcal ? a.kcal : 0), 0);

  return (
    <div
      style={{
        ...(vars as React.CSSProperties),
        minHeight: "100dvh",
        background: T.bg,
        color: T.text,
        fontFamily: "var(--font-ui)",
        transition: `background-color ${MOTION.base} linear, color ${MOTION.base} linear`,
      }}
    >
      {/* ============================================================ */}
      {/*  STICKY CONTROLS                                             */}
      {/* ============================================================ */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: T.bg,
          borderBottom: `1px solid ${T.border}`,
          boxShadow: T.elev1,
          padding: `calc(${T.sp3} + ${T.safeT}) ${T.sp4} ${T.sp3}`,
        }}
      >
        <div style={{ maxWidth: 430, margin: "0 auto" }}>
          <div style={{ ...TYPO.title3, color: T.text, marginBottom: 2 }}>
            Wybierz wygląd aplikacji
          </div>
          <div style={{ ...TYPO.footnote, color: T.text3, marginBottom: T.sp3 }}>
            Dotknij kafelka. Wszystko niżej od razu zmieni kolory.
          </div>

          {/* direction picker */}
          <div
            role="radiogroup"
            aria-label="Kierunek wizualny"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 6,
            }}
          >
            {DIRECTIONS.map((d) => {
              const active = direction === d.id;
              return (
                <Pressable
                  key={d.id}
                  role="radio"
                  ariaChecked={active}
                  onPress={() => pickDirection(d.id)}
                  haptic={false}
                  press="sm"
                  noMinSize
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                    minHeight: 60,
                    padding: `${T.sp2} 4px`,
                    borderRadius: T.rMd,
                    background: active ? T.primary : T.surface2,
                    color: active ? T.primaryText : T.text2,
                    border: `1px solid ${active ? "transparent" : T.border}`,
                    boxShadow: active ? T.glowPrimary : "none",
                    transition: `background-color ${MOTION.instant} linear, color ${MOTION.instant} linear`,
                  }}
                >
                  <span
                    style={{
                      ...TYPO.footnote,
                      fontWeight: 700,
                      lineHeight: 1.2,
                      textAlign: "center",
                    }}
                  >
                    {d.name}
                  </span>
                  <span style={{ fontSize: 11, opacity: 0.85, lineHeight: 1.2 }}>{d.hint}</span>
                </Pressable>
              );
            })}
          </div>

          {/* light / dark + vibrations */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: T.sp3,
              marginTop: T.sp3,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: T.sp2 }}>
              <span style={{ ...TYPO.footnote, color: T.text2 }}>
                {dark ? "Ciemny" : "Jasny"}
              </span>
              <Switch on={dark} onToggle={() => setDark((v) => !v)} label="Tryb ciemny" />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: T.sp2, marginLeft: "auto" }}>
              <span style={{ ...TYPO.footnote, color: T.text2 }}>Wibracje</span>
              <Switch on={vibrations} onToggle={toggleVibrations} label="Wibracje" />
            </div>
          </div>

          {!hapticsAvailable ? (
            <div style={{ ...TYPO.footnote, color: T.text3, marginTop: T.sp2 }}>
              Ten telefon nie obsługuje wibracji w przeglądarce (iPhone tak ma). Na Androidzie
              poczujesz każde dotknięcie.
            </div>
          ) : null}
        </div>
      </header>

      {/* ============================================================ */}
      {/*  SAMPLE                                                      */}
      {/* ============================================================ */}
      <main
        style={{
          maxWidth: 430,
          margin: "0 auto",
          padding: `${T.sp5} ${T.sp4} calc(${T.sp16} + ${T.safeB})`,
          display: "flex",
          flexDirection: "column",
          gap: T.sp6,
        }}
      >
        {/* ---------- 1. day header ---------- */}
        <Section
          title="Nagłówek dnia"
          note="Większe imię, czytelna data, pasek postępu zamiast samej liczby."
        >
          <Card variant="hero" padding="lg">
            <div style={{ ...TYPO.title1, color: T.text }}>Dzień dobry, Paweł</div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: T.sp2,
                marginTop: 6,
                flexWrap: "wrap",
              }}
            >
              <span style={{ ...TYPO.callout, color: T.text3 }}>piątek, 25 lipca</span>
              <Pill bg={T.primarySoft} fg={T.primaryOnSurface}>
                Dzień roboczy
              </Pill>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: T.sp3,
                marginTop: T.sp4,
              }}
            >
              <div
                style={{
                  flex: 1,
                  height: 10,
                  borderRadius: T.rFull,
                  background: T.surface3,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${percent}%`,
                    height: "100%",
                    borderRadius: T.rFull,
                    background: T.accent,
                    transition: `width ${MOTION.celebrate} ${MOTION.easeOut}`,
                  }}
                />
              </div>
              <span
                style={{
                  ...TYPO.footnote,
                  fontWeight: 700,
                  color: T.text2,
                  flexShrink: 0,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {doneCount}/{totalCount}
              </span>
            </div>
          </Card>
        </Section>

        {/* ---------- 2. plan generation ---------- */}
        <Section
          title="Generowanie planu"
          note="Trzy przyciski na całą szerokość. Każdy ma 56 px wysokości, trafisz kciukiem bez patrzenia."
        >
          <Card padding="md">
            <div style={{ ...TYPO.title3, color: T.text, marginBottom: T.sp3 }}>
              Wygeneruj plan dnia
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
              <Button
                size="lg"
                fullWidth
                haptic="impact"
                loading={generating === "auto"}
                onPress={() => fakeGenerate("auto")}
                iconLeft={<span aria-hidden="true">⚡</span>}
              >
                Wygeneruj automatycznie
              </Button>
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                loading={generating === "input"}
                onPress={() => fakeGenerate("input")}
                iconLeft={<span aria-hidden="true">💬</span>}
              >
                Wygeneruj z wkładem
              </Button>
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                loading={generating === "replan"}
                onPress={() => fakeGenerate("replan")}
                iconLeft={<span aria-hidden="true">🔄</span>}
              >
                Przeplanuj resztę dnia
              </Button>
            </div>
            <div style={{ ...TYPO.footnote, color: T.text3, marginTop: T.sp3 }}>
              {doneCount} ukończonych zostanie zachowanych.
            </div>
          </Card>
        </Section>

        {/* ---------- 3. activity list ---------- */}
        <Section
          title="Plan dnia"
          note="Kwadracik ma 26 px, ale pole dotyku 44 px. Dotknij wiersza, żeby rozwinąć szczegóły."
        >
          <Card padding="sm">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: `${T.sp1} ${T.sp2} ${T.sp2}`,
              }}
            >
              <span style={{ ...TYPO.label, color: T.text3 }}>Przed południem</span>
              <span style={{ ...TYPO.footnote, color: T.text3 }}>{percent}% gotowe</span>
            </div>

            {activities.map((a, i) => (
              <ListRow
                key={a.id}
                divider={i < activities.length - 1}
                done={a.done}
                leading={
                  <Checkbox
                    checked={a.done}
                    onToggle={() => toggleActivity(a.id)}
                    label={a.name}
                  />
                }
                title={a.name}
                subtitle={a.time}
                trailing={
                  a.kcal ? (
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>{a.kcal} kcal</span>
                  ) : undefined
                }
                expandable
                expanded={expandedId === a.id}
                onToggleExpand={() => setExpandedId(expandedId === a.id ? null : a.id)}
              >
                <div
                  style={{
                    borderLeft: `2px solid ${T.primary}`,
                    paddingLeft: T.sp3,
                    marginLeft: T.sp3,
                    display: "flex",
                    flexDirection: "column",
                    gap: T.sp2,
                  }}
                >
                  <div style={{ ...TYPO.callout, color: T.text2, whiteSpace: "pre-wrap" }}>
                    {a.notes ?? "Brak dodatkowych szczegółów"}
                  </div>
                  <div style={{ display: "flex", gap: T.sp2, flexWrap: "wrap" }}>
                    {a.durationMin ? (
                      <Pill bg={T.surface2} fg={T.text2}>
                        ⏱ {a.durationMin} min
                      </Pill>
                    ) : null}
                    {a.kcal ? (
                      <Pill bg={T.successSoft} fg={T.successOnSurface}>
                        🔥 ~{a.kcal} kcal
                      </Pill>
                    ) : null}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onPress={() => fakeGenerate(`plan-${a.id}`)}
                    loading={generating === `plan-${a.id}`}
                  >
                    🧠 Generuj plan z mentorem
                  </Button>
                </div>
              </ListRow>
            ))}
          </Card>
        </Section>

        {/* ---------- 4. calendar meeting ---------- */}
        <Section title="Spotkanie z kalendarza" note="Wyraźnie inny blok niż zwykłe zadanie.">
          <Card padding="sm">
            <div style={{ display: "flex", alignItems: "center", gap: T.sp2 }}>
              <Checkbox
                checked={meetingDone}
                onToggle={() => setMeetingDone((v) => !v)}
                label="Spotkanie: Rozmowa z Marcinem"
              />
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: T.primarySoft,
                  border: `1px solid ${T.primary}`,
                  borderRadius: T.rMd,
                  padding: `${T.sp2} ${T.sp3}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: T.sp2,
                    flexWrap: "wrap",
                    marginBottom: 2,
                  }}
                >
                  <Pill bg={T.primarySoft} fg={T.primaryOnSurface}>
                    📅 Spotkanie
                  </Pill>
                  <span
                    style={{
                      ...TYPO.footnote,
                      fontWeight: 700,
                      color: T.text2,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    11:00–12:00
                  </span>
                </div>
                <div
                  style={{
                    ...TYPO.body,
                    fontWeight: 600,
                    color: T.text,
                    textDecoration: meetingDone ? "line-through" : "none",
                    opacity: meetingDone ? 0.6 : 1,
                  }}
                >
                  Rozmowa z Marcinem — podsumowanie tygodnia
                </div>
              </div>
            </div>
          </Card>
        </Section>

        {/* ---------- 5. stats ---------- */}
        <Section
          title="Statystyki dnia"
          note="Liczby nie skaczą przy zmianie wartości. Jedna duża metryka na ekran, reszta mniejsza."
        >
          <Card padding="md">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: T.sp2,
              }}
            >
              <Stat align="center" size="sm" value="7/10" label="Energia" icon="⚡" tone="warning" />
              <Stat align="center" size="sm" value="Dobry" label="Nastrój" icon="🙂" tone="success" />
              <Stat align="center" size="sm" value="6,5 h" label="Sen" icon="🌙" tone="accent" />
            </div>

            <div
              style={{
                marginTop: T.sp5,
                paddingTop: T.sp4,
                borderTop: `1px solid ${T.border}`,
              }}
            >
              <Stat
                size="hero"
                align="center"
                value={burned}
                unit="kcal"
                label="spalonych dziś (estymacja)"
                tone="danger"
                trend={{ value: "120", direction: "up", good: true, label: "vs. wczoraj" }}
              />
            </div>
          </Card>
        </Section>

        {/* ---------- 6. goal ---------- */}
        <Section title="Cel" note="Kółko postępu i jedna wyraźna akcja.">
          <Card padding="md">
            <div style={{ display: "flex", alignItems: "center", gap: T.sp4 }}>
              <ProgressRing percent={62} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...TYPO.title3, color: T.text }}>Zrzucić 8 kg do końca września</div>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <Pill bg={T.accentSoft} fg={T.accentOnSurface}>
                    🧠 Mentor: Huberman
                  </Pill>
                  <Pill bg={T.highlightSoft} fg={T.highlightOnSurface}>
                    Plan dostępny
                  </Pill>
                </div>
              </div>
            </div>
            <div style={{ marginTop: T.sp4 }}>
              <Button variant="secondary" size="md" fullWidth onPress={() => setSheetOpen(true)}>
                Zaktualizuj postęp
              </Button>
            </div>
          </Card>
        </Section>

        {/* ---------- 7. habit ---------- */}
        <Section title="Nawyk" note="Ten sam wiersz co w planie, tylko z serią dni.">
          <Card padding="sm">
            <ListRow
              minHeight={56}
              done={habitDone}
              leading={
                <Checkbox
                  checked={habitDone}
                  onToggle={() => setHabitDone((v) => !v)}
                  label="Medytacja 10 minut"
                />
              }
              title="Medytacja 10 minut"
              subtitle="Codziennie rano, przed kawą"
              trailing={
                <Pill bg={T.highlightSoft} fg={T.highlightOnSurface}>
                  🔥 12 d
                </Pill>
              }
              onPress={() => setHabitDone((v) => !v)}
            />
          </Card>
        </Section>

        {/* ---------- 8. input bar ---------- */}
        <Section
          title="Szybki wpis"
          note="Mikrofon urósł z 36 px do 48 px. Pole ma 17 px, więc iPhone nie przybliża ekranu przy pisaniu."
        >
          <Card padding="md">
            <Field label="Co słychać?" hint="Możesz napisać albo nagrać głosem.">
              {(p) => (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: T.sp2,
                    background: T.bgElevated,
                    border: `1.5px solid ${recording ? T.danger : T.border}`,
                    borderRadius: T.rFull,
                    padding: `6px 6px 6px ${T.sp4}`,
                    transition: `border-color ${MOTION.fast} linear`,
                  }}
                >
                  <input
                    {...p}
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Powiedz mi jak minął dzień..."
                    style={{
                      ...fieldControlStyle,
                      minHeight: 44,
                      flex: 1,
                      minWidth: 0,
                      padding: 0,
                      border: "none",
                      background: "transparent",
                      borderRadius: 0,
                    }}
                  />
                  <Pressable
                    onPress={() => setRecording((v) => !v)}
                    haptic={recording ? "success" : "impact"}
                    ariaLabel={recording ? "Zatrzymaj nagrywanie" : "Nagraj głos"}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "50%",
                      background: recording ? T.danger : T.primary,
                      color: T.primaryText,
                      flexShrink: 0,
                      boxShadow: recording ? "none" : T.glowPrimary,
                    }}
                  >
                    <MicIcon stop={recording} />
                  </Pressable>
                </div>
              )}
            </Field>

            {recording ? (
              <div
                className="reveal"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: T.sp2,
                  marginTop: T.sp3,
                  ...TYPO.footnote,
                  fontWeight: 600,
                  color: T.dangerOnSurface,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: T.danger,
                    animation: "pulse 1.5s ease-in-out infinite",
                  }}
                />
                Nagrywam...
                <span style={{ fontVariantNumeric: "tabular-nums" }}>0:04</span>
              </div>
            ) : null}
          </Card>
        </Section>

        {/* ---------- 9. sheet ---------- */}
        <Section
          title="Okno z dołu"
          note="Wysuwa się od dołu, zamykasz je zsuwając palcem w dół. Tło pod spodem się nie przewija."
        >
          <Button size="lg" fullWidth variant="secondary" onPress={() => setSheetOpen(true)}>
            Pokaż okno z dołu
          </Button>
        </Section>

        {/* ---------- 10. empty + loading ---------- */}
        <Section
          title="Pusto i ładowanie"
          note="Pusty ekran zawsze mówi, co zrobić dalej. Ładowanie ma kształt tego, co się pojawi."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp3 }}>
            <Card padding="none">
              <EmptyState
                icon="🌱"
                title="Brak nawyków"
                body="Dodaj pierwszy nawyk i zacznij budować rytuał."
                action={{ label: "Dodaj nawyk", onPress: () => setSheetOpen(true) }}
              />
            </Card>
            <Skeleton variant="card" count={3} />
            <Card padding="md">
              <Skeleton variant="list" count={3} />
            </Card>
          </div>
        </Section>

        {/* ---------- 11. before / after ---------- */}
        <Section title="Przed i po" note="Trzy liczby, które robią całą różnicę w odczuciu.">
          <Card padding="md">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto auto",
                gap: `${T.sp3} ${T.sp2}`,
                alignItems: "center",
              }}
            >
              <span style={{ ...TYPO.label, color: T.text3 }}>Co</span>
              <span style={{ ...TYPO.label, color: T.text3, textAlign: "right" }}>Było</span>
              <span style={{ ...TYPO.label, color: T.text3, textAlign: "right" }}>Jest</span>

              <CompareRow what="Przycisk" before="28 px" after="44–56 px" />
              <CompareRow what="Tekst" before="13 px" after="17 px" />
              <CompareRow what="Reakcja na dotyk" before="brak" after="60 ms" />
              <CompareRow what="Wibracja" before="brak" after="jest" />
              <CompareRow what="Za małe przyciski" before="188 z 199" after="0" />
              <CompareRow what="Tryb ciemny" before="brak" after="jest" />
            </div>
          </Card>

          <div style={{ ...TYPO.footnote, color: T.text3, textAlign: "center", marginTop: T.sp2 }}>
            To jest próbka, nie działająca aplikacja. Dane są przykładowe.
          </div>
        </Section>
      </main>

      {/* ============================================================ */}
      {/*  BOTTOM SHEET                                                */}
      {/* ============================================================ */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Zaktualizuj postęp"
        footer={
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
            <Button
              size="lg"
              fullWidth
              haptic="success"
              onPress={() => {
                haptic.success();
                setSheetOpen(false);
              }}
            >
              Zapisz
            </Button>
            <Button variant="ghost" size="md" fullWidth onPress={() => setSheetOpen(false)}>
              Anuluj
            </Button>
          </div>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: T.sp4, paddingBottom: T.sp3 }}>
          <div style={{ ...TYPO.callout, color: T.text2 }}>
            Zrzucić 8 kg do końca września. Dziś jesteś na 62%.
          </div>
          <Field label="Waga dziś" hint="Podaj w kilogramach.">
            {(p) => (
              <input {...p} inputMode="decimal" defaultValue="88,4" style={fieldControlStyle} />
            )}
          </Field>
          <Field label="Krótka notatka">
            {(p) => (
              <input {...p} placeholder="np. tydzień bez cukru" style={fieldControlStyle} />
            )}
          </Field>
        </div>
      </Sheet>
    </div>
  );
}

/* ================================================================== */
/*  ROW OF THE COMPARISON TABLE                                       */
/* ================================================================== */

function CompareRow({
  what,
  before,
  after,
}: {
  what: string;
  before: string;
  after: string;
}) {
  return (
    <>
      <span style={{ ...TYPO.callout, color: T.text }}>{what}</span>
      <span
        style={{
          ...TYPO.footnote,
          color: T.text3,
          textAlign: "right",
          textDecoration: "line-through",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {before}
      </span>
      <span
        style={{
          ...TYPO.footnote,
          fontWeight: 700,
          color: T.successOnSurface,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {after}
      </span>
    </>
  );
}

/* ================================================================== */
/*  ICON                                                              */
/* ================================================================== */

/** Vector mic / stop — replaces the emoji + `filter: brightness(0) invert(1)` hack. */
function MicIcon({ stop }: { stop: boolean }) {
  if (stop) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
    );
  }
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}
