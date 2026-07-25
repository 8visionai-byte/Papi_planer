"use client";

import React from "react";
import { Pressable, type HapticKind } from "./Pressable";
import { MOTION, T, TYPO } from "./tokens";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  /** sm = 44 px (hard floor), md = 48 px (default control), lg = 56 px (screen CTA). */
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Spinner replaces the label, width does not change, clicks are blocked. */
  loading?: boolean;
  disabled?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  onPress?: (e: React.MouseEvent<HTMLElement>) => void;
  onLongPress?: () => void;
  haptic?: HapticKind | false;
  type?: "button" | "submit" | "reset";
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

const SIZE: Record<ButtonSize, { height: string; padding: string; typo: React.CSSProperties }> = {
  sm: { height: T.tapMin, padding: `0 ${T.sp4}`, typo: TYPO.footnote },
  md: { height: T.ctrlMd, padding: `0 ${T.sp5}`, typo: TYPO.callout },
  lg: { height: T.ctrlLg, padding: `0 ${T.sp6}`, typo: TYPO.body },
};

function variantStyle(variant: ButtonVariant): React.CSSProperties {
  switch (variant) {
    case "secondary":
      return {
        background: T.surface2,
        color: T.text,
        border: `1px solid ${T.border}`,
        boxShadow: "none",
      };
    case "ghost":
      // brand colour used as TEXT -> the contrast-corrected token, not the fill one
      return {
        background: "transparent",
        color: T.primaryOnSurface,
        border: "none",
        boxShadow: "none",
      };
    case "danger":
      return {
        background: T.dangerSoft,
        color: T.dangerOnSurface,
        border: `1px solid ${T.danger}`,
        boxShadow: "none",
      };
    case "primary":
    default:
      return {
        background: T.primary,
        color: T.primaryText,
        border: "none",
        boxShadow: T.glowPrimary,
      };
  }
}

/**
 * The one button of the app. Replaces btnPrimary / btnSecondary / btnDanger /
 * buttonPrimary / buttonGhost / buttonPrimaryStyle and friends (8 duplicated style objects,
 * all of them between 26 and 37 px tall - below the 44 px floor).
 *
 * Rule from DESIGN-SPEC: a danger button never stands next to a primary one, the
 * destructive action goes into a Sheet with a confirmation.
 *
 * @example
 * <Button size="lg" fullWidth loading={saving} onPress={save}>Zapisz</Button>
 * <Button variant="secondary" size="md" iconLeft={<PlusIcon />} onPress={add}>Dodaj posilek</Button>
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  fullWidth = false,
  loading = false,
  disabled = false,
  iconLeft,
  iconRight,
  onPress,
  onLongPress,
  haptic = "press",
  type = "button",
  ariaLabel,
  className,
  style,
}: ButtonProps) {
  const isDead = disabled || loading;
  const s = SIZE[size];
  const v = variantStyle(variant);

  return (
    <Pressable
      as="button"
      type={type}
      disabled={isDead}
      press="sm"
      haptic={isDead ? false : haptic}
      onPress={onPress}
      onLongPress={onLongPress}
      ariaLabel={ariaLabel}
      className={className}
      style={{
        position: "relative",
        display: fullWidth ? "flex" : "inline-flex",
        width: fullWidth ? "100%" : undefined,
        minHeight: s.height,
        height: s.height,
        padding: s.padding,
        gap: T.sp2,
        borderRadius: T.rMd,
        whiteSpace: "nowrap",
        opacity: disabled ? 0.45 : 1,
        transitionProperty: "transform, background-color, color",
        transitionDuration: `${MOTION.pressOut}, ${MOTION.instant}, ${MOTION.instant}`,
        ...s.typo,
        fontWeight: 600,
        ...v,
        ...(disabled ? { boxShadow: "none" } : null),
        ...style,
      }}
    >
      {/* label keeps its box while loading, so the button never changes width */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: T.sp2,
          visibility: loading ? "hidden" : "visible",
        }}
      >
        {iconLeft ? <span style={{ display: "inline-flex", flexShrink: 0 }}>{iconLeft}</span> : null}
        {children}
        {iconRight ? (
          <span style={{ display: "inline-flex", flexShrink: 0 }}>{iconRight}</span>
        ) : null}
      </span>

      {loading ? <Spinner /> : null}
    </Pressable>
  );
}

/** Centered spinner. Uses the `spin` keyframes that already live in globals.css. */
function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        width: 18,
        height: 18,
        marginTop: -9,
        marginLeft: -9,
        borderRadius: "50%",
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        opacity: 0.9,
        animation: "spin 700ms linear infinite",
      }}
    />
  );
}

export default Button;
