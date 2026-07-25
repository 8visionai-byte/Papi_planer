"use client";

import React from "react";
import { Pressable, type HapticKind } from "./Pressable";
import { T } from "./tokens";

/**
 * "default" and "plain" are the same thing (plain = name used in DESIGN-SPEC 5.3).
 * "inset" = a block inside another card. "elevated"/"hero" = the one hero card of a screen.
 */
export type CardVariant = "default" | "plain" | "inset" | "elevated" | "hero";
export type CardPadding = "none" | "sm" | "md" | "lg";

export interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  /** none = 0, sm = 12 (compact), md = 16 (normal), lg = 24 (hero). */
  padding?: CardPadding;
  /** When given, the whole card becomes one big touch target with a soft press. */
  onPress?: (e: React.MouseEvent<HTMLElement>) => void;
  onLongPress?: () => void;
  haptic?: HapticKind | false;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

const PADDING: Record<CardPadding, string | number> = {
  none: 0,
  sm: T.sp3,
  md: T.sp4,
  lg: T.sp6,
};

function variantStyle(variant: CardVariant): React.CSSProperties {
  switch (variant) {
    case "inset":
      return {
        background: T.surface2,
        borderRadius: T.rMd,
        boxShadow: "none",
        border: "none",
      };
    case "elevated":
    case "hero":
      return {
        background: T.surface,
        borderRadius: T.rXl,
        boxShadow: T.elev2,
        border: `1px solid ${T.border}`,
      };
    case "default":
    case "plain":
    default:
      return {
        background: T.surface,
        borderRadius: T.rLg,
        boxShadow: T.elev1,
        border: `1px solid ${T.border}`,
      };
  }
}

/**
 * Replaces the nine copies of `const cardStyle` (dashboard, diet, goals, habits, journal,
 * discipline/[slug], BriefingCard, WeeklyCheckinForm, WeightTracker) with one definition
 * that follows the tokens and therefore works in dark mode.
 *
 * @example
 * <Card>Zwykla karta</Card>
 * <Card variant="hero" padding="lg">Pierscien dnia</Card>
 * <Card variant="inset" padding="sm">Szczegoly bilansu</Card>
 * <Card onPress={() => router.push("/diet")}>Dieta</Card>
 */
export function Card({
  children,
  variant = "default",
  padding = "md",
  onPress,
  onLongPress,
  haptic = "tap",
  ariaLabel,
  className,
  style,
}: CardProps) {
  const base: React.CSSProperties = {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    padding: PADDING[padding],
    color: T.text,
    ...variantStyle(variant),
    ...style,
  };

  if (onPress || onLongPress) {
    return (
      <Pressable
        // as="div": a clickable card almost always holds its own buttons, and
        // <button> inside <button> is invalid HTML. role="button" + keyboard handling
        // come from Pressable.
        as="div"
        press="lg"
        haptic={haptic}
        onPress={onPress}
        onLongPress={onLongPress}
        ariaLabel={ariaLabel}
        className={className}
        style={{
          ...base,
          display: "block",
          textAlign: "left",
        }}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <div className={className} style={base}>
      {children}
    </div>
  );
}

export default Card;
