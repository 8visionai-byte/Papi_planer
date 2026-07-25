"use client";

/**
 * SegmentedTabs - tabs you can swipe, with an indicator that slides.
 *
 * Upgrade path from `BigTabs`: same props (`tabs` / `active` / `onChange`), so a
 * screen can swap the import and get four things for free:
 *
 * - one pill that MOVES between segments (transform + width, GPU) instead of
 *   every button repainting its own background,
 * - the indicator follows the finger while you drag across the bar, so the tab
 *   strip feels attached to the deck underneath it,
 * - three text tiers: active is full contrast and heavier, inactive is muted,
 * - a 44 px minimum height, scroll-with-centering once there are more than three
 *   tabs, and full keyboard support (arrows / Home / End).
 *
 * @example
 * <SegmentedTabs
 *   tabs={[{ key: "0", label: "Plan dnia" }, { key: "1", label: "Briefing" }, { key: "2", label: "Statystyki" }]}
 *   active={String(panel)}
 *   onChange={(k) => setPanel(Number(k))}
 * />
 */

import React, { useCallback, useMemo, useRef } from "react";
import { useSwipeable } from "@/hooks/useSwipeable";
import { useReducedMotionRef } from "@/hooks/usePrefersReducedMotion";
import { useIsomorphicLayoutEffect } from "@/hooks/useIsomorphicLayoutEffect";
import { haptic } from "@/lib/haptics";
import { T } from "@/components/ui/tokens";

const MOVE_MS = 320;
const MOVE_EASE = "var(--ease-ios, cubic-bezier(0.32, 0.72, 0, 1))";
/** More tabs than this and the bar scrolls instead of squeezing. */
const SCROLL_AFTER = 3;
/** Padding between the bar edge and the pills. */
const BAR_PAD = 4;

export interface SegmentedTab<T extends string = string> {
  key: T;
  label: string;
  /** Optional trailing counter / dot. Kept small and muted. */
  badge?: React.ReactNode;
}

export interface SegmentedTabsProps<T extends string = string> {
  tabs: ReadonlyArray<SegmentedTab<T>>;
  active: T;
  onChange: (key: T) => void;
  /** "pills" = floating card indicator, "underline" = 3 px bar. */
  variant?: "pills" | "underline";
  /** Drag across the bar to change tab. Off automatically when the bar scrolls. */
  swipeable?: boolean;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function SegmentedTabs<T extends string = string>({
  tabs,
  active,
  onChange,
  variant = "pills",
  swipeable = true,
  ariaLabel = "Zakładki",
  className,
  style,
}: SegmentedTabsProps<T>) {
  const count = tabs.length;
  const activeIndex = Math.max(
    0,
    tabs.findIndex((t) => t.key === active),
  );
  const scrollable = count > SCROLL_AFTER;
  const canSwipe = swipeable && !scrollable && count > 1;

  const barRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mountedRef = useRef(false);
  const reduced = useReducedMotionRef();

  /** Places the indicator under button `i`, optionally blended towards `to`. */
  const place = useCallback(
    (i: number, animate: boolean, to?: number, progress = 0) => {
      const indicator = indicatorRef.current;
      const from = btnRefs.current[i];
      if (!indicator || !from) return;

      let left = from.offsetLeft;
      let width = from.offsetWidth;

      const target = to !== undefined ? btnRefs.current[to] : null;
      if (target && progress > 0) {
        const p = Math.max(0, Math.min(1, progress));
        left = from.offsetLeft + (target.offsetLeft - from.offsetLeft) * p;
        width = from.offsetWidth + (target.offsetWidth - from.offsetWidth) * p;
      }

      indicator.style.transition =
        animate && !reduced.current
          ? `transform ${MOVE_MS}ms ${MOVE_EASE}, width ${MOVE_MS}ms ${MOVE_EASE}`
          : "none";
      indicator.style.transform = `translate3d(${left}px, 0, 0)`;
      indicator.style.width = `${width}px`;
      indicator.style.opacity = "1";
    },
    [reduced],
  );

  const centerActive = useCallback(
    (animate: boolean) => {
      const bar = barRef.current;
      const btn = btnRefs.current[activeIndex];
      if (!bar || !btn || !scrollable) return;
      bar.scrollTo({
        left: btn.offsetLeft - (bar.clientWidth - btn.offsetWidth) / 2,
        behavior: animate && !reduced.current ? "smooth" : "auto",
      });
    },
    [activeIndex, scrollable, reduced],
  );

  /* Measure after every commit: label weight changes width, so this has to run
     once React has painted the new bold / regular text. */
  useIsomorphicLayoutEffect(() => {
    place(activeIndex, mountedRef.current);
    centerActive(mountedRef.current);
    mountedRef.current = true;
  }, [activeIndex, count, place, centerActive]);

  /* Container width changes (rotation, sheet opening) move every button. */
  useIsomorphicLayoutEffect(() => {
    const resync = () => {
      place(activeIndex, false);
      centerActive(false);
    };
    window.addEventListener("resize", resync);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && barRef.current) {
      observer = new ResizeObserver(resync);
      observer.observe(barRef.current);
    }
    return () => {
      window.removeEventListener("resize", resync);
      observer?.disconnect();
    };
  }, [activeIndex, place, centerActive]);

  const select = useCallback(
    (i: number, withHaptic = true) => {
      const next = tabs[Math.max(0, Math.min(count - 1, i))];
      if (!next || next.key === active) return;
      if (withHaptic) haptic.selection();
      onChange(next.key);
    },
    [tabs, count, active, onChange],
  );

  const { handlers } = useSwipeable({
    count,
    index: activeIndex,
    onIndexChange: (next) => select(next, false), // the hook already buzzed
    getWidth: () => barRef.current?.clientWidth ?? 0,
    enabled: canSwipe,
    // a tab strip is small, so ask for less travel than a full-width deck
    distanceRatio: 0.18,
    onDragStart: () => place(activeIndex, false),
    onDrag: (offset) => {
      const width = barRef.current?.clientWidth ?? 1;
      const direction = offset < 0 ? 1 : -1;
      const to = Math.max(0, Math.min(count - 1, activeIndex + direction));
      place(activeIndex, false, to, Math.abs(offset) / width);
    },
    onDragEnd: (target) => place(target, true),
  });

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (count < 2) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        select(activeIndex + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        select(activeIndex - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        select(0);
      } else if (e.key === "End") {
        e.preventDefault();
        select(count - 1);
      }
    },
    [count, activeIndex, select],
  );

  const isPills = variant === "pills";

  const barStyle: React.CSSProperties = useMemo(
    () => ({
      position: "relative",
      display: "flex",
      alignItems: "stretch",
      gap: isPills ? 2 : 0,
      padding: isPills ? BAR_PAD : 0,
      borderRadius: isPills ? T.rLg : 0,
      background: isPills ? T.surface2 : "transparent",
      borderBottom: isPills ? undefined : `1px solid ${T.border}`,
      overflowX: scrollable ? "auto" : "hidden",
      overflowY: "hidden",
      scrollbarWidth: "none",
      WebkitOverflowScrolling: "touch",
      // pan-y: the page keeps the vertical axis, we take the horizontal one.
      // When the bar itself scrolls, hand both axes back to the browser.
      touchAction: canSwipe ? "pan-y" : "auto",
      WebkitTapHighlightColor: "transparent",
      ...style,
    }),
    [isPills, scrollable, canSwipe, style],
  );

  const indicatorStyle: React.CSSProperties = isPills
    ? {
        position: "absolute",
        left: 0,
        top: BAR_PAD,
        bottom: BAR_PAD,
        borderRadius: `calc(${T.rLg} - ${BAR_PAD}px)`,
        background: T.surface,
        boxShadow: `${T.elev1}, ${T.glowPrimary}`,
        pointerEvents: "none",
        opacity: 0,
        willChange: "transform, width",
      }
    : {
        position: "absolute",
        left: 0,
        bottom: 0,
        height: 3,
        borderRadius: T.rFull,
        background: T.primary,
        boxShadow: T.glowPrimary,
        pointerEvents: "none",
        opacity: 0,
        willChange: "transform, width",
      };

  return (
    <div
      ref={barRef}
      className={className}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      {...(canSwipe ? handlers : {})}
      style={barStyle}
    >
      <span aria-hidden="true" ref={indicatorRef} style={indicatorStyle} />

      {tabs.map((tab, i) => {
        const isActive = i === activeIndex;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => select(i)}
            style={{
              position: "relative",
              zIndex: 1,
              flex: scrollable ? "0 0 auto" : "1 1 0",
              minWidth: scrollable ? undefined : 0,
              minHeight: T.tapMin,
              padding: scrollable ? "0 18px" : "0 12px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              border: "none",
              background: "transparent",
              borderRadius: T.rMd,
              color: isActive ? T.text : T.text3,
              fontSize: "var(--fs-callout, 15px)",
              fontWeight: isActive ? 700 : 600,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
              transition: `color ${MOVE_MS}ms ease`,
            }}
          >
            {tab.label}
            {tab.badge !== undefined && (
              <span style={{ color: T.text3, fontWeight: 600, fontSize: "var(--fs-footnote, 13px)" }}>
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedTabs;
