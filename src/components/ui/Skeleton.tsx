"use client";

import React from "react";
import { T } from "./tokens";

export type SkeletonVariant = "line" | "block" | "circle" | "card" | "list";

export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: number | string;
  height?: number;
  radius?: number | string;
  /** Number of lines (variant "line"/"card") or rows (variant "list"). */
  count?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Fixed line widths. Deliberately a constant table, not Math.random():
 * dashboard/page.tsx:182 randomises widths on every re-render, so today the skeleton
 * flickers while it waits.
 */
const LINE_WIDTHS = ["92%", "78%", "85%", "66%", "88%", "72%"];

/** One shimmering block. Uses the `.skeleton` class from globals.css when present. */
function Bar({
  width,
  height,
  radius,
  style,
}: {
  width: number | string;
  height: number;
  radius: number | string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className="skeleton"
      // .skeleton paints the shimmer gradient (globals.css). Never set `background`
      // here: an inline background would beat the class and kill the sheen.
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/**
 * Loading placeholder: a line, a whole card, or a list of rows.
 *
 * Replaces the 35 pulsing grey rectangles scattered across the app. Sizes match the
 * real content, so nothing jumps when the data arrives.
 *
 * @example
 * <Skeleton variant="line" width="60%" />
 * <Skeleton variant="card" count={3} />
 * <Skeleton variant="list" count={5} />
 */
export function Skeleton({
  variant = "line",
  width = "100%",
  height,
  radius,
  count = 1,
  className,
  style,
}: SkeletonProps) {
  const r = radius ?? T.rSm;

  if (variant === "circle") {
    const d = height ?? 40;
    return (
      <div className={className} style={style} role="status" aria-label="Ładowanie">
        <Bar width={d} height={d} radius="50%" />
      </div>
    );
  }

  if (variant === "block") {
    return (
      <div className={className} style={style} role="status" aria-label="Ładowanie">
        <Bar width={width} height={height ?? 120} radius={radius ?? T.rLg} />
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div
        className={className}
        role="status"
        aria-label="Ładowanie"
        style={{
          background: T.surface,
          borderRadius: T.rLg,
          border: `1px solid ${T.border}`,
          boxShadow: T.elev1,
          padding: T.sp4,
          ...style,
        }}
      >
        <Bar width="40%" height={16} radius={r} />
        <div style={{ marginTop: T.sp3, display: "flex", flexDirection: "column", gap: T.sp2 }}>
          {Array.from({ length: Math.max(1, count) }).map((_, i) => (
            <Bar key={i} width={LINE_WIDTHS[i % LINE_WIDTHS.length]} height={14} radius={r} />
          ))}
        </div>
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div
        className={className}
        role="status"
        aria-label="Ładowanie"
        style={{ display: "flex", flexDirection: "column", gap: T.sp2, ...style }}
      >
        {Array.from({ length: Math.max(1, count) }).map((_, i) => (
          <div
            key={i}
            style={{ display: "flex", alignItems: "center", gap: T.sp3, minHeight: 56 }}
          >
            <Bar width={24} height={24} radius={T.rXs} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              <Bar width={LINE_WIDTHS[i % LINE_WIDTHS.length]} height={14} radius={r} />
              <Bar width="42%" height={11} radius={r} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // variant "line"
  return (
    <div
      className={className}
      role="status"
      aria-label="Ładowanie"
      style={{ display: "flex", flexDirection: "column", gap: T.sp2, ...style }}
    >
      {Array.from({ length: Math.max(1, count) }).map((_, i) => (
        <Bar
          key={i}
          width={count > 1 ? LINE_WIDTHS[i % LINE_WIDTHS.length] : width}
          height={height ?? 14}
          radius={r}
        />
      ))}
    </div>
  );
}

export default Skeleton;
