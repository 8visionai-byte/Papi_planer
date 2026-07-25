/**
 * Theme constants shared by the SERVER (src/app/layout.tsx) and the CLIENT
 * (src/hooks/useTheme.ts).
 *
 * This file deliberately has NO "use client" directive. A server component
 * cannot read a plain value out of a client module — React turns those exports
 * into client references — so the storage key and the anti-flash script must
 * live in a neutral module like this one.
 */

export type Theme = "dark" | "light" | "auto";

/** localStorage key holding the user's choice. */
export const THEME_STORAGE_KEY = "papi.theme";

/** PAPI PLANER ships dark. globals.css puts the dark mapping on plain :root. */
export const DEFAULT_THEME: Theme = "dark";

export const THEMES: readonly Theme[] = ["dark", "light", "auto"] as const;

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * Inlined in <head> so `data-theme` is set BEFORE the first paint — no flash of
 * the wrong theme when the user picked light.
 *
 * Must stay ES5-plain and self-contained: it runs before any bundle, and a
 * syntax error here would block rendering.
 */
export const THEME_INIT_SCRIPT =
  '(function(){try{var t=localStorage.getItem("' +
  THEME_STORAGE_KEY +
  '");if(t!=="dark"&&t!=="light"&&t!=="auto"){t="' +
  DEFAULT_THEME +
  '";}document.documentElement.setAttribute("data-theme",t);}catch(e){' +
  'document.documentElement.setAttribute("data-theme","' +
  DEFAULT_THEME +
  '");}})();';
