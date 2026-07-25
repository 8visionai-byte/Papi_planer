"use client";

/**
 * Theme switching for PAPI PLANER.
 *
 * The app ships DARK. `globals.css` puts the dark mapping on plain `:root`, so
 * a page with no `data-theme` attribute is already dark and nothing here is
 * required for the default look. This hook only exists so the user can choose
 * something else.
 *
 * Storage: localStorage["papi.theme"] = "dark" | "light" | "auto".
 *   dark  -> forced dark
 *   light -> forced light
 *   auto  -> follows the operating system (handled purely in CSS, see the
 *            `@media (prefers-color-scheme: light)` block in globals.css)
 *
 * No React context is needed: the state lives in a module-level store read
 * through `useSyncExternalStore`, so every component that calls `useTheme()`
 * stays in sync, with or without <ThemeProvider>.
 *
 * The anti-flash script inlined in `src/app/layout.tsx` writes the same
 * attribute before first paint, so there is no light flash on load.
 *
 * @example
 * const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
 * <button onClick={toggleTheme}>{resolvedTheme === "dark" ? "Jasny" : "Ciemny"}</button>
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  isTheme,
  THEME_STORAGE_KEY,
  type Theme,
} from "@/lib/theme-config";

// Re-exported so callers only ever need this one module.
export { DEFAULT_THEME, THEME_STORAGE_KEY, THEME_INIT_SCRIPT } from "@/lib/theme-config";
export type { Theme } from "@/lib/theme-config";

/** What is actually painted right now — "auto" is already resolved. */
export type ResolvedTheme = "dark" | "light";

/* -------------------------------------------------------------------------- */
/* store                                                                      */
/* -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();
let current: Theme = DEFAULT_THEME;
let hydrated = false;

function emit() {
  for (const listener of listeners) listener();
}

/** Reads the stored preference. Safe on the server and with storage disabled. */
export function readStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : DEFAULT_THEME;
  } catch {
    // private mode / storage blocked
    return DEFAULT_THEME;
  }
}

/** Writes `data-theme` on <html>. This is the only DOM side effect. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}

function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  current = readStoredTheme();
  applyTheme(current);
}

function subscribe(listener: () => void): () => void {
  hydrate();
  listeners.add(listener);

  // Keep other tabs and other PWA windows in sync.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    const next = isTheme(event.newValue) ? event.newValue : DEFAULT_THEME;
    if (next === current) return;
    current = next;
    applyTheme(current);
    emit();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): Theme {
  return current;
}

function getServerSnapshot(): Theme {
  return DEFAULT_THEME;
}

/** Sets the theme, persists it and paints it. Safe to call from anywhere. */
export function setThemePreference(theme: Theme): void {
  const next = isTheme(theme) ? theme : DEFAULT_THEME;
  current = next;
  applyTheme(next);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // storage blocked — the attribute is set anyway, it just will not persist
  }
  emit();
}

/** Resolves "auto" against the OS setting. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== "auto") return theme;
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/* -------------------------------------------------------------------------- */
/* hook                                                                       */
/* -------------------------------------------------------------------------- */

export interface UseThemeResult {
  /** The stored preference, including "auto". */
  theme: Theme;
  /** What is painted right now: "dark" or "light". */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** dark -> light -> dark. "auto" jumps to the opposite of what is painted. */
  toggleTheme: () => void;
}

export function useTheme(): UseThemeResult {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme) => setThemePreference(next), []);

  const toggleTheme = useCallback(() => {
    setThemePreference(resolveTheme(current) === "dark" ? "light" : "dark");
  }, []);

  return { theme, resolvedTheme: resolveTheme(theme), setTheme, toggleTheme };
}
