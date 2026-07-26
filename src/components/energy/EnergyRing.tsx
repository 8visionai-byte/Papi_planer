"use client";

/**
 * EnergyRing - the one number of PAPI PLANER: today's energy, 0-100%.
 *
 * One component, two jobs: the hero of `/energy` (size 200+) and the small ring on the
 * dashboard (size ~56). Everything scales off `size`, so the caller only picks a number.
 *
 * Implementation notes:
 * - the arc is a stroked circle driven by `stroke-dashoffset`. The offset is written to
 *   the DOM in an effect, one frame after the first paint, so the browser has a "before"
 *   value and really animates instead of snapping.
 * - colours are set through the inline CSS `stroke` property, never as an SVG
 *   presentation attribute: `var(--token)` is unreliable in attributes (Safari drops it),
 *   but resolves normally in a CSS property.
 * - `prefers-reduced-motion` skips the drawing animation completely.
 */

import React, { useEffect, useRef } from "react";
import { AnimatedNumber } from "@/components/motion";
import { useReducedMotionRef } from "@/hooks/usePrefersReducedMotion";
import { T, TYPO, MOTION } from "@/components/ui";

/** Draw duration of the arc. Slightly longer than the counter, so both land together. */
const DRAW_MS = 900;

/**
 * Score colour. The only three tiers in the app, tokens only:
 * below 40% danger, 40-69% warning, 70%+ success.
 */
export function energyColor(percent: number): string {
  if (percent >= 70) return T.success;
  if (percent >= 40) return T.warning;
  return T.danger;
}

/** Same tiers as text on a surface (contrast corrected variants). */
export function energyTextColor(percent: number): string {
  if (percent >= 70) return T.successOnSurface;
  if (percent >= 40) return T.warningOnSurface;
  return T.dangerOnSurface;
}

export interface EnergyRingProps {
  /** 0-100. Values outside the range are clamped. */
  value: number;
  /** Outer diameter in px. Default 200 (hero). ~56 works as a tab-bar / header ring. */
  size?: number;
  /** Small caption under the number. Hidden automatically on small rings. */
  caption?: string;
  /** Count the number up on mount. Default true. */
  animate?: boolean;
  /** Overrides the generated screen-reader sentence. */
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function EnergyRing({
  value,
  size = 200,
  caption,
  animate = true,
  ariaLabel,
  className,
  style,
}: EnergyRingProps) {
  const percent = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const rounded = Math.round(percent);

  const stroke = Math.max(4, Math.round(size * 0.075));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);

  const arcRef = useRef<SVGCircleElement | null>(null);
  const paintedRef = useRef(false);
  const reduced = useReducedMotionRef();

  useEffect(() => {
    const arc = arcRef.current;
    if (!arc) return;

    const settle = () => {
      arc.style.transition = `stroke-dashoffset ${DRAW_MS}ms ${MOTION.easeOut}, stroke ${MOTION.base} linear`;
      arc.style.strokeDashoffset = String(offset);
    };

    if (reduced.current || !animate) {
      arc.style.transition = "none";
      arc.style.strokeDashoffset = String(offset);
      paintedRef.current = true;
      return;
    }

    if (!paintedRef.current) {
      // first mount: the JSX painted an empty ring, draw it on the next frame
      paintedRef.current = true;
      const raf = requestAnimationFrame(settle);
      return () => cancelAnimationFrame(raf);
    }

    settle();
  }, [offset, animate, reduced]);

  const numberStyle: React.CSSProperties =
    size >= 150 ? TYPO.display : size >= 96 ? TYPO.metric : size >= 64 ? TYPO.title2 : TYPO.footnote;
  const showCaption = Boolean(caption) && size >= 120;

  return (
    <div
      className={className}
      role="img"
      aria-label={ariaLabel ?? `Energia dnia ${rounded} procent`}
      style={{
        position: "relative",
        width: size,
        height: size,
        flex: "0 0 auto",
        ...style,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        // rotate so the arc starts at 12 o'clock; a CSS transform, not an attribute
        style={{ display: "block", transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          style={{ stroke: T.surface3, strokeWidth: stroke }}
        />
        <circle
          ref={arcRef}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          style={{
            stroke: energyColor(percent),
            strokeWidth: stroke,
            strokeLinecap: "round",
            strokeDasharray: circumference,
            // starts empty; the effect above draws it one frame later
            strokeDashoffset: circumference,
          }}
        />
      </svg>

      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: showCaption ? 2 : 0,
          padding: stroke,
          boxSizing: "border-box",
        }}
      >
        <AnimatedNumber
          value={rounded}
          suffix="%"
          duration={animate ? DRAW_MS : 0}
          animateOnMount={animate}
          style={{ ...numberStyle, color: T.text }}
        />
        {showCaption ? (
          <span style={{ ...TYPO.footnote, color: T.text3, textAlign: "center" }}>{caption}</span>
        ) : null}
      </div>
    </div>
  );
}

export default EnergyRing;
