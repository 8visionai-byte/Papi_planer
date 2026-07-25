"use client";

import React, { useId } from "react";
import { T, TYPO } from "./tokens";

export interface FieldProps {
  /** Visible label above the control. */
  label?: string;
  /** Helper text under the control. Hidden while `error` is shown. */
  hint?: string;
  /** Error message under the control; also paints the control frame red. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /**
   * Render prop or plain children. The render prop hands over the id and the
   * aria wiring, so the label and the message really belong to the control.
   */
  children: React.ReactNode | ((props: FieldChildProps) => React.ReactNode);
  /** Right side of the label row: counter, "opcjonalne", a small action. */
  labelTrailing?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export interface FieldChildProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  disabled?: boolean;
}

/**
 * Base style for a native input / select inside a Field.
 *
 * 17 px is not cosmetic: below 16 px Safari on iOS zooms the page on every focus,
 * which is exactly why zoom had to be blocked in this app. 52 px height clears the
 * 44 px touch floor with room for the frame.
 *
 * @example
 * <input style={{ ...fieldControlStyle, ...(err ? fieldControlErrorStyle : null) }} />
 */
export const fieldControlStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 52,
  padding: `0 ${T.sp4}`,
  borderRadius: T.rMd,
  border: `1.5px solid ${T.border}`,
  background: T.bgElevated,
  color: T.text,
  fontSize: "var(--fs-body, 17px)",
  lineHeight: "var(--lh-body, 1.45)",
  fontFamily: "inherit",
  outline: "none",
};

/** Same, for a multiline control. */
export const fieldTextareaStyle: React.CSSProperties = {
  ...fieldControlStyle,
  minHeight: 96,
  padding: T.sp3,
  resize: "vertical",
};

/** Merge on top of the two above when the field is in error. */
export const fieldControlErrorStyle: React.CSSProperties = {
  borderColor: T.danger,
};

/**
 * Form field wrapper: label, control slot (at least 44 px tall), hint and error.
 *
 * It does not own the control, so it drops into existing forms next to the native
 * `<input>`, `<textarea>`, `<select>` and the VoiceInput component without rewriting them.
 *
 * @example
 * <Field label="Waga" hint="Podaj w kilogramach" error={err}>
 *   {(p) => <input {...p} inputMode="decimal" style={fieldControlStyle} />}
 * </Field>
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  disabled = false,
  children,
  labelTrailing,
  className,
  style,
}: FieldProps) {
  const autoId = useId();
  const controlId = `field-${autoId}`;
  const msgId = `${controlId}-msg`;
  const hasMessage = Boolean(error || hint);

  const childProps: FieldChildProps = {
    id: controlId,
    "aria-describedby": hasMessage ? msgId : undefined,
    "aria-invalid": error ? true : undefined,
    disabled: disabled || undefined,
  };

  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: T.sp2,
        width: "100%",
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}
    >
      {label ? (
        <div style={{ display: "flex", alignItems: "center", gap: T.sp2 }}>
          <label htmlFor={controlId} style={{ ...TYPO.footnote, color: T.text2, flex: 1 }}>
            {label}
            {required ? <span style={{ color: T.danger }}> *</span> : null}
          </label>
          {labelTrailing ? (
            <span style={{ ...TYPO.footnote, color: T.text3 }}>{labelTrailing}</span>
          ) : null}
        </div>
      ) : null}

      {/* control slot: never shorter than the touch floor */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: T.tapMin, width: "100%" }}>
        {typeof children === "function" ? children(childProps) : children}
      </div>

      {hasMessage ? (
        <div
          id={msgId}
          role={error ? "alert" : undefined}
          style={{ ...TYPO.footnote, color: error ? T.danger : T.text3 }}
        >
          {error ?? hint}
        </div>
      ) : null}
    </div>
  );
}

export default Field;
