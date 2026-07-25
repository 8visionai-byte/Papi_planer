"use client";

/**
 * AnimatedNumber - a metric that counts up instead of snapping.
 *
 * Numbers are the heroes of this app (kcal, kroki, kilogramy, procent planu).
 * A number that jumps from 0 to 2570 reads as a table cell; a number that runs
 * up to 2570 in 600 ms reads as a product.
 *
 * Implementation notes:
 * - requestAnimationFrame writes `textContent` on a ref. React never re-renders
 *   during the animation, so a screen full of metrics stays cheap.
 * - the span React renders is frozen at first render (`initialText`), which is
 *   why a later `value` change cannot flash the final number before the
 *   animation starts.
 * - `tabular-nums`, so the digits do not wobble while counting.
 * - default formatting is deterministic (`toFixed`), never `toLocaleString`,
 *   so server and client HTML always match.
 * - `prefers-reduced-motion` sets the value with no animation at all.
 *
 * @example
 * <AnimatedNumber value={2570} unit="kcal" style={TYPO.metric} />
 * <AnimatedNumber value={completionPct} suffix="%" duration={800} />
 */

import React, { useCallback, useRef, useState } from "react";
import { useReducedMotionRef } from "@/hooks/usePrefersReducedMotion";
import { useIsomorphicLayoutEffect } from "@/hooks/useIsomorphicLayoutEffect";
import { T } from "@/components/ui/tokens";

const DEFAULT_DURATION = 600;

export interface AnimatedNumberProps {
  value: number;
  /** Animation length in ms. Default 600. */
  duration?: number;
  /** Decimal places for the default formatter. Default 0. */
  decimals?: number;
  /** Custom formatter. Must be deterministic (no locale) to stay SSR-safe. */
  format?: (value: number) => string;
  /** Small muted unit rendered next to the number ("kcal", "kg", "kroków"). */
  unit?: string;
  /** Glued to the number, no space ("%", "zł"). */
  suffix?: string;
  /** Glued in front of the number ("+", "-"). */
  prefix?: string;
  /** Count up from 0 on first paint. Default true. */
  animateOnMount?: boolean;
  className?: string;
  style?: React.CSSProperties;
  unitStyle?: React.CSSProperties;
}

/** Ease-out cubic: fast start, soft landing - the shape a counter should have. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function AnimatedNumber({
  value,
  duration = DEFAULT_DURATION,
  decimals = 0,
  format,
  unit,
  suffix,
  prefix,
  animateOnMount = true,
  className,
  style,
  unitStyle,
}: AnimatedNumberProps) {
  const nodeRef = useRef<HTMLSpanElement | null>(null);
  const rafRef = useRef<number | null>(null);
  /** Number currently painted in the DOM. */
  const shownRef = useRef(animateOnMount ? 0 : value);
  const reduced = useReducedMotionRef();

  /* `format` lives in a ref so an inline arrow prop cannot restart the
     animation on every parent render. Synced in a layout effect, never during
     render. */
  const formatRef = useRef(format);
  useIsomorphicLayoutEffect(() => {
    formatRef.current = format;
  });

  const toText = useCallback(
    (n: number) => {
      const fmt = formatRef.current;
      const body = fmt ? fmt(n) : n.toFixed(decimals);
      return `${prefix ?? ""}${body}${suffix ?? ""}`;
    },
    [decimals, prefix, suffix],
  );

  /* Frozen at first render: React paints this once and never touches the text
     again, so a value change cannot flash the final number before the count-up
     starts. Everything after mount is written by the effect below. */
  const [initialText] = useState(() => {
    const start = animateOnMount ? 0 : value;
    const body = format ? format(start) : start.toFixed(decimals);
    return `${prefix ?? ""}${body}${suffix ?? ""}`;
  });

  useIsomorphicLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;

    // shownRef starts at 0 (count up on mount) or at `value` (no mount animation)
    const from = shownRef.current;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const distance = value - from;
    // A hidden tab freezes requestAnimationFrame, so a counter started there
    // would sit at 0 until the tab is shown again. Paint the real value instead.
    const frozen = typeof document !== "undefined" && document.hidden;
    if (reduced.current || frozen || duration <= 0 || distance === 0) {
      shownRef.current = value;
      node.textContent = toText(value);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const current = from + distance * easeOut(progress);
      shownRef.current = current;
      node.textContent = toText(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
        shownRef.current = value;
        node.textContent = toText(value);
      }
    };
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, duration, toText, animateOnMount, reduced]);

  return (
    <span
      className={className}
      style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", ...style }}
    >
      {/* content is owned by the effect above - React must not touch it again */}
      <span ref={nodeRef} suppressHydrationWarning>
        {initialText}
      </span>
      {unit && (
        <span
          style={{
            marginLeft: 4,
            fontSize: "0.42em",
            fontWeight: 600,
            letterSpacing: "0.01em",
            color: T.text3,
            ...unitStyle,
          }}
        >
          {unit}
        </span>
      )}
    </span>
  );
}

export default AnimatedNumber;
