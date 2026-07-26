"use client";

/**
 * useSwipeable - one horizontal drag gesture, done properly.
 *
 * Why this exists: the dashboard carousel used touch events, only stored a
 * direction flag and compared `delta > 50px` on touchend. The panel never
 * followed the finger (transform came from state only) and the container had no
 * `touch-action`, so the browser kept fighting the vertical scroll. Result:
 * "I have to swipe three or four times, or it does not work at all".
 *
 * What this hook does differently:
 * - Pointer Events, so the exact same code path serves touch, pen and mouse.
 * - The axis is decided ONCE, after ~9 px, with hysteresis (horizontal has to
 *   beat vertical by 20% to win). A vertical gesture is handed straight back to
 *   the scroller and never revisited for that pointer.
 * - `setPointerCapture` only AFTER the horizontal lock, so a vertical scroll is
 *   never stolen from the page. The capture is released on EVERY exit - pointerup,
 *   cancel, a pointerup that only window sees, and unmount mid-drag - because a
 *   capture left on a dead node routes every later event in the document to it and
 *   the whole app stops responding to taps and scrolling.
 * - It reports the live offset through a callback, never through state, so the
 *   consumer can write `style.transform` directly and stay at 60 fps.
 * - Release decides by distance OR velocity: a fast flick switches panels even
 *   when the finger barely moved. That flick is what makes a carousel feel
 *   native.
 * - Rubber-band resistance past the first / last panel.
 * - `haptic.selection()` fires the moment the panel actually changes.
 *
 * The hook itself is view-agnostic: it knows a count, an index and a width.
 * SwipeDeck and SegmentedTabs both drive their transforms from it.
 *
 * @example
 * const { handlers } = useSwipeable({
 *   count: 3,
 *   index,
 *   onIndexChange: setIndex,
 *   getWidth: () => viewportRef.current?.clientWidth ?? 0,
 *   onDrag: (offset) => { trackRef.current!.style.transform = `translate3d(${-index * w + offset}px,0,0)`; },
 * });
 * <div {...handlers} style={{ touchAction: "pan-y", overflow: "hidden" }} />
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import { haptic } from "@/lib/haptics";
import { useIsomorphicLayoutEffect } from "@/hooks/useIsomorphicLayoutEffect";

/** Travel in px before the gesture commits to an axis. Below this nothing moves. */
const DIRECTION_LOCK_PX = 9;
/** Horizontal has to beat vertical by this factor to take the gesture. */
const AXIS_HYSTERESIS = 1.2;
/** Slow drag: share of the container width that counts as "far enough". */
const DEFAULT_DISTANCE_RATIO = 0.25;
/** px/ms. A flick at least this fast switches panels regardless of distance. */
const DEFAULT_VELOCITY = 0.35;
/** Multiplier applied while dragging past the first / last panel. */
const DEFAULT_RESISTANCE = 0.35;
/** Weight of the newest velocity sample (the rest keeps the previous value). */
const VELOCITY_SMOOTHING = 0.7;
/** A flick under this many px is treated as a tap, never as a panel change. */
const MIN_FLICK_PX = 6;

export interface UseSwipeableOptions {
  /** How many panels / tabs exist. Below 2 the gesture is inert. */
  count: number;
  /** Currently active index (controlled by the parent). */
  index: number;
  /** Called when the gesture decided on a different index. */
  onIndexChange: (next: number) => void;
  /** Width the thresholds are measured against - usually the viewport width. */
  getWidth: () => number;
  /** Fired once, at the moment the gesture locks horizontally. */
  onDragStart?: () => void;
  /** Live offset in px (already rubber-banded). Do NOT call setState from here. */
  onDrag?: (offset: number) => void;
  /** Fired on release with the index we are settling on. */
  onDragEnd?: (target: number, changed: boolean) => void;
  /** Set false to switch the gesture off (loading, single panel, modal open). */
  enabled?: boolean;
  /** Set false to stay silent on panel change. */
  haptics?: boolean;
  /** Override the 25% distance threshold. */
  distanceRatio?: number;
  /** Override the 0.35 px/ms flick threshold. */
  velocityThreshold?: number;
  /** Override the 0.35 edge resistance. */
  resistance?: number;
}

export interface SwipeableHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => void;
  /** Swallows the click that a browser fires after a drag over a button. */
  onClickCapture: (e: ReactMouseEvent<HTMLElement>) => void;
}

export interface UseSwipeableResult {
  /** Spread onto the element that owns the gesture. */
  handlers: SwipeableHandlers;
  /** Live drag offset in px. 0 when idle. */
  getOffset: () => number;
  /** True between the axis lock and the release. */
  isDragging: () => boolean;
}

interface DragState {
  pointerId: number;
  /** pointer is down and still ours */
  active: boolean;
  axis: null | "x" | "y";
  startX: number;
  startY: number;
  lastX: number;
  lastT: number;
  velocity: number;
  offset: number;
  target: HTMLElement | null;
  /** a real drag happened, so the next click is not a tap */
  swallowClick: boolean;
}

function createState(): DragState {
  return {
    pointerId: -1,
    active: false,
    axis: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastT: 0,
    velocity: 0,
    offset: 0,
    target: null,
    swallowClick: false,
  };
}

/**
 * Hands the pointer back to the browser.
 *
 * A capture that is never released is the worst failure this hook can produce: every
 * later pointer event in the whole document is routed to one dead element, so the page
 * stops scrolling and nothing else can be tapped. That is exactly the "I click something
 * and then I cannot do anything" report. Both call sites below are therefore
 * unconditional, and every path out of a gesture goes through one of them.
 */
function releaseCapture(s: DragState): void {
  const target = s.target;
  if (!target || s.pointerId < 0) return;
  try {
    if (target.hasPointerCapture?.(s.pointerId)) {
      target.releasePointerCapture(s.pointerId);
    }
  } catch {
    // element already detached - the browser dropped the capture with it
  }
}

export function useSwipeable(options: UseSwipeableOptions): UseSwipeableResult {
  // Latest-props ref: the handlers below never change identity, so spreading
  // them onto an element never causes React to re-attach listeners mid-gesture.
  // Synced in a LAYOUT effect - it runs before the browser can deliver the next
  // pointer event, so a gesture can never read a stale index.
  const optsRef = useRef(options);
  useIsomorphicLayoutEffect(() => {
    optsRef.current = options;
  });

  const state = useRef<DragState>(createState());
  /** Removes the window-level end guards. Null while no gesture is running. */
  const detachGuards = useRef<(() => void) | null>(null);

  /**
   * Ends the gesture. Called from the React handlers AND from the window guards,
   * so it has to be idempotent: `s.active` is cleared first and every later call
   * for the same pointer falls out at the top.
   */
  const endGesture = useCallback((pointerId: number, cancelled: boolean) => {
    const s = state.current;
    if (!s.active || pointerId !== s.pointerId) return;
    const wasDragging = s.axis === "x";
    s.active = false;

    detachGuards.current?.();
    releaseCapture(s);

    if (!wasDragging) {
      s.axis = null;
      s.offset = 0;
      return;
    }

    const o = optsRef.current;
    const width = Math.max(1, o.getWidth());
    const offset = s.offset;
    const velocity = s.velocity;
    // offset < 0 means the finger went left, so the NEXT panel comes in
    const direction = offset < 0 ? 1 : -1;

    const farEnough = Math.abs(offset) > width * (o.distanceRatio ?? DEFAULT_DISTANCE_RATIO);
    const fastEnough =
      Math.abs(velocity) > (o.velocityThreshold ?? DEFAULT_VELOCITY) &&
      Math.sign(velocity) === Math.sign(offset) &&
      Math.abs(offset) > MIN_FLICK_PX;

    let target = o.index;
    if (!cancelled && (farEnough || fastEnough)) {
      target = Math.max(0, Math.min(o.count - 1, o.index + direction));
    }
    const changed = target !== o.index;

    s.axis = null;
    s.offset = 0;
    s.velocity = 0;

    // animate first, then tell the parent - the deck must not wait for React
    o.onDragEnd?.(target, changed);
    if (changed) {
      if (o.haptics !== false) haptic.selection();
      o.onIndexChange(target);
    }
  }, []);

  /**
   * Window-level end guards, armed for the whole gesture.
   *
   * React only delivers an event to a MOUNTED node. If the deck unmounts mid-drag
   * (navigation, a list re-render, a sheet opening over it) the pointerup never
   * reaches the handlers below, `active` stays true and the hook is dead for the
   * rest of the session: the next pointerdown sees `active` and returns. Listening
   * on window closes that hole, because window outlives every panel.
   */
  const armGuards = useCallback(() => {
    detachGuards.current?.();
    if (typeof window === "undefined") return;
    const up = (ev: PointerEvent) => endGesture(ev.pointerId, false);
    const cancel = (ev: PointerEvent) => endGesture(ev.pointerId, true);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    detachGuards.current = () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      detachGuards.current = null;
    };
  }, [endGesture]);

  /* Unmounting mid-gesture: hand the pointer back and forget the dead node. */
  useEffect(() => {
    const s = state.current;
    return () => {
      detachGuards.current?.();
      releaseCapture(s);
      s.active = false;
      s.axis = null;
      s.target = null;
      s.pointerId = -1;
    };
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const o = optsRef.current;
    const s = state.current;
    s.swallowClick = false;
    if (o.enabled === false || o.count < 2) return;
    // ignore right / middle mouse buttons
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (s.active) {
      // Still attached to a live node: this is a second finger, ignore it.
      // Attached to nothing / to a node that left the document: the previous
      // gesture leaked, so recover here instead of staying dead for good.
      const stale = !s.target || !s.target.isConnected;
      if (!stale) return;
      detachGuards.current?.();
      releaseCapture(s);
      s.active = false;
    }

    s.active = true;
    s.pointerId = e.pointerId;
    s.axis = null;
    s.startX = e.clientX;
    s.startY = e.clientY;
    s.lastX = e.clientX;
    s.lastT = e.timeStamp || performance.now();
    s.velocity = 0;
    s.offset = 0;
    s.target = e.currentTarget;
    armGuards();
  }, [armGuards]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = state.current;
    if (!s.active || e.pointerId !== s.pointerId) return;
    const o = optsRef.current;

    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;

    if (s.axis === null) {
      if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
      s.axis = Math.abs(dx) > Math.abs(dy) * AXIS_HYSTERESIS ? "x" : "y";
      if (s.axis === "y") {
        // vertical: give the gesture back to the page scroller and stay out.
        // The window guards go with it - this pointer is no longer ours.
        s.active = false;
        detachGuards.current?.();
        return;
      }
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // capture is a nicety, the gesture still works without it
      }
      // re-base on the lock point so the panel starts from exactly 0, no jump
      s.startX = e.clientX;
      s.startY = e.clientY;
      s.lastX = e.clientX;
      s.lastT = e.timeStamp || performance.now();
      s.swallowClick = true;
      o.onDragStart?.();
      return;
    }

    if (s.axis !== "x") return;

    const width = Math.max(1, o.getWidth());
    let raw = e.clientX - s.startX;

    // rubber band: dragging past the first / last panel gets heavy
    const atStart = o.index <= 0 && raw > 0;
    const atEnd = o.index >= o.count - 1 && raw < 0;
    if (atStart || atEnd) raw *= o.resistance ?? DEFAULT_RESISTANCE;

    // never let a wild drag fling the track further than one screen
    const limit = width * 1.1;
    raw = Math.max(-limit, Math.min(limit, raw));
    s.offset = raw;

    const now = e.timeStamp || performance.now();
    const dt = now - s.lastT;
    if (dt > 0) {
      const sample = (e.clientX - s.lastX) / dt;
      s.velocity = s.velocity * (1 - VELOCITY_SMOOTHING) + sample * VELOCITY_SMOOTHING;
      s.lastX = e.clientX;
      s.lastT = now;
    }

    // keeps desktop from selecting text while dragging
    if (e.cancelable) e.preventDefault();
    o.onDrag?.(raw);
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => endGesture(e.pointerId, false),
    [endGesture],
  );
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => endGesture(e.pointerId, true),
    [endGesture],
  );
  const onLostPointerCapture = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => endGesture(e.pointerId, false),
    [endGesture],
  );

  const onClickCapture = useCallback((e: ReactMouseEvent<HTMLElement>) => {
    const s = state.current;
    if (!s.swallowClick) return;
    s.swallowClick = false;
    // the drag ended over a card / button - that click was never intended
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handlers = useMemo<SwipeableHandlers>(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
      onClickCapture,
    }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture, onClickCapture],
  );

  const getOffset = useCallback(() => state.current.offset, []);
  const isDragging = useCallback(() => state.current.active && state.current.axis === "x", []);

  return { handlers, getOffset, isDragging };
}

export default useSwipeable;
