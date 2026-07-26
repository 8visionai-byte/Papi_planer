"use client";

/**
 * ComponentField - one row of the "Moja energia" screen: a single energy component.
 *
 * Three shapes, picked from `kind` + `auto` (ENERGIA-SPEC section 2 and 5):
 *
 * - `auto`      -> read only. The value is computed by the app (meals, activities,
 *                  the day entry), so editing it here would create a second truth.
 *                  A null value prints "brak danych", never "0" - not logging a meal
 *                  and eating nothing are different facts.
 * - `bool`      -> the whole row is one switch (role="switch"), 44 px+ target,
 *                  selection haptic.
 * - `up`/`window` manual -> stepper: minus / value / plus, each button 44x44.
 *                  The step follows the unit (water 250 ml, minutes 5, scale 1-10 -> 1),
 *                  so the common move is one tap, not typing.
 *
 * The component never talks to the network. It reports the new value upwards and the
 * screen owns the optimistic state plus the debounced PATCH, which is what keeps a
 * held "+" from firing twenty requests.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, T, TYPO, MOTION, fieldControlStyle } from "@/components/ui";

/* ------------------------------------------------------------------ */
/*  Contract (ENERGIA-SPEC section 4: GET /api/energy)                  */
/* ------------------------------------------------------------------ */

export type EnergyKind = "up" | "window" | "bool";

export interface EnergyComponentDTO {
  key: string;
  label: string;
  kind: EnergyKind;
  /** Where an automatic value comes from. Empty / null = the user types it in. */
  source?: string | null;
  target?: number | null;
  tolerance?: number | null;
  unit?: string | null;
  /** Weight inside the pillar, 0-100. */
  weight: number;
  hint?: string | null;
  /** Computed value for `auto`, the stored entry for manual ones. */
  value: number | null;
  /** 0-100 fill of this component. */
  percent: number;
  /** True when the app computes the value and the field is read only. */
  auto?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Pure helpers - shared with the screen so one formula lives once     */
/* ------------------------------------------------------------------ */

/** True when the value is computed by the app and must not be edited by hand. */
export function isAuto(c: EnergyComponentDTO): boolean {
  return c.auto === true || (typeof c.source === "string" && c.source.trim() !== "");
}

/**
 * Fill of a single component in percent, verbatim from ENERGIA-SPEC section 2.
 * Used for the optimistic redraw before the server answers.
 *
 * Must stay identical to `scoreComponent` in src/lib/energy/score.ts. Any difference
 * shows up as the ring jumping the moment the server replies, which reads as a bug
 * even when the saved number is right.
 */
export function componentPercent(c: EnergyComponentDTO, value: number | null): number {
  if (value == null) return 0;
  if (c.kind === "bool") return value > 0 ? 100 : 0;

  const target = c.target;

  if (c.kind === "up") {
    // A target of zero or an uncomputable one cannot be reached, so it scores nothing.
    if (target == null || target <= 0) return 0;
    return Math.max(0, Math.min(1, value / target)) * 100;
  }

  // window: hitting the point. Outside the tolerance the component is a zero.
  if (target == null) return 0;
  const tolerance = c.tolerance ?? 0;
  if (tolerance <= 0) return value === target ? 100 : 0;
  return Math.max(0, 1 - Math.abs(value - target) / tolerance) * 100;
}

/**
 * True when the day cannot produce a target for this component (no live weight, no
 * profile). The screen then leaves it out of its optimistic pillar average, exactly
 * like the server does.
 */
export function hasNoTarget(c: EnergyComponentDTO): boolean {
  return c.kind !== "bool" && c.target == null;
}

/** Decimal places for this unit. Hours are the only fractional unit in the spec. */
export function decimalsFor(c: EnergyComponentDTO): number {
  return (c.unit ?? "").toLowerCase() === "h" ? 1 : 0;
}

/**
 * Step of one tap. Deliberately unit-driven: water moves by a glass (250 ml),
 * minutes by 5 (or by 1 when the whole target is short, e.g. 10 min of breathing),
 * a 1-10 scale by 1.
 */
export function stepFor(c: EnergyComponentDTO): number {
  const unit = (c.unit ?? "").toLowerCase();
  const target = c.target ?? 0;
  if (unit === "ml") return 250;
  if (unit === "min") return target > 0 && target <= 20 ? 1 : 5;
  if (unit === "kcal") return 50;
  if (unit === "g") return 5;
  if (unit === "h") return 0.5;
  // 1-10 scale: no unit and a small target
  if (!c.unit && target > 0 && target <= 10) return 1;
  return 1;
}

/** Upper bound for a 1-10 scale. Everything else grows freely. */
function maxFor(c: EnergyComponentDTO): number | undefined {
  const target = c.target ?? 0;
  if (!c.unit && target > 0 && target <= 10) return 10;
  return undefined;
}

/** Polish number: comma as the decimal separator, no locale API (SSR safe). */
export function formatNumber(value: number, decimals: number): string {
  return value.toFixed(decimals).replace(".", ",");
}

/** Accepts both "7,5" and "7.5". Returns null for anything that is not a number. */
function parseNumber(text: string): number | null {
  const normalized = text.replace(",", ".").trim();
  if (normalized === "") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** "1500 ml", "6", "7,5 h". */
export function formatValue(c: EnergyComponentDTO, value: number | null): string {
  if (value == null) return "brak danych";
  const body = formatNumber(value, decimalsFor(c));
  return c.unit ? `${body} ${c.unit}` : body;
}

/** "cel 2500 ml" / "cel 7,5 h, tolerancja 1,5" - shown under the control. */
export function targetText(c: EnergyComponentDTO): string | null {
  if (c.kind === "bool") return null;
  // The calorie and protein goals are computed from the live weight. Without weight
  // or profile there is no honest number to print, so we say so instead of guessing.
  if (c.target == null) return "cel policzy się, gdy uzupełnisz wagę i profil";
  const decimals = decimalsFor(c);
  const goal = `cel ${formatNumber(c.target, decimals)}${c.unit ? ` ${c.unit}` : ""}`;
  if (c.kind === "window" && c.tolerance != null) {
    return `${goal}, tolerancja ${formatNumber(c.tolerance, decimals)}`;
  }
  return goal;
}

/**
 * Human sentence for an automatic value. Matched loosely on purpose: the API decides
 * what goes into `source`, and an unknown source degrades to a true generic sentence
 * instead of printing a database word at the user.
 */
export function sourceText(c: EnergyComponentDTO): string {
  const source = (c.source ?? "").toLowerCase();
  if (!source) return "liczone automatycznie";
  if (source.includes("posil") || source.includes("meal") || source.includes("diet")) {
    return "liczone z posiłków";
  }
  if (source.includes("medyt") || source.includes("vipas") || source.includes("medit")) {
    return "liczone z medytacji";
  }
  if (source.includes("nauk") || source.includes("learn") || source.includes("study")) {
    return "liczone z nauki";
  }
  if (
    source.includes("ruch") ||
    source.includes("aktyw") ||
    source.includes("activ") ||
    source.includes("train") ||
    source.includes("workout")
  ) {
    return "liczone z aktywności";
  }
  if (source.includes("sen") || source.includes("sleep") || source.includes("journal")) {
    return "liczone z wpisu dnia";
  }
  return "liczone automatycznie";
}

/* ------------------------------------------------------------------ */
/*  Toggle switch (also used by the settings tab)                       */
/* ------------------------------------------------------------------ */

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name. Required - the switch itself has no text. */
  ariaLabel: string;
  disabled?: boolean;
  /** "md" = 56x32 track (settings), "lg" = 64x36 track (daily screen). */
  size?: "md" | "lg";
}

/**
 * Switch built on Pressable, so it inherits the 44 px floor, the press animation and
 * the haptic fired on touch down instead of after the server answers.
 */
export function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
  disabled = false,
  size = "md",
}: ToggleSwitchProps) {
  const trackW = size === "lg" ? 64 : 56;
  const trackH = size === "lg" ? 36 : 32;
  const knob = trackH - 6;

  return (
    <Pressable
      as="button"
      role="switch"
      ariaChecked={checked}
      ariaLabel={ariaLabel}
      disabled={disabled}
      haptic="selection"
      press="sm"
      stopPropagation
      onPress={() => onChange(!checked)}
      style={{
        flex: "0 0 auto",
        width: trackW,
        // the visual track is shorter than the touch target on purpose
        minWidth: trackW,
        minHeight: T.tapMin,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          width: trackW,
          height: trackH,
          padding: 3,
          boxSizing: "border-box",
          borderRadius: T.rFull,
          background: checked ? T.success : T.surface3,
          transition: `background ${MOTION.fast} ${MOTION.easeStandard}`,
        }}
      >
        <span
          style={{
            display: "block",
            width: knob,
            height: knob,
            borderRadius: T.rFull,
            background: T.bgElevated,
            boxShadow: T.elev1,
            transform: `translateX(${checked ? trackW - knob - 6 : 0}px)`,
            transition: `transform ${MOTION.base} ${MOTION.easeIos}`,
          }}
        />
      </span>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  ComponentField                                                      */
/* ------------------------------------------------------------------ */

export interface ComponentFieldProps {
  component: EnergyComponentDTO;
  /** Fired on every tap / edit. The screen debounces the PATCH, not this component. */
  onChange: (key: string, value: number) => void;
  /** Blocks editing while a config save is in flight. */
  disabled?: boolean;
}

export function ComponentField({ component, onChange, disabled = false }: ComponentFieldProps) {
  const auto = isAuto(component);
  const decimals = decimalsFor(component);
  const step = stepFor(component);
  const max = maxFor(component);
  const percent = Math.round(component.percent);

  /* Local text state so a half-typed number ("1", "7,") is not fought by the
     incoming props. Synced from props only while the input is not focused. */
  const [text, setText] = useState(() =>
    component.value == null ? "" : formatNumber(component.value, decimals),
  );
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setText(component.value == null ? "" : formatNumber(component.value, decimals));
  }, [component.value, decimals]);

  const commit = useCallback(
    (next: number) => {
      const clampedLow = Math.max(0, next);
      const clamped = max != null ? Math.min(max, clampedLow) : clampedLow;
      // kill floating point noise from 0.5 steps before it reaches the API
      const rounded = Number(clamped.toFixed(decimals));
      setText(formatNumber(rounded, decimals));
      onChange(component.key, rounded);
    },
    [component.key, decimals, max, onChange],
  );

  const bump = useCallback(
    (direction: 1 | -1) => {
      const current = component.value ?? 0;
      commit(current + direction * step);
    },
    [commit, component.value, step],
  );

  /* The goal and the hint are two different facts, so both are shown. Collapsing them
     into one (`hint ?? targetText`) hid the calorie and water goals completely, which
     are exactly the two the user is supposed to aim at. */
  const goal = targetText(component);
  const hint = component.hint;

  /* ---------------- auto: read only ---------------- */
  if (auto) {
    const meta = [sourceText(component), goal].filter(Boolean).join(" · ");
    return (
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...TYPO.callout, color: T.text, fontWeight: 600 }}>{component.label}</div>
          <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>{meta}</div>
          {hint ? (
            <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>{hint}</div>
          ) : null}
        </div>
        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <div
            style={{
              ...TYPO.bodyBold,
              color: component.value == null ? T.text3 : T.text,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatValue(component, component.value)}
          </div>
          <div style={{ ...TYPO.footnote, color: T.text3, fontVariantNumeric: "tabular-nums" }}>
            {percent}%
          </div>
        </div>
      </div>
    );
  }

  /* ---------------- bool: the whole row is the switch ---------------- */
  if (component.kind === "bool") {
    const checked = (component.value ?? 0) > 0;
    return (
      <Pressable
        as="div"
        role="switch"
        ariaChecked={checked}
        ariaLabel={component.label}
        disabled={disabled}
        haptic="selection"
        press="lg"
        onPress={() => onChange(component.key, checked ? 0 : 1)}
        style={{
          ...rowStyle,
          display: "flex",
          width: "100%",
          textAlign: "left",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...TYPO.callout, color: T.text, fontWeight: 600 }}>{component.label}</div>
          {hint ? (
            <div style={{ ...TYPO.footnote, color: T.text3, marginTop: 2 }}>{hint}</div>
          ) : null}
        </div>
        {/* purely visual - the row above already carries role="switch" */}
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            width: 64,
            height: 36,
            flex: "0 0 auto",
            padding: 3,
            boxSizing: "border-box",
            borderRadius: T.rFull,
            background: checked ? T.success : T.surface3,
            transition: `background ${MOTION.fast} ${MOTION.easeStandard}`,
          }}
        >
          <span
            style={{
              display: "block",
              width: 30,
              height: 30,
              borderRadius: T.rFull,
              background: T.bgElevated,
              boxShadow: T.elev1,
              transform: `translateX(${checked ? 28 : 0}px)`,
              transition: `transform ${MOTION.base} ${MOTION.easeIos}`,
            }}
          />
        </span>
      </Pressable>
    );
  }

  /* ---------------- up / window: stepper ---------------- */
  return (
    <div style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch", gap: T.sp2 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: T.sp2 }}>
        <div style={{ ...TYPO.callout, color: T.text, fontWeight: 600, flex: 1, minWidth: 0 }}>
          {component.label}
        </div>
        <div style={{ ...TYPO.footnote, color: T.text3, fontVariantNumeric: "tabular-nums" }}>
          {percent}%
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: T.sp2 }}>
        <StepButton
          label={`Zmniejsz: ${component.label}`}
          sign="minus"
          disabled={disabled || (component.value ?? 0) <= 0}
          onPress={() => bump(-1)}
        />

        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <input
            type="text"
            inputMode={decimals > 0 ? "decimal" : "numeric"}
            value={text}
            disabled={disabled}
            aria-label={component.label}
            placeholder="0"
            onFocus={() => {
              focusedRef.current = true;
            }}
            onBlur={() => {
              focusedRef.current = false;
              const parsed = parseNumber(text);
              if (parsed == null) {
                setText(
                  component.value == null ? "" : formatNumber(component.value, decimals),
                );
              } else {
                commit(parsed);
              }
            }}
            onChange={(e) => {
              setText(e.target.value);
              const parsed = parseNumber(e.target.value);
              if (parsed != null) {
                const clampedLow = Math.max(0, parsed);
                const clamped = max != null ? Math.min(max, clampedLow) : clampedLow;
                onChange(component.key, Number(clamped.toFixed(decimals)));
              }
            }}
            style={{
              ...fieldControlStyle,
              textAlign: "center",
              paddingRight: component.unit ? 44 : undefined,
              fontVariantNumeric: "tabular-nums",
              fontWeight: 600,
            }}
          />
          {component.unit ? (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                right: T.sp3,
                top: "50%",
                transform: "translateY(-50%)",
                ...TYPO.footnote,
                color: T.text3,
              }}
            >
              {component.unit}
            </span>
          ) : null}
        </div>

        <StepButton
          label={`Zwiększ: ${component.label}`}
          sign="plus"
          disabled={disabled || (max != null && (component.value ?? 0) >= max)}
          onPress={() => bump(1)}
        />
      </div>

      {goal ? <div style={{ ...TYPO.footnote, color: T.text3 }}>{goal}</div> : null}
      {hint ? <div style={{ ...TYPO.footnote, color: T.text3 }}>{hint}</div> : null}
    </div>
  );
}

/** 44x44 stepper button. The glyph is drawn, not typed, so it never wobbles. */
function StepButton({
  label,
  sign,
  disabled,
  onPress,
}: {
  label: string;
  sign: "plus" | "minus";
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      as="button"
      ariaLabel={label}
      disabled={disabled}
      haptic="tap"
      press="sm"
      onPress={onPress}
      style={{
        width: T.tapMin,
        height: T.tapMin,
        flex: "0 0 auto",
        borderRadius: T.rMd,
        background: T.surface2,
        border: `1px solid ${T.border}`,
        color: T.text,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <line
          x1="3"
          y1="9"
          x2="15"
          y2="9"
          style={{ stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" }}
        />
        {sign === "plus" ? (
          <line
            x1="9"
            y1="3"
            x2="9"
            y2="15"
            style={{ stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" }}
          />
        ) : null}
      </svg>
    </Pressable>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: T.sp3,
  minHeight: T.tapMin,
  padding: `${T.sp3} 0`,
  boxSizing: "border-box",
};

export default ComponentField;
