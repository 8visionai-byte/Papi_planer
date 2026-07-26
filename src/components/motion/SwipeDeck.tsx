"use client";

/**
 * SwipeDeck - the carousel that actually follows your finger.
 *
 * Replaces the hand-rolled dashboard carousel. Three concrete fixes:
 *
 * 1. `touch-action: pan-y` on the viewport. The browser now knows the vertical
 *    axis belongs to the page and the horizontal axis belongs to this deck, so
 *    it stops arbitrating and the first swipe registers. (This alone is most of
 *    the "I have to swipe three or four times".)
 * 2. The track transform is written straight to `style.transform` from the
 *    pointermove handler - no state, no React render per frame, GPU only.
 *    The panel moves WITH the finger instead of jumping after release.
 * 3. Inactive panels keep their real height (the old code set `height: 0`,
 *    which made the page jump on every switch). The viewport animates its own
 *    height to the active panel and only ever GROWS mid-drag, so nothing is
 *    clipped while two panels are visible.
 *
 * @example
 * const [panel, setPanel] = useState(0);
 * <SwipeDeck index={panel} onChange={setPanel} labels={["Plan dnia", "Briefing", "Statystyki"]} showDots>
 *   <PlanDnia />
 *   <Briefing />
 *   <Statystyki />
 * </SwipeDeck>
 */

import React, { useCallback, useEffect, useRef } from "react";
import { useSwipeable } from "@/hooks/useSwipeable";
import { useReducedMotionRef } from "@/hooks/usePrefersReducedMotion";
import { useIsomorphicLayoutEffect } from "@/hooks/useIsomorphicLayoutEffect";
import { haptic } from "@/lib/haptics";
import { T } from "@/components/ui/tokens";

/** Settle animation after release. Mirrors the feel of an iOS pager. */
const SETTLE_MS = 380;
const SETTLE_EASE = "var(--ease-ios, cubic-bezier(0.32, 0.72, 0, 1))";

export interface SwipeDeckProps {
  /** Active panel (controlled). */
  index: number;
  /** Called when the gesture, a dot or the keyboard picks another panel. */
  onChange: (index: number) => void;
  /** One child = one panel. */
  children: React.ReactNode;
  /** Panel names - used for the slide labels and the dot buttons. */
  labels?: readonly string[];
  /** Show the dot indicators under the deck. */
  showDots?: boolean;
  /** Accessible name of the whole carousel. */
  ariaLabel?: string;
  /** Turn the gesture off (e.g. while a sheet is open). Dots still work. */
  enabled?: boolean;
  /** Arrow-key navigation when the deck has focus. Default true. */
  keyboard?: boolean;
  /** Extra breathing room under the tallest panel, in px. */
  heightPadding?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function SwipeDeck({
  index,
  onChange,
  children,
  labels,
  showDots = false,
  ariaLabel = "Karuzela",
  enabled = true,
  keyboard = true,
  heightPadding = 0,
  className,
  style,
}: SwipeDeckProps) {
  const panels = React.Children.toArray(children);
  const count = panels.length;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  /** Index the track is currently resting on / animating to. */
  const currentRef = useRef(index);
  const draggingRef = useRef(false);
  const reduced = useReducedMotionRef();

  const getWidth = useCallback(() => viewportRef.current?.clientWidth ?? 0, []);
  const measure = useCallback(
    (i: number) => (i >= 0 ? (panelRefs.current[i]?.offsetHeight ?? 0) : 0),
    [],
  );

  /** Writes the track transform. `offset` is the live finger delta in px. */
  const applyTransform = useCallback(
    (i: number, offset: number, animate: boolean) => {
      const track = trackRef.current;
      if (!track) return;
      const width = viewportRef.current?.clientWidth ?? 0;
      track.style.transition =
        animate && !reduced.current ? `transform ${SETTLE_MS}ms ${SETTLE_EASE}` : "none";
      track.style.transform = `translate3d(${-i * width + offset}px, 0, 0)`;
    },
    [reduced],
  );

  /** Sets the viewport height. `min` keeps it from shrinking mid-gesture. */
  const applyHeight = useCallback(
    (height: number, animate: boolean) => {
      const viewport = viewportRef.current;
      if (!viewport || height <= 0) return;
      viewport.style.transition =
        animate && !reduced.current ? `height ${SETTLE_MS}ms ${SETTLE_EASE}` : "none";
      viewport.style.height = `${height + heightPadding}px`;
    },
    [heightPadding, reduced],
  );

  const syncHeight = useCallback(
    (animate: boolean) => applyHeight(measure(currentRef.current), animate),
    [applyHeight, measure],
  );

  const { handlers } = useSwipeable({
    count,
    index,
    onIndexChange: onChange,
    getWidth,
    enabled: enabled && count > 1,
    onDragStart: () => {
      draggingRef.current = true;
      const i = currentRef.current;
      // grow to fit whichever neighbour is about to slide in - never clip it
      const tallest = Math.max(measure(i), measure(i - 1), measure(i + 1));
      applyHeight(tallest, false);
      applyTransform(i, 0, false);
      if (trackRef.current) trackRef.current.style.userSelect = "none";
    },
    onDrag: (offset) => applyTransform(currentRef.current, offset, false),
    onDragEnd: (target) => {
      draggingRef.current = false;
      currentRef.current = target;
      applyTransform(target, 0, true);
      syncHeight(true);
      if (trackRef.current) trackRef.current.style.userSelect = "";
    },
  });

  /* Parent changed the index (tab, dot, keyboard) - slide there. */
  useEffect(() => {
    if (index === currentRef.current) return;
    currentRef.current = index;
    applyTransform(index, 0, true);
    syncHeight(true);
  }, [index, applyTransform, syncHeight]);

  /* First paint: lock the geometry before the browser shows the flex row,
     otherwise the deck is briefly as tall as the tallest panel. */
  useIsomorphicLayoutEffect(() => {
    applyTransform(currentRef.current, 0, false);
    syncHeight(false);
  }, [applyTransform, syncHeight]);

  /* Content grows (plan generated, list loaded) or the window is resized. */
  useEffect(() => {
    const resync = () => {
      if (draggingRef.current) return;
      applyTransform(currentRef.current, 0, false);
      syncHeight(false);
    };

    window.addEventListener("resize", resync);
    window.addEventListener("orientationchange", resync);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resync);
      // panels only - observing the viewport we resize ourselves would loop
      for (const el of panelRefs.current) if (el) observer.observe(el);
    }

    return () => {
      window.removeEventListener("resize", resync);
      window.removeEventListener("orientationchange", resync);
      observer?.disconnect();
    };
  }, [count, applyTransform, syncHeight]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(count - 1, next));
      if (clamped === index) return;
      haptic.selection();
      onChange(clamped);
    },
    [count, index, onChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!keyboard || count < 2) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(index + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(index - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        goTo(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goTo(count - 1);
      }
    },
    [keyboard, count, index, goTo],
  );

  return (
    <div
      className={className}
      style={{ width: "100%", ...style }}
      role="group"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={keyboard && count > 1 ? 0 : -1}
      onKeyDown={onKeyDown}
    >
      <div
        ref={viewportRef}
        {...handlers}
        style={{
          position: "relative",
          width: "100%",
          overflow: "hidden",
          // the whole point: vertical belongs to the page, horizontal to us
          touchAction: "pan-y",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <div
          ref={trackRef}
          style={{
            display: "flex",
            alignItems: "flex-start",
            width: "100%",
            willChange: "transform",
            transform: "translate3d(0, 0, 0)",
          }}
        >
          {panels.map((panel, i) => (
            <div
              key={i}
              ref={(el) => {
                panelRefs.current[i] = el;
              }}
              role="group"
              aria-roledescription="slide"
              aria-label={labels?.[i] ?? `${i + 1} z ${count}`}
              inert={i !== index}
              style={{
                flex: "0 0 100%",
                width: "100%",
                minWidth: 0,
                maxWidth: "100%",
                boxSizing: "border-box",
                alignSelf: "flex-start",
              }}
            >
              {panel}
            </div>
          ))}
        </div>
      </div>

      {showDots && count > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 2,
            marginTop: T.sp2,
          }}
        >
          {panels.map((_, i) => {
            const isActive = i === index;
            return (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                aria-label={labels?.[i] ?? `Panel ${i + 1}`}
                aria-current={isActive ? "true" : undefined}
                style={{
                  // 44x44 target around a 6 px dot; never squeezed by flex.
                  // The negative margins let the target keep its full height while
                  // the row still only occupies 32 px, so switching panels by tapping
                  // a dot works with a thumb without moving anything on the screen.
                  width: T.tapMin,
                  height: T.tapMin,
                  marginTop: -6,
                  marginBottom: -6,
                  flex: "0 0 auto",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    display: "block",
                    height: 6,
                    width: isActive ? 22 : 6,
                    borderRadius: T.rFull,
                    background: isActive ? T.primary : T.border,
                    boxShadow: isActive ? T.glowPrimary : "none",
                    transition: `width ${SETTLE_MS}ms ${SETTLE_EASE}, background ${SETTLE_MS}ms ease`,
                  }}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SwipeDeck;
