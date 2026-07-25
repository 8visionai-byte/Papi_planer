"use client";

/**
 * Reads `prefers-reduced-motion` and keeps it live.
 *
 * globals.css already neutralises CSS animations for these users, but the motion
 * components also drive transforms from JavaScript, so they need the flag itself.
 *
 * Two shapes on purpose:
 * - `usePrefersReducedMotion()` re-renders when the setting changes (rare).
 *   Built on `useSyncExternalStore`, so the server snapshot is always `false`
 *   and hydration can never mismatch.
 * - `useReducedMotionRef()` gives a ref for hot paths (drag frames, rAF ticks)
 *   where a re-render is not acceptable.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function supported(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function readOnce(): boolean {
  return supported() ? window.matchMedia(QUERY).matches : false;
}

function subscribe(onChange: () => void): () => void {
  if (!supported()) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Re-renders the component when the OS setting flips. `false` during SSR. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, readOnce, () => false);
}

/** Same value as a ref - no re-render, safe to read inside a rAF / pointermove. */
export function useReducedMotionRef(): { readonly current: boolean } {
  const ref = useRef(readOnce());

  useEffect(() => {
    ref.current = readOnce();
    return subscribe(() => {
      ref.current = readOnce();
    });
  }, []);

  return ref;
}

export default usePrefersReducedMotion;
