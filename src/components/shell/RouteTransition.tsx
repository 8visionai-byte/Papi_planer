"use client";

import { useEffect, useRef, useState } from "react";

/** Must match the animation duration of `.route-fade` in globals.css, plus slack. */
const SAFETY_MS = 500;

/**
 * Fade + 10px rise on every screen change.
 *
 * Mount it KEYED BY PATHNAME. A Next.js layout does not remount between routes, so an
 * animation class sitting on <main> only ever plays once, at cold start. Remounting
 * this wrapper is what makes the transition replay on every tab switch.
 *
 * The class is dropped again as soon as the animation finishes, and that is the whole
 * point of the component rather than a plain <div className="route-fade">: an element
 * carrying any transform other than `none` becomes the containing block for its
 * `position: fixed` descendants. `animation-fill-mode: both` keeps the final
 * `translateY(0)` applied indefinitely, which would re-scope every full-screen overlay
 * in the app (12 of them) to the size of the page instead of the viewport. Backdrops
 * would stop covering the screen and bottom sheets would land in the middle of it.
 *
 * @example
 * <RouteTransition key={pathname}>{children}</RouteTransition>
 */
export function RouteTransition({ children }: { children: React.ReactNode }) {
  const [animating, setAnimating] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Safety net: `animationend` never fires if the element is not painted (background
  // tab, reduced-motion edge cases). Without this the transform could stick.
  useEffect(() => {
    timer.current = setTimeout(() => setAnimating(false), SAFETY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div
      className={animating ? "route-fade" : undefined}
      onAnimationEnd={(e) => {
        // animationend bubbles: every .anim-in card inside the page fires one too.
        // Only our own routeIn on our own node is allowed to end the transition.
        if (e.target !== e.currentTarget) return;
        if (e.animationName !== "routeIn") return;
        setAnimating(false);
      }}
    >
      {children}
    </div>
  );
}

export default RouteTransition;
