"use client";

import React from "react";
import { Pressable, type HapticKind } from "./Pressable";
import { T, TONE, TYPO, type Tone } from "./tokens";

export type StatSize = "hero" | "md" | "sm";

export interface StatTrend {
  /** Magnitude shown next to the arrow, e.g. 2.4 for "2,4 kg". */
  value: number | string;
  direction: "up" | "down";
  /** Is this direction good for the user? Decides green vs red, not the arrow. */
  good: boolean;
  /** Optional caption, e.g. "vs. zeszly tydzien". */
  label?: string;
}

export interface StatProps {
  value: string | number;
  unit?: string;
  label: string;
  /** hero = 44 px (one per screen, never two), md = 32 px, sm = 17 px. */
  size?: StatSize;
  tone?: Tone;
  icon?: React.ReactNode;
  trend?: StatTrend;
  align?: "start" | "center";
  onPress?: (e: React.MouseEvent<HTMLElement>) => void;
  haptic?: HapticKind | false;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

const VALUE_TYPO: Record<StatSize, React.CSSProperties> = {
  hero: TYPO.display,
  md: TYPO.metric,
  sm: TYPO.title3,
};

/**
 * Metric tile: value, unit, label, optional icon and trend.
 *
 * Replaces StatItem on the Dashboard and the scattered "big number + small caption" pairs.
 * Always tabular figures, so a counter does not shift its neighbours while it changes.
 * DESIGN-SPEC rule: exactly one `size="hero"` per screen.
 *
 * @example
 * <Stat size="hero" value={72} unit="%" label="Dzien" tone="primary" />
 * <Stat value={1840} unit="kcal" label="Spalone" trend={{ value: 120, direction: "up", good: true }} />
 */
export function Stat({
  value,
  unit,
  label,
  size = "md",
  tone = "neutral",
  icon,
  trend,
  align = "start",
  onPress,
  haptic = "tap",
  ariaLabel,
  className,
  style,
}: StatProps) {
  const toneColors = TONE[tone];

  const body = (
    <span
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: T.sp1,
        width: "100%",
        textAlign: align === "center" ? "center" : "left",
      }}
    >
      {icon ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: toneColors.fg,
            marginBottom: 2,
          }}
        >
          {icon}
        </span>
      ) : null}

      <span
        style={{
          display: "inline-flex",
          alignItems: "baseline",
          gap: 4,
          color: tone === "neutral" ? T.text : toneColors.fg,
          ...VALUE_TYPO[size],
        }}
      >
        <span>{value}</span>
        {unit ? (
          <span style={{ ...TYPO.footnote, color: T.text3, fontWeight: 600 }}>{unit}</span>
        ) : null}
      </span>

      <span style={{ ...TYPO.footnote, color: T.text3 }}>{label}</span>

      {trend ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginTop: 2,
            padding: `2px ${T.sp2}`,
            borderRadius: T.rFull,
            background: trend.good ? TONE.success.soft : TONE.danger.soft,
            color: trend.good ? TONE.success.fg : TONE.danger.fg,
            ...TYPO.footnote,
            fontWeight: 700,
          }}
        >
          <TrendArrow direction={trend.direction} />
          <span>{trend.value}</span>
          {trend.label ? (
            <span style={{ fontWeight: 500, opacity: 0.9 }}>{trend.label}</span>
          ) : null}
        </span>
      ) : null}
    </span>
  );

  if (onPress) {
    return (
      <Pressable
        press="lg"
        haptic={haptic}
        onPress={onPress}
        ariaLabel={ariaLabel ?? `${value} ${label}`}
        className={className}
        noMinSize
        style={{
          display: "block",
          width: "100%",
          minHeight: T.tapMin,
          padding: T.sp3,
          borderRadius: T.rMd,
          background: "transparent",
          ...style,
        }}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <div className={className} style={{ display: "block", width: "100%", ...style }}>
      {body}
    </div>
  );
}

function TrendArrow({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: direction === "down" ? "rotate(180deg)" : undefined }}
    >
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </svg>
  );
}

export default Stat;
