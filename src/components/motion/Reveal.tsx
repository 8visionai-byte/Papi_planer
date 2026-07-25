"use client";

/**
 * Reveal - content that arrives instead of being already there.
 *
 * Wraps one element, keeps it at `opacity: 0` + `translateY(8px)` until it
 * enters the viewport, then eases it in. Give a list of cards an increasing
 * `index` and they cascade (default 40 ms apart), which is the single cheapest
 * trick that separates "a screen appeared" from "a screen was built for me".
 *
 * - IntersectionObserver, so nothing animates off-screen and long pages stay cheap.
 * - transform + opacity only. No layout property is animated, so it cannot jank.
 * - `prefers-reduced-motion` (and any browser without IntersectionObserver)
 *   renders the content visible straight away.
 *
 * @example
 * {activities.map((a, i) => (
 *   <Reveal key={a.id} index={i}>
 *     <ActivityCard activity={a} />
 *   </Reveal>
 * ))}
 */

import React, { useRef, useState } from "react";
import { useReducedMotionRef } from "@/hooks/usePrefersReducedMotion";
import { useIsomorphicLayoutEffect } from "@/hooks/useIsomorphicLayoutEffect";

const DEFAULT_DURATION = 420;
const DEFAULT_STAGGER = 40;
const DEFAULT_Y = 8;
/** Springy but without overshoot - overshoot on text looks cheap. */
const REVEAL_EASE = "var(--ease-out, cubic-bezier(0.25, 1, 0.5, 1))";

export interface RevealProps {
  children: React.ReactNode;
  /** Position in a list - multiplied by `stagger` to build the cascade. */
  index?: number;
  /** Milliseconds between consecutive items. Default 40. */
  stagger?: number;
  /** Extra delay in ms on top of the stagger. */
  delay?: number;
  /** Travel distance in px. Default 8. Negative slides down. */
  y?: number;
  /** Animation length in ms. Default 420. */
  duration?: number;
  /** Animate every time it scrolls back into view. Default false (once). */
  repeat?: boolean;
  /** Wrapper element. Use "li" inside a list so the markup stays valid. */
  as?: "div" | "li" | "section" | "span";
  className?: string;
  style?: React.CSSProperties;
}

export function Reveal({
  children,
  index = 0,
  stagger = DEFAULT_STAGGER,
  delay = 0,
  y = DEFAULT_Y,
  duration = DEFAULT_DURATION,
  repeat = false,
  as = "div",
  className,
  style,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotionRef();
  const [visible, setVisible] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (reduced.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            if (!repeat) observer.disconnect();
          } else if (repeat) {
            setVisible(false);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [repeat, reduced]);

  const totalDelay = delay + index * stagger;

  const revealStyle: React.CSSProperties = {
    opacity: visible ? 1 : 0,
    transform: visible ? "translate3d(0, 0, 0)" : `translate3d(0, ${y}px, 0)`,
    transition: `opacity ${duration}ms ${REVEAL_EASE} ${totalDelay}ms, transform ${duration}ms ${REVEAL_EASE} ${totalDelay}ms`,
    willChange: visible ? "auto" : "opacity, transform",
    ...style,
  };

  const Tag = as as React.ElementType;
  return (
    <Tag ref={ref} className={className} style={revealStyle}>
      {children}
    </Tag>
  );
}

export default Reveal;
