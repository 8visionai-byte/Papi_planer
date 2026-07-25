"use client";

import React from "react";
import { Pressable, type HapticKind } from "./Pressable";
import { MOTION, T, TYPO } from "./tokens";

export interface ListRowProps {
  /** Left slot: checkbox, hour, avatar, icon. Give the control its own stopPropagation. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right slot: value, badge, chevron. */
  trailing?: React.ReactNode;
  onPress?: (e: React.MouseEvent<HTMLElement>) => void;
  onLongPress?: () => void;
  haptic?: HapticKind | false;
  /** Shows a rotating chevron and lets the row toggle `children` when pressed. */
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Content revealed under the row when `expanded` is true. */
  children?: React.ReactNode;
  /** 56 px by default (DESIGN-SPEC: list row = 56). Never below 44. */
  minHeight?: number;
  /** Destructive row: title in --danger. */
  danger?: boolean;
  /** Done / in-flight row: dimmed and struck through. */
  done?: boolean;
  dimmed?: boolean;
  disabled?: boolean;
  /** Hairline under the row, for rows rendered one after another. */
  divider?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * One list row: left slot, text, right slot, optional expand.
 *
 * Replaces the hand-built rows on Dashboard (ActivityRow, MeetingRow, habit mini widget),
 * Goals and Habits, which are 32-38 px tall `<div onClick>` today. The whole row is one
 * target; a control inside `leading` must call `e.stopPropagation()` (Pressable has a
 * `stopPropagation` prop for exactly that), otherwise ticking a task also expands it.
 *
 * @example
 * <ListRow
 *   leading={<Pressable stopPropagation onPress={toggle} noMinSize>{checkbox}</Pressable>}
 *   title={activity.name}
 *   subtitle={activity.scheduledAt ?? undefined}
 *   trailing={<span>{kcal} kcal</span>}
 *   expandable
 *   expanded={isExpanded}
 *   onToggleExpand={onExpand}
 * >
 *   <MealForm />
 * </ListRow>
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onPress,
  onLongPress,
  haptic = "tap",
  expandable = false,
  expanded = false,
  onToggleExpand,
  children,
  minHeight = 56,
  danger = false,
  done = false,
  dimmed = false,
  disabled = false,
  divider = false,
  className,
  style,
}: ListRowProps) {
  const height = Math.max(44, minHeight);
  const interactive = !disabled && Boolean(onPress || onLongPress || (expandable && onToggleExpand));

  const handlePress = (e: React.MouseEvent<HTMLElement>) => {
    if (onPress) {
      onPress(e);
      return;
    }
    if (expandable) onToggleExpand?.();
  };

  const inner = (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: T.sp3,
        width: "100%",
        minHeight: height,
        padding: `${T.sp2} ${T.sp1}`,
        boxSizing: "border-box",
        borderRadius: T.rMd,
        background: expanded ? T.surface2 : "transparent",
        transition: `background-color ${MOTION.instant} linear`,
        opacity: dimmed || disabled ? 0.6 : 1,
      }}
    >
      {leading ? (
        <span style={{ display: "inline-flex", flexShrink: 0, alignItems: "center" }}>
          {leading}
        </span>
      ) : null}

      <span style={{ flex: 1, minWidth: 0, display: "block", textAlign: "left" }}>
        <span
          style={{
            display: "block",
            ...TYPO.body,
            color: danger ? T.dangerOnSurface : done ? T.text3 : T.text,
            textDecoration: done ? "line-through" : "none",
            overflowWrap: "anywhere",
          }}
        >
          {title}
        </span>
        {subtitle ? (
          <span style={{ display: "block", ...TYPO.footnote, color: T.text3, marginTop: 2 }}>
            {subtitle}
          </span>
        ) : null}
      </span>

      {trailing ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: T.sp2,
            flexShrink: 0,
            ...TYPO.footnote,
            color: T.text3,
          }}
        >
          {trailing}
        </span>
      ) : null}

      {expandable ? <Chevron open={expanded} /> : null}
    </span>
  );

  return (
    <div
      className={className}
      style={{
        width: "100%",
        borderBottom: divider ? `1px solid ${T.border}` : undefined,
        ...style,
      }}
    >
      {interactive ? (
        <Pressable
          // as="div" on purpose: the row usually carries a checkbox in `leading` or an
          // icon button in `trailing`, and a <button> inside a <button> is invalid HTML -
          // the browser then hoists the inner control out and the row falls apart.
          // The div branch of Pressable keeps role="button", tabIndex and Enter/Space.
          as="div"
          press="sm"
          haptic={haptic}
          disabled={disabled}
          onPress={handlePress}
          onLongPress={onLongPress}
          ariaExpanded={expandable ? expanded : undefined}
          noMinSize
          style={{ width: "100%", display: "block", minHeight: height }}
        >
          {inner}
        </Pressable>
      ) : (
        inner
      )}

      {expandable && expanded && children ? (
        <div
          // .reveal = opacity + translateY from globals.css; never animate height
          className="reveal"
          style={{ padding: `${T.sp2} ${T.sp1} ${T.sp3}` }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Chevron that rotates instead of being swapped for another glyph. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        flexShrink: 0,
        color: T.text3,
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: `transform ${MOTION.base} ${MOTION.easeOut}`,
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default ListRow;
