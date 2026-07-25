"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { T } from "./tokens";
import { fireHaptic, type HapticKind } from "./haptics-bridge";

export type { HapticKind };

export interface PressableProps {
  children: React.ReactNode;
  /** Fired on click / Enter / Space. Not fired when a long press already fired. */
  onPress?: (e: React.MouseEvent<HTMLElement>) => void;
  /** Fired after `longPressMs` of holding. Cancels the following onPress. */
  onLongPress?: () => void;
  longPressMs?: number;
  disabled?: boolean;
  /** Press scale: "sm" = 0.97 (buttons, rows), "lg" = 0.985 (cards), "none" = off. */
  press?: "sm" | "lg" | "none";
  /** Haptic pattern fired on touch down, not after the server answers. `false` = silent. */
  haptic?: HapticKind | false;
  as?: "button" | "div";
  type?: "button" | "submit" | "reset";
  /** Required when the element has no readable text (icon-only). */
  ariaLabel?: string;
  ariaExpanded?: boolean;
  ariaChecked?: boolean;
  ariaPressed?: boolean;
  role?: string;
  tabIndex?: number;
  id?: string;
  title?: string;
  /** Stops the click from reaching a clickable parent (checkbox inside a clickable row). */
  stopPropagation?: boolean;
  /** Drops the default 44x44 minimum. Only for a control nested inside a bigger target. */
  noMinSize?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Press classes defined in globals.css. Using the stylesheet instead of an inline
 * transform is deliberate: the press then costs zero React re-renders (important on
 * Dashboard, 2609 lines, no React.memo anywhere) and it stays inside the
 * prefers-reduced-motion override that globals.css already ships.
 */
const PRESS_CLASS: Record<"sm" | "lg" | "none", string> = {
  sm: "pressable",
  lg: "pressable press-lg",
  none: "pressable press-none",
};

/**
 * Touch foundation for every clickable thing in the app.
 *
 * Gives three things no element in this codebase has today: a 44x44 minimum target,
 * a press animation that starts on touch down (60 ms in, 260 ms spring back) and an
 * optional haptic fired at the same moment - on touch, never after the server answers.
 *
 * @example
 * <Pressable onPress={() => setOpen(true)} press="lg" haptic="tap" style={{ width: "100%" }}>
 *   <Card>Plan dnia</Card>
 * </Pressable>
 */
export function Pressable({
  children,
  onPress,
  onLongPress,
  longPressMs = 500,
  disabled = false,
  press = "sm",
  haptic = "tap",
  as = "button",
  type = "button",
  ariaLabel,
  ariaExpanded,
  ariaChecked,
  ariaPressed,
  role,
  tabIndex,
  id,
  title,
  stopPropagation = false,
  noMinSize = false,
  className,
  style,
}: PressableProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFiredRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // never leave a timer behind when the row unmounts mid-press
  useEffect(() => clearTimer, [clearTimer]);

  const handleDown = useCallback(() => {
    if (disabled) return;
    longFiredRef.current = false;
    fireHaptic(haptic);

    if (onLongPress) {
      clearTimer();
      timerRef.current = setTimeout(() => {
        longFiredRef.current = true;
        fireHaptic("longPress");
        onLongPress();
      }, longPressMs);
    }
  }, [disabled, haptic, onLongPress, longPressMs, clearTimer]);

  const handleUp = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (stopPropagation) e.stopPropagation();
      if (disabled) return;
      if (longFiredRef.current) {
        longFiredRef.current = false;
        return;
      }
      onPress?.(e);
    },
    [disabled, onPress, stopPropagation],
  );

  const pressClass = disabled ? PRESS_CLASS.none : PRESS_CLASS[press];
  const mergedClass = className ? `${pressClass} ${className}` : pressClass;

  const baseStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    margin: 0,
    padding: 0,
    border: "none",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    textAlign: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
    touchAction: "manipulation",
    WebkitUserSelect: "none",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
    ...(noMinSize ? null : { minWidth: T.tapMin, minHeight: T.tapMin }),
    ...style,
  };

  const shared = {
    id,
    title,
    className: mergedClass,
    style: baseStyle,
    onClick: handleClick,
    onPointerDown: handleDown,
    onPointerUp: handleUp,
    onPointerLeave: handleUp,
    onPointerCancel: handleUp,
    "aria-label": ariaLabel,
    "aria-expanded": ariaExpanded,
    "aria-checked": ariaChecked,
    "aria-pressed": ariaPressed,
  };

  if (as === "div") {
    return (
      <div
        {...shared}
        role={role ?? "button"}
        tabIndex={disabled ? -1 : (tabIndex ?? 0)}
        aria-disabled={disabled || undefined}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick(e as unknown as React.MouseEvent<HTMLElement>);
          }
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <button {...shared} type={type} disabled={disabled} role={role} tabIndex={tabIndex}>
      {children}
    </button>
  );
}

export default Pressable;
