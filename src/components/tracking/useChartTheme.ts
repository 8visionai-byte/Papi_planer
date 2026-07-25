"use client";

/**
 * Resolved design-token colours for Recharts.
 *
 * Recharts writes its colours as SVG *presentation attributes* (`fill="..."`,
 * `stroke="..."`), and `var(--token)` is not reliably resolved there (Safari in
 * particular drops it). So instead of shipping hardcoded hex values that turn
 * the charts into white rectangles in the dark theme, we read the real computed
 * values of the tokens and re-read them whenever the theme changes.
 *
 * Implemented as an external store (`useSyncExternalStore`) rather than
 * useState + useEffect: the document's theme really is an external system, the
 * snapshot is cached so React never re-renders in a loop, and the server render
 * gets the dark palette - which is also the app default, so there is no flash
 * of the wrong colours.
 */

import { useSyncExternalStore } from "react";

export interface ChartTheme {
  /** axis labels, muted captions */
  axis: string;
  /** grid / reference lines - decorative only */
  grid: string;
  /** card surface, used by the tooltip */
  surface: string;
  /** one step above the surface: tracks, empty bars */
  surface2: string;
  border: string;
  text: string;
  text2: string;
  /** brand cyan as a FILL (line, area, dot) */
  accent: string;
  /** secondary data hue (blue) */
  accent2: string;
  success: string;
  warning: string;
  danger: string;
}

/** Dark-theme values, verbatim from globals.css. Used on the server and as a fallback. */
const FALLBACK: ChartTheme = {
  axis: "#96A1B0",
  grid: "#5C6675",
  surface: "#141922",
  surface2: "#1D2430",
  border: "rgba(255, 255, 255, 0.07)",
  text: "#F2F6FA",
  text2: "#B6C2D0",
  accent: "#12C2DE",
  accent2: "#6BA8FF",
  success: "#3EE08F",
  warning: "#FFC94A",
  danger: "#FF6B78",
};

const TOKENS: Record<keyof ChartTheme, string> = {
  axis: "--text-3",
  grid: "--text-4",
  surface: "--surface",
  surface2: "--surface-2",
  border: "--border",
  text: "--text",
  text2: "--text-2",
  accent: "--primary",
  accent2: "--accent",
  success: "--success",
  warning: "--warning",
  danger: "--danger",
};

function readTheme(): ChartTheme {
  if (typeof window === "undefined") return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const out = { ...FALLBACK };
  for (const key of Object.keys(TOKENS) as Array<keyof ChartTheme>) {
    const value = cs.getPropertyValue(TOKENS[key]).trim();
    if (value) out[key] = value;
  }
  return out;
}

/* ---------------- external store ---------------- */

let cache: ChartTheme | null = null;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;
let media: MediaQueryList | null = null;

function invalidate() {
  cache = null;
  for (const l of listeners) l();
}

function start() {
  if (typeof window === "undefined") return;
  // The theme switch stamps data-theme on <html>.
  observer = new MutationObserver(invalidate);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class"],
  });
  // data-theme="auto" follows the OS, which can change while the app is open.
  media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", invalidate);
}

function stop() {
  observer?.disconnect();
  observer = null;
  media?.removeEventListener("change", invalidate);
  media = null;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) stop();
  };
}

/** Cached, so React gets a stable reference until the theme actually changes. */
function getSnapshot(): ChartTheme {
  if (cache === null) cache = readTheme();
  return cache;
}

function getServerSnapshot(): ChartTheme {
  return FALLBACK;
}

export function useChartTheme(): ChartTheme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Shared empty-state block for a chart that has no data yet. */
export const chartEmptyStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: 200,
  color: "var(--text-3)",
  fontSize: "var(--fs-callout, 15px)",
  gap: 8,
};
