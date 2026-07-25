"use client";

/**
 * BigTabs — kept as a thin alias over `SegmentedTabs`.
 *
 * The old implementation painted its own bar with hardcoded light-theme colours
 * (`rgba(17,19,39,0.05)` background, `rgba(17,19,39,…)` shadows), which vanished
 * on the dark theme, and it repainted every button's background on a tab change
 * instead of moving one indicator.
 *
 * `src/components/motion/SegmentedTabs.tsx` already does all of that properly:
 * token-driven surfaces, an indicator that slides on `transform`, swipe support,
 * a 44 px minimum target and keyboard navigation. Since both components take the
 * same `tabs` / `active` / `onChange` / `style` props, BigTabs now just forwards
 * to it — every existing call site keeps working untouched.
 *
 * New code should import `SegmentedTabs` from `@/components/motion` directly.
 *
 * @example
 * <BigTabs tabs={[{ key: "plan", label: "Plan dnia" }]} active={tab} onChange={setTab} />
 */

import React from "react";
import { SegmentedTabs } from "@/components/motion/SegmentedTabs";

export interface BigTab<T extends string = string> {
  key: T;
  label: string;
}

export interface BigTabsProps<T extends string = string> {
  tabs: ReadonlyArray<BigTab<T>>;
  active: T;
  onChange: (key: T) => void;
  /** Drag across the bar to change tab. On by default. */
  swipeable?: boolean;
  style?: React.CSSProperties;
}

export default function BigTabs<T extends string = string>({
  tabs,
  active,
  onChange,
  swipeable = true,
  style,
}: BigTabsProps<T>) {
  return (
    <SegmentedTabs
      tabs={tabs}
      active={active}
      onChange={onChange}
      swipeable={swipeable}
      // The old bar carried this spacing itself; keep it so the six screens that
      // render BigTabs do not shift. Callers can still override through `style`.
      style={{ marginBottom: 16, ...style }}
    />
  );
}
