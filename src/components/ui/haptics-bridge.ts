"use client";

/**
 * Thin adapter between the UI primitives and `src/lib/haptics`.
 *
 * Why an adapter: the haptics module is owned by another part of stage 1 and can be
 * shaped either as an object (`haptic.tap()`) or as a single function (`haptic("tap")`).
 * This file accepts both, so a primitive never has to care, and a missing or renamed
 * pattern degrades to silence instead of throwing.
 *
 * On iOS (Safari, also as an installed PWA) `navigator.vibrate` does not exist, so every
 * call here is silently a no-op. That is expected: on iPhone the press animation does the work.
 *
 * @example
 * import { fireHaptic } from "./haptics-bridge";
 * fireHaptic("tap");           // on press down
 * fireHaptic("success");       // after a save succeeded
 * fireHaptic(false);           // explicitly silent
 */

import * as hapticsModule from "@/lib/haptics";

/** Pattern names used by the primitives. Extra names from the haptics module still work. */
export type HapticKind =
  | "tap"
  | "select"
  | "selection"
  | "impact"
  | "press"
  | "toggleOn"
  | "toggleOff"
  | "longPress"
  | "send"
  | "success"
  | "warning"
  | "error"
  | "celebrate";

type AnyFn = (...args: unknown[]) => unknown;
type HapticShape = AnyFn & Partial<Record<string, AnyFn>>;

/**
 * Fallback chain per pattern name. First entry that the haptics module actually
 * exposes wins. Today `src/lib/haptics.ts` ships tap / selection / impact / success /
 * warning / error, so e.g. "toggleOn" lands on "impact" instead of going silent.
 */
const ALIASES: Record<string, string[]> = {
  tap: ["tap", "press", "selection", "select"],
  press: ["press", "impact", "tap", "selection"],
  impact: ["impact", "press", "tap"],
  select: ["select", "selection", "tap"],
  selection: ["selection", "select", "tap"],
  toggleOn: ["toggleOn", "impact", "tap"],
  toggleOff: ["toggleOff", "tap", "selection"],
  longPress: ["longPress", "impact", "selection", "tap"],
  send: ["send", "impact", "tap"],
  success: ["success", "impact", "tap"],
  warning: ["warning", "error", "tap"],
  error: ["error", "warning", "tap"],
  celebrate: ["celebrate", "success", "tap"],
};

function getModule(): Record<string, unknown> {
  return hapticsModule as unknown as Record<string, unknown>;
}

/**
 * Fire one haptic pattern. Never throws, safe during SSR, safe when the module
 * exposes a different API shape than expected.
 */
export function fireHaptic(kind: HapticKind | false | undefined | null): void {
  if (!kind) return;
  if (typeof window === "undefined") return;

  try {
    const mod = getModule();
    const entry = (mod.haptic ?? mod.default) as HapticShape | undefined;
    if (!entry) return;

    const names = ALIASES[kind] ?? [kind];

    // Shape A: object with one method per pattern - haptic.tap()
    for (const name of names) {
      const fn = entry[name];
      if (typeof fn === "function") {
        fn.call(entry);
        return;
      }
    }

    // Shape B: single function taking the pattern name - haptic("tap")
    if (typeof entry === "function") {
      entry(names[0]);
    }
  } catch {
    /* haptics are decoration, never let them break an interaction */
  }
}
