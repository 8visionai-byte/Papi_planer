"use client";

/**
 * Haptics for PAPI PLANER.
 *
 * Android / Chrome: uses the Vibration API (navigator.vibrate).
 * iOS Safari: has NO Vibration API - every call is a silent no-op.
 *
 * Rules baked in here:
 * - never throws (safe on SSR, safe in private mode, safe on iOS)
 * - never fires while the document is hidden (no buzzing in background tabs)
 * - rate limited by MIN_GAP_MS so fast tapping through a list does not turn
 *   the phone into a buzzer
 * - user can switch it off; the choice lives in localStorage
 *
 * Usage in components (fire on touch, NOT after the server responds):
 *   import { haptic } from "@/lib/haptics";
 *   haptic.tap();
 */

/** Vibration patterns in milliseconds. Number = single pulse, array = pulse/pause/pulse. */
const PATTERNS = {
  /** light tap: pressing a tile, checking something off */
  tap: 8,
  /** selection change: switching a tab or a panel */
  selection: 12,
  /** firmer press: primary button, start/stop recording */
  impact: 16,
  /** operation finished well (plan generated, saved) */
  success: [14, 40, 22],
  /** heads-up, something needs attention */
  warning: [18, 55, 18],
  /** operation failed */
  error: [34, 55, 34],
} as const satisfies Record<string, number | readonly number[]>;

export type HapticKind = keyof typeof PATTERNS;

const STORAGE_KEY = "papi.haptics";
/** Anti-buzz guard: ignore any pattern requested sooner than this after the previous one. */
const MIN_GAP_MS = 40;

let lastAt = 0;
/** null = not read from storage yet */
let cachedEnabled: boolean | null = null;

/** True only where the Vibration API actually exists (Android Chrome, Firefox). */
export function isHapticsSupported(): boolean {
  return (
    typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
  );
}

/** Reads the user preference. Defaults to ON when nothing was ever saved. */
export function getHapticsEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof window === "undefined") return false;
  try {
    cachedEnabled = window.localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    // private mode / storage blocked - assume ON, it is only a vibration
    cachedEnabled = true;
  }
  return cachedEnabled;
}

/** Persists the user preference and gives immediate feedback when turning it on. */
export function setHapticsEnabled(enabled: boolean): void {
  cachedEnabled = enabled;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch {
      // private mode - the setting simply will not survive a reload
    }
  }
  if (enabled) {
    // bypass the rate limiter so the confirmation buzz is never swallowed
    lastAt = 0;
    fire("success");
  }
}

/** Single code path for every pattern. Returns true only if the device really vibrated. */
function fire(kind: HapticKind): boolean {
  if (!isHapticsSupported()) return false;
  if (!getHapticsEnabled()) return false;
  if (typeof document !== "undefined" && document.hidden) return false;

  const now = Date.now();
  if (now - lastAt < MIN_GAP_MS) return false;
  lastAt = now;

  try {
    const pattern = PATTERNS[kind];
    return navigator.vibrate(
      typeof pattern === "number" ? pattern : [...pattern]
    );
  } catch {
    return false;
  }
}

/** Cancels an ongoing vibration (e.g. when a screen unmounts). */
export function stopHaptics(): void {
  if (!isHapticsSupported()) return;
  try {
    navigator.vibrate(0);
  } catch {
    // ignore
  }
}

/** The only thing components import. */
export const haptic = {
  /** light tap - ordinary touch, checkbox, tile */
  tap: () => fire("tap"),
  /** switching a tab / segmented control */
  selection: () => fire("selection"),
  /** firmer press - primary action, start/stop recording */
  impact: () => fire("impact"),
  /** something completed successfully */
  success: () => fire("success"),
  /** something needs the user's attention */
  warning: () => fire("warning"),
  /** something failed */
  error: () => fire("error"),
  /** escape hatch when the pattern name is dynamic */
  trigger: (kind: HapticKind) => fire(kind),
};

export default haptic;
