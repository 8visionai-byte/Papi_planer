"use client";

/**
 * PillarBar - one of the seven energy pillars on the "Moja energia" screen.
 *
 * Emoji, name, the pillar's share of the day ("15% dnia"), the fill in percent and a
 * progress bar. Tapping the row expands its components.
 *
 * The expanded flag is a PROP, never internal state derived during render: the screen
 * owns which pillar is open (React 19 loses "adjust state during render" when the
 * parent updates in the same event - it already cost this project a day in Sheet).
 *
 * The header is a Pressable `div`, not a `button`, because the expanded area holds real
 * buttons and switches, and a button inside a button is invalid HTML.
 */

import React from "react";
import { Pressable, T, TYPO, MOTION } from "@/components/ui";
import { energyColor } from "./EnergyRing";

export interface PillarBarProps {
  emoji: string;
  name: string;
  /** 0-100 fill of the pillar. */
  percent: number;
  /** Share of the whole day in percent (ENERGIA-SPEC section 1). */
  weight: number;
  expanded?: boolean;
  /** Missing = the row is not interactive (e.g. read-only summary). */
  onToggle?: () => void;
  /** Components, rendered only while expanded. */
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function PillarBar({
  emoji,
  name,
  percent,
  weight,
  expanded = false,
  onToggle,
  children,
  className,
  style,
}: PillarBarProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const rounded = Math.round(clamped);
  const color = energyColor(clamped);

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: T.sp3, width: "100%" }}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 40,
          height: 40,
          flex: "0 0 auto",
          borderRadius: T.rFull,
          background: T.surface2,
          fontSize: 20,
          lineHeight: 1,
        }}
      >
        {emoji}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: T.sp2 }}>
          <span style={{ ...TYPO.bodyBold, color: T.text, flex: 1, minWidth: 0 }}>{name}</span>
          <span
            style={{
              ...TYPO.title3,
              color,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {rounded}%
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: T.sp2, marginTop: 6 }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              height: 8,
              borderRadius: T.rFull,
              background: T.surface2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${clamped}%`,
                borderRadius: T.rFull,
                background: color,
                transition: `width ${MOTION.slow} ${MOTION.easeOut}, background ${MOTION.base} linear`,
              }}
            />
          </div>
          <span style={{ ...TYPO.footnote, color: T.text3, flex: "0 0 auto" }}>
            {Math.round(weight)}% dnia
          </span>
        </div>
      </div>

      {onToggle ? <Chevron open={expanded} /> : null}
    </div>
  );

  return (
    <div
      className={className}
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: T.rLg,
        boxShadow: T.elev1,
        padding: `0 ${T.sp4}`,
        ...style,
      }}
    >
      {onToggle ? (
        <Pressable
          as="div"
          press="lg"
          haptic="tap"
          onPress={onToggle}
          ariaExpanded={expanded}
          ariaLabel={`${name}, ${rounded} procent. ${expanded ? "Zwiń" : "Rozwiń"} składowe.`}
          style={{
            display: "flex",
            width: "100%",
            // whole row is the target, comfortably over the 44 px floor
            minHeight: 64,
            padding: `${T.sp3} 0`,
            textAlign: "left",
          }}
        >
          {header}
        </Pressable>
      ) : (
        <div style={{ minHeight: 64, padding: `${T.sp3} 0`, display: "flex", width: "100%" }}>
          {header}
        </div>
      )}

      {expanded && children ? (
        <div style={{ borderTop: `1px solid ${T.border}`, paddingBottom: T.sp2 }}>{children}</div>
      ) : null}
    </div>
  );
}

/** Small chevron that flips when the row opens. */
function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        flex: "0 0 auto",
        color: T.text3,
        transform: `rotate(${open ? 180 : 0}deg)`,
        transition: `transform ${MOTION.base} ${MOTION.easeOut}`,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16">
        <polyline
          points="3,6 8,11 13,6"
          fill="none"
          style={{
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
          }}
        />
      </svg>
    </span>
  );
}

export default PillarBar;
