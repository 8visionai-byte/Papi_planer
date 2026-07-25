/**
 * Token bridge for the UI primitive library.
 *
 * Every primitive reads its colors, sizes, radii and motion from here, and every
 * value here is a `var(--token)` reference to the design-system block that lives in
 * `src/app/globals.css` (see docs/audit/DESIGN-SPEC.md section 3).
 *
 * The second argument of each `var()` is the light-mode fallback taken verbatim from
 * the spec. It only matters while the token block is not merged yet: as soon as
 * globals.css defines the tokens, the fallback is never used and dark mode works.
 * Nothing here is a hardcoded color in a component - components never write hex.
 *
 * @example
 * import { T, TYPO, MOTION } from "@/components/ui/tokens";
 * <div style={{ background: T.surface, borderRadius: T.rLg, ...TYPO.title2 }} />
 */

import type { CSSProperties } from "react";

/** Raw token references. Values are CSS strings, safe in React inline styles. */
export const T = {
  /* ---------- surfaces ---------- */
  bg: "var(--bg, #F6F6F8)",
  bgElevated: "var(--bg-elevated, #FFFFFF)",
  surface: "var(--surface, #FFFFFF)",
  surface2: "var(--surface-2, #F1F1F5)",
  surface3: "var(--surface-3, #E7E7EE)",
  overlay: "var(--overlay, rgba(12, 12, 18, 0.45))",

  /* ---------- text ---------- */
  text: "var(--text, #101018)",
  text2: "var(--text-2, #4A4A58)",
  text3: "var(--text-3, #63636F)",
  /** decorative only (2.08:1) - dividers, disabled glyphs, never a readable label */
  text4: "var(--text-4, #94A3B8)",
  textInverse: "var(--text-inverse, #FFFFFF)",

  /* ---------- lines ---------- */
  border: "var(--border, #E3E3EA)",
  borderStrong: "var(--border-strong, #C9C9D4)",
  hairline: "var(--hairline, 1px)",

  /* ---------- brand and status ----------
     Pairs: the plain token is a FILL (button background, icon, bar), the
     `*OnSurface` variant is the same colour corrected for use as TEXT on any of
     the four surfaces (ROADMAP K2: contrast has to hold on surface-3 too). */
  primary: "var(--primary, #1D4ED8)",
  primaryHover: "var(--primary-hover, #1739A8)",
  primarySoft: "var(--primary-soft, rgba(29, 78, 216, 0.10))",
  primaryText: "var(--primary-text, #FFFFFF)",
  primaryOnSurface: "var(--primary-on-surface, #1D4ED8)",
  accent: "var(--accent, #0E7490)",
  accentSoft: "var(--accent-soft, rgba(14, 116, 144, 0.10))",
  accentOnSurface: "var(--accent-on-surface, #0B6A82)",
  highlight: "var(--highlight, #B45309)",
  highlightSoft: "var(--highlight-soft, rgba(180, 83, 9, 0.12))",
  highlightOnSurface: "var(--highlight-on-surface, #92400E)",
  success: "var(--success, #047857)",
  successSoft: "var(--success-soft, rgba(4, 120, 87, 0.12))",
  successOnSurface: "var(--success-on-surface, #036B4E)",
  warning: "var(--warning, #B45309)",
  warningSoft: "var(--warning-soft, rgba(180, 83, 9, 0.12))",
  warningOnSurface: "var(--warning-on-surface, #92400E)",
  danger: "var(--danger, #C81E3A)",
  dangerSoft: "var(--danger-soft, rgba(200, 30, 58, 0.10))",
  dangerOnSurface: "var(--danger-on-surface, #B81830)",
  /** the single gradient allowed in the app: hero ring and install button */
  brandGradient: "var(--brand-gradient, linear-gradient(160deg, #FF2D95 0%, #7B2BFF 100%))",

  /* ---------- elevation ---------- */
  elev0: "var(--elev-0, none)",
  elev1: "var(--elev-1, 0 1px 2px rgba(16,16,24,0.06), 0 1px 1px rgba(16,16,24,0.04))",
  elev2: "var(--elev-2, 0 2px 6px rgba(16,16,24,0.07), 0 1px 2px rgba(16,16,24,0.05))",
  elev3: "var(--elev-3, 0 10px 24px rgba(16,16,24,0.10), 0 2px 6px rgba(16,16,24,0.06))",
  elev4: "var(--elev-4, 0 24px 60px rgba(16,16,24,0.18), 0 6px 16px rgba(16,16,24,0.08))",
  glowPrimary: "var(--glow-primary, 0 6px 24px rgba(196, 0, 110, 0.28))",
  focusRing: "var(--focus-ring, 0 0 0 3px rgba(196, 0, 110, 0.35))",

  /* ---------- radii ---------- */
  rXs: "var(--r-xs, 6px)",
  rSm: "var(--r-sm, 10px)",
  rMd: "var(--r-md, 14px)",
  rLg: "var(--r-lg, 20px)",
  rXl: "var(--r-xl, 28px)",
  rFull: "var(--r-full, 999px)",

  /* ---------- control sizes ---------- */
  tapMin: "var(--tap-min, 44px)",
  ctrlSm: "var(--ctrl-sm, 36px)",
  ctrlMd: "var(--ctrl-md, 48px)",
  ctrlLg: "var(--ctrl-lg, 56px)",

  /* ---------- spacing ---------- */
  sp1: "var(--sp-1, 4px)",
  sp2: "var(--sp-2, 8px)",
  sp3: "var(--sp-3, 12px)",
  sp4: "var(--sp-4, 16px)",
  sp5: "var(--sp-5, 20px)",
  sp6: "var(--sp-6, 24px)",
  sp8: "var(--sp-8, 32px)",
  sp10: "var(--sp-10, 40px)",
  sp12: "var(--sp-12, 48px)",
  sp16: "var(--sp-16, 64px)",
  gutter: "var(--gutter, 20px)",
  stackTight: "var(--stack-tight, 8px)",
  stack: "var(--stack, 12px)",
  stackLoose: "var(--stack-loose, 24px)",

  /* ---------- screen ---------- */
  safeT: "var(--safe-t, 0px)",
  safeB: "var(--safe-b, 0px)",
  safeL: "var(--safe-l, 0px)",
  safeR: "var(--safe-r, 0px)",
  tabbarH: "var(--tabbar-h, 64px)",
  aboveTabbar: "var(--above-tabbar, 80px)",
} as const;

/** Durations and easings. Same names as in globals.css. */
export const MOTION = {
  pressIn: "var(--dur-press-in, 60ms)",
  pressOut: "var(--dur-press-out, 260ms)",
  instant: "var(--dur-instant, 90ms)",
  fast: "var(--dur-fast, 140ms)",
  base: "var(--dur-base, 220ms)",
  slow: "var(--dur-slow, 320ms)",
  celebrate: "var(--dur-celebrate, 520ms)",

  easeOut: "var(--ease-out, cubic-bezier(0.16, 1, 0.30, 1))",
  easeIos: "var(--ease-ios, cubic-bezier(0.32, 0.72, 0, 1))",
  easeSpring: "var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1))",
  easeStandard: "var(--ease-standard, cubic-bezier(0.2, 0, 0, 1))",
} as const;

/**
 * Sheet / panel slide duration in milliseconds.
 * JavaScript timers cannot read a CSS variable, so this mirrors `--dur-slow` (320 ms).
 * Keep both in sync if the token ever changes.
 */
export const SLOW_MS = 320;

/** Typography roles from DESIGN-SPEC section 3, ready to spread into inline styles. */
export const TYPO: Record<
  | "display"
  | "metric"
  | "title1"
  | "title2"
  | "title3"
  | "body"
  | "bodyBold"
  | "callout"
  | "footnote"
  | "label",
  CSSProperties
> = {
  display: {
    fontSize: "var(--fs-display, 44px)",
    fontWeight: "var(--fw-display, 800)" as unknown as CSSProperties["fontWeight"],
    lineHeight: "var(--lh-display, 1.02)",
    letterSpacing: "var(--ls-display, -0.03em)",
    fontVariantNumeric: "tabular-nums",
  },
  metric: {
    fontSize: "var(--fs-metric, 32px)",
    fontWeight: "var(--fw-metric, 700)" as unknown as CSSProperties["fontWeight"],
    lineHeight: "var(--lh-metric, 1.05)",
    letterSpacing: "var(--ls-metric, -0.02em)",
    fontVariantNumeric: "tabular-nums",
  },
  title1: {
    fontSize: "var(--fs-title1, 28px)",
    fontWeight: "var(--fw-title1, 700)" as unknown as CSSProperties["fontWeight"],
    lineHeight: "var(--lh-title1, 1.15)",
    letterSpacing: "var(--ls-title1, -0.02em)",
  },
  title2: {
    fontSize: "var(--fs-title2, 22px)",
    fontWeight: "var(--fw-title2, 700)" as unknown as CSSProperties["fontWeight"],
    lineHeight: "var(--lh-title2, 1.20)",
    letterSpacing: "var(--ls-title2, -0.015em)",
  },
  title3: {
    fontSize: "var(--fs-title3, 17px)",
    fontWeight: "var(--fw-title3, 600)" as unknown as CSSProperties["fontWeight"],
    lineHeight: "var(--lh-title3, 1.30)",
    letterSpacing: "var(--ls-title3, -0.01em)",
  },
  body: {
    fontSize: "var(--fs-body, 17px)",
    fontWeight: "var(--fw-body, 400)" as unknown as CSSProperties["fontWeight"],
    lineHeight: "var(--lh-body, 1.45)",
  },
  bodyBold: {
    fontSize: "var(--fs-body, 17px)",
    fontWeight: 600,
    lineHeight: "var(--lh-body, 1.45)",
  },
  callout: {
    fontSize: "var(--fs-callout, 15px)",
    fontWeight: "var(--fw-callout, 400)" as unknown as CSSProperties["fontWeight"],
    lineHeight: "var(--lh-callout, 1.40)",
  },
  footnote: {
    fontSize: "var(--fs-footnote, 13px)",
    fontWeight: "var(--fw-footnote, 500)" as unknown as CSSProperties["fontWeight"],
    lineHeight: "var(--lh-footnote, 1.35)",
  },
  label: {
    fontSize: "var(--fs-label, 12px)",
    fontWeight: "var(--fw-label, 700)" as unknown as CSSProperties["fontWeight"],
    lineHeight: "var(--lh-label, 1.20)",
    letterSpacing: "var(--ls-label, 0.06em)",
    textTransform: "uppercase",
  },
};

/** Semantic tone shared by Stat, EmptyState and status badges. */
export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "accent";

/**
 * Per tone: `fg` is safe as TEXT on every surface, `fill` is the saturated colour for
 * backgrounds, bars and icons, `soft` is the tinted background behind `fg`.
 */
export const TONE: Record<Tone, { fg: string; fill: string; soft: string }> = {
  neutral: { fg: T.text, fill: T.text2, soft: T.surface2 },
  primary: { fg: T.primaryOnSurface, fill: T.primary, soft: T.primarySoft },
  success: { fg: T.successOnSurface, fill: T.success, soft: T.successSoft },
  warning: { fg: T.warningOnSurface, fill: T.warning, soft: T.warningSoft },
  danger: { fg: T.dangerOnSurface, fill: T.danger, soft: T.dangerSoft },
  accent: { fg: T.accentOnSurface, fill: T.accent, soft: T.accentSoft },
};
