"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MOTION, SLOW_MS, T, TYPO } from "./tokens";
import { fireHaptic } from "./haptics-bridge";

export type SheetSize = "auto" | "half" | "full";

export interface SheetProps {
  open: boolean;
  /** Called when the user closes the sheet (backdrop, Escape, drag down, close button). */
  onClose: () => void;
  title?: string;
  /** auto = height of the content (max 92dvh), half = 50dvh, full = 92dvh. */
  size?: SheetSize;
  /** Drag the handle down to dismiss. Default true. */
  dismissOnDrag?: boolean;
  /** Backdrop click closes. Default true - set false for a destructive confirmation. */
  dismissOnBackdrop?: boolean;
  /** Sticky footer, already padded for the home indicator. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

const DRAG_CLOSE_PX = 96;

/* ---------------------------------------------------------------------------
   Body scroll lock, reference counted.

   Two sheets can be open at once (Habits has "add" and "edit", Mentors has
   "details" and "confirm delete"). With a per-component lock the second sheet
   saved the FIRST sheet's already-locked styles as "previous" and restored those
   on close, so the page stayed frozen. One module-level lock with a counter is
   the only way this stays correct no matter how the sheets overlap.
--------------------------------------------------------------------------- */
let lockCount = 0;
let lockedScrollY = 0;
let savedBody: Record<string, string> | null = null;

function lockBodyScroll() {
  if (typeof document === "undefined") return;
  lockCount += 1;
  if (lockCount > 1) return; // already locked by an outer sheet
  const body = document.body;
  lockedScrollY = window.scrollY;
  savedBody = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
  };
  body.style.position = "fixed";
  body.style.top = `-${lockedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";
}

function unlockBodyScroll() {
  if (typeof document === "undefined") return;
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount > 0) return; // an outer sheet is still open
  const body = document.body;
  const prev = savedBody ?? {
    position: "",
    top: "",
    left: "",
    right: "",
    width: "",
    overflow: "",
  };
  body.style.position = prev.position;
  body.style.top = prev.top;
  body.style.left = prev.left;
  body.style.right = prev.right;
  body.style.width = prev.width;
  body.style.overflow = prev.overflow;
  savedBody = null;
  window.scrollTo(0, lockedScrollY);
}

/** useLayoutEffect warns during server rendering; fall back to useEffect there. */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;


/**
 * Bottom sheet. Replaces the 12 centered `position: fixed` modals, 11 of which do not
 * lock the background scroll today.
 *
 * Does all four things those modals miss: locks the page (and restores the exact scroll
 * position on close), closes on Escape, closes on a drag down, and keeps its footer above
 * the home indicator via --safe-b. Rendered through a portal on document.body, so a parent
 * with `overflow: hidden` or a transform (the Dashboard carousel) cannot clip it.
 *
 * @example
 * <Sheet open={open} onClose={() => setOpen(false)} title="Usunac cel?"
 *        footer={<Button variant="danger" fullWidth onPress={remove}>Usun</Button>}>
 *   <p>Tej operacji nie da sie cofnac.</p>
 * </Sheet>
 */
export function Sheet({
  open,
  onClose,
  title,
  size = "auto",
  dismissOnDrag = true,
  dismissOnBackdrop = true,
  footer,
  children,
  ariaLabel,
  className,
  style,
}: SheetProps) {
  /**
   * `exiting` keeps the panel mounted for the slide-out, nothing else.
   *
   * The mount condition is `open || exiting`, computed during render. It used to be a
   * second piece of state written with the "adjust state during render" pattern
   * (`if (prevOpen !== open) setRender(true)`), and under React 19 that update was
   * dropped whenever the same event queued another update in the parent: `open` was
   * true, the portal returned null, and the body scroll lock (which does not depend on
   * it) still fired. That is the "I tap a mentor, nothing opens and the app freezes"
   * bug - verified in the browser, `[role=dialog]` absent while `body.position` was
   * `fixed`. Deriving the mount instead of storing it cannot get out of sync.
   */
  const [exiting, setExiting] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startY: number; dy: number; active: boolean }>({
    startY: 0,
    dy: 0,
    active: false,
  });

  // opening is immediate: derived, never stored
  const mounted = open || exiting;

  // closing keeps the panel mounted until the slide-out has finished
  useEffect(() => {
    if (open) {
      setExiting(true);
      return;
    }
    const id = setTimeout(() => setExiting(false), SLOW_MS);
    return () => clearTimeout(id);
  }, [open]);

  // Enter / exit animation, written straight to the nodes.
  // Two reasons it is imperative and not React state:
  // 1) the drag also writes `transform` on the node, and React would not notice that,
  // 2) requestAnimationFrame does not fire in a tab that is not painting, which would
  //    leave the sheet stuck off-screen. A forced reflow always works.
  useIsomorphicLayoutEffect(() => {
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel) return;
    const move = `transform ${MOTION.slow} ${MOTION.easeIos}`;
    const fade = `opacity ${MOTION.slow} ${MOTION.easeIos}`;

    if (open) {
      panel.style.transition = "none";
      panel.style.transform = "translateY(100%)";
      if (backdrop) {
        backdrop.style.transition = "none";
        backdrop.style.opacity = "0";
      }
      void panel.offsetHeight; // flush the closed state so the browser animates from it
      panel.style.transition = move;
      panel.style.transform = "translateY(0)";
      if (backdrop) {
        backdrop.style.transition = fade;
        backdrop.style.opacity = "1";
      }
      return;
    }

    panel.style.transition = move;
    panel.style.transform = "translateY(100%)";
    if (backdrop) {
      backdrop.style.transition = fade;
      backdrop.style.opacity = "0";
    }
  }, [open, mounted]);

  // Background scroll lock. Tied to `mounted`, not to `open`: the lock must never be
  // able to outlive the element that justifies it. Reference counted at module level,
  // so two overlapping sheets cannot restore each other's locked styles.
  useEffect(() => {
    if (!mounted || !open) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [mounted, open]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /* ---------------- drag to dismiss ---------------- */

  const setPanelTransform = useCallback((value: string, transition: string) => {
    const el = panelRef.current;
    if (!el) return;
    el.style.transition = transition;
    el.style.transform = value;
  }, []);

  const onHandleDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dismissOnDrag) return;
      dragRef.current = { startY: e.clientY, dy: 0, active: true };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setPanelTransform("translateY(0px)", "none");
    },
    [dismissOnDrag, setPanelTransform],
  );

  const onHandleMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d.active) return;
      // only downwards, with resistance so it never feels loose
      const raw = e.clientY - d.startY;
      d.dy = raw > 0 ? raw : raw * 0.2;
      // transform written straight to the node: no re-render at 60 events per second
      setPanelTransform(`translateY(${Math.max(d.dy, 0)}px)`, "none");
    },
    [setPanelTransform],
  );

  const onHandleUp = useCallback(() => {
    const d = dragRef.current;
    if (!d.active) return;
    d.active = false;
    if (d.dy > DRAG_CLOSE_PX) {
      fireHaptic("tap");
      onClose();
      return;
    }
    setPanelTransform("translateY(0px)", `transform ${MOTION.base} ${MOTION.easeSpring}`);
  }, [onClose, setPanelTransform]);

  // nothing to portal into while rendering on the server
  if (!mounted || typeof document === "undefined") return null;

  const height =
    size === "full" ? "92dvh" : size === "half" ? "50dvh" : undefined;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
      }}
      role="presentation"
    >
      {/* backdrop - opacity is owned by the layout effect above */}
      <div
        ref={backdropRef}
        onClick={dismissOnBackdrop ? onClose : undefined}
        style={{ position: "absolute", inset: 0, background: T.overlay, opacity: 0 }}
      />

      {/* panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? title}
        className={className}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 430,
          margin: "0 auto",
          height,
          maxHeight: "92dvh",
          display: "flex",
          flexDirection: "column",
          background: T.surface,
          color: T.text,
          borderRadius: `${T.rXl} ${T.rXl} 0 0`,
          boxShadow: T.elev4,
          // starting position only; from here on the layout effect above owns it
          transform: "translateY(100%)",
          ...style,
        }}
      >
        {/* grab handle: 36x4 px drawing inside a 44 px tall target */}
        <div
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 44,
            flexShrink: 0,
            cursor: dismissOnDrag ? "grab" : "default",
            touchAction: "none",
            WebkitUserSelect: "none",
            userSelect: "none",
          }}
        >
          <span
            style={{
              width: 36,
              height: 4,
              borderRadius: T.rFull,
              background: T.borderStrong,
              display: "block",
            }}
          />
        </div>

        {title ? (
          <div
            style={{
              padding: `0 ${T.gutter} ${T.sp3}`,
              ...TYPO.title2,
              color: T.text,
              flexShrink: 0,
            }}
          >
            {title}
          </div>
        ) : null}

        {/* content */}
        <div
          className="papi-scroll"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
            padding: `0 ${T.gutter}`,
            paddingBottom: footer ? T.sp3 : `calc(${T.sp6} + ${T.safeB})`,
          }}
        >
          {children}
        </div>

        {footer ? (
          <div
            style={{
              flexShrink: 0,
              padding: `${T.sp3} ${T.gutter}`,
              paddingBottom: `calc(${T.sp3} + ${T.safeB})`,
              borderTop: `1px solid ${T.border}`,
              background: T.surface,
              borderRadius: `0 0 ${T.rXl} ${T.rXl}`,
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export default Sheet;
