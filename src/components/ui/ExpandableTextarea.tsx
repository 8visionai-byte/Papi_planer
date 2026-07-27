"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Button } from "./Button";
import { fieldTextareaStyle } from "./Field";
import { Pressable } from "./Pressable";
import { Sheet } from "./Sheet";
import { T, TYPO } from "./tokens";

/**
 * Props handed to a custom control by `renderControl`.
 *
 * The small copy and the full-screen copy get the SAME shape on purpose: a field that
 * already carries voice dictation (VoiceTextarea) keeps it in both places instead of
 * being downgraded to a plain textarea just to gain the expand button.
 */
export interface ExpandableControlProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Height in pixels. The full-screen copy also sends a `style` that overrides it. */
  minHeight: number;
  /** Meant to be merged LAST into the control's own inline style. */
  style?: React.CSSProperties;
}

export interface ExpandableTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Visible rows of the small copy. Default 4. */
  rows?: number;
  disabled?: boolean;
  /** Enforced on the plain textarea and printed as a counter in the full-screen editor. */
  maxLength?: number;
  /**
   * Title of the full-screen editor. Deliberately NOT printed inline: every call site
   * already draws its own label, and two labels on one field read as a bug.
   */
  label?: string;
  /** Merged last into the control style, so a call site keeps its exact height / radius. */
  style?: React.CSSProperties;
  /** Swap the plain textarea for another control (VoiceTextarea keeps the microphone). */
  renderControl?: (props: ExpandableControlProps) => React.ReactNode;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/** One line of body text (17 px * 1.45), rounded. */
const ROW_PX = 25;
/** Top + bottom padding of fieldTextareaStyle (T.sp3 twice). */
const PAD_PX = 24;
/** Right gutter of the plain textarea, so the last line never slides under the button. */
const BUTTON_GUTTER = 52;
/** Height of the field inside the full-screen editor: a long prompt in one eyeful. */
const EXPANDED_HEIGHT = "56dvh";

function rowsToPx(rows: number): number {
  return Math.max(1, rows) * ROW_PX + PAD_PX;
}

/** Two arrows on the diagonal - the "make it bigger" glyph. SVG stroke 1.75, never emoji. */
function ExpandIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

/**
 * Multiline field with a full-screen editor.
 *
 * The owner keeps long system prompts in these boxes and could only read them through a
 * four-line window ("czasem ten prompt jest duzy i chcialbym wieksze okno"). Two ways in,
 * both asked for: the small button with the two diagonal arrows in the bottom right
 * corner, and a double click anywhere in the text.
 *
 * The full-screen copy edits a private draft. "Gotowe" writes it to the parent, "Anuluj"
 * (and Escape, and the drag down) throws it away and leaves the old text alone.
 *
 * @example
 * <ExpandableTextarea
 *   label="System Prompt"
 *   value={form.systemPrompt}
 *   onChange={(v) => setForm({ ...form, systemPrompt: v })}
 *   rows={5}
 *   renderControl={(p) => <VoiceTextarea {...p} />}
 * />
 */
export function ExpandableTextarea({
  value,
  onChange,
  placeholder,
  rows = 4,
  disabled = false,
  maxLength,
  label,
  style,
  renderControl,
  id,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
}: ExpandableTextareaProps) {
  const [open, setOpen] = useState(false);
  /**
   * Text being edited full screen. It stays here and is NOT pushed to the parent until
   * "Gotowe" - that is the only way "Anuluj" can put the previous text back.
   *
   * Both pieces of state are written from event handlers only. Never from render: React 19
   * drops a render-time update when the parent updates in the same event, and this app has
   * already been frozen once by exactly that pattern.
   */
  const [draft, setDraft] = useState("");

  const openEditor = useCallback(() => {
    // `open` guard: re-opening would call setDraft(value) again and throw away
    // everything typed in the full-screen editor since it opened.
    if (disabled || open) return;
    setDraft(value);
    setOpen(true);
  }, [disabled, open, value]);

  const closeEditor = useCallback(() => setOpen(false), []);

  const confirm = useCallback(() => {
    onChange(draft);
    setOpen(false);
  }, [draft, onChange]);

  /**
   * Escape closes THIS editor and nothing else.
   *
   * These fields sit inside other sheets (the mentor form is one). Every open Sheet
   * listens for Escape on `document` in the bubble phase, and `stopPropagation` between
   * two listeners on the same node does not stop the other one - so one Escape used to
   * shut the editor AND the form behind it, losing the whole edit. A capture-phase
   * listener runs before all of them and `stopImmediatePropagation` ends the event there.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  const inlineHeight = rowsToPx(rows);

  const inlineControl = renderControl ? (
    // VoiceTextarea already reserves 62 px on the right for its microphone, which is more
    // than the expand button needs, so its padding is left exactly as it was.
    renderControl({ value, onChange, placeholder, disabled, minHeight: inlineHeight, style })
  ) : (
    <textarea
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      value={value}
      disabled={disabled}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        ...fieldTextareaStyle,
        // block, or the inline-block baseline leaves ~4 px of dead space under the field
        // and the expand button hangs below its bottom edge.
        display: "block",
        minHeight: inlineHeight,
        paddingRight: BUTTON_GUTTER,
        ...style,
      }}
    />
  );

  const expandedControl = renderControl ? (
    renderControl({
      value: draft,
      onChange: setDraft,
      placeholder,
      disabled,
      minHeight: 320,
      style: {
        minHeight: EXPANDED_HEIGHT,
        // Body size from the type scale, not a number: this is the text the owner came
        // here to read.
        fontSize: TYPO.body.fontSize,
        lineHeight: TYPO.body.lineHeight,
      },
    })
  ) : (
    <textarea
      value={draft}
      disabled={disabled}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      style={{
        ...fieldTextareaStyle,
        display: "block",
        minHeight: EXPANDED_HEIGHT,
        resize: "none",
      }}
    />
  );

  return (
    /* The Sheet is a SIBLING of the double-click wrapper, never a child of it. React
       routes events from a portal through the React tree, not the DOM tree, so with the
       Sheet nested inside, a double click on the full-screen textarea (selecting a word)
       reached the wrapper's handler and re-ran openEditor - which reset the draft to the
       parent value and threw the edit away. */
    <>
      <div
        style={{ position: "relative", width: "100%" }}
        /**
         * The second way in. preventDefault is never called, so a double click still selects
         * the word under the finger. Only a hit on the text itself counts: the microphone
         * inside VoiceTextarea is a normal button and double tapping it must stay a
         * start/stop, not a full-screen editor.
         */
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).tagName !== "TEXTAREA") return;
          openEditor();
        }}
      >
        {inlineControl}

        {/* 44x44 target, 32x32 drawing. Sits in the bottom right corner of the field; while
            a recording is running VoiceTextarea grows an indicator under the box and the
            button follows it down, which lasts as long as the recording does. */}
        <Pressable
          onPress={openEditor}
          disabled={disabled}
          ariaLabel="Powiększ pole"
          title="Powiększ pole"
          style={{
            position: "absolute",
            right: 4,
            bottom: 4,
            background: "transparent",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: T.rSm,
              background: T.bgElevated,
              border: `1px solid ${T.border}`,
              color: T.text2,
              boxShadow: T.elev1,
            }}
          >
            <ExpandIcon />
          </span>
        </Pressable>
      </div>

      <Sheet
        open={open}
        onClose={closeEditor}
        title={label || "Edycja tekstu"}
        size="full"
        // A tap on the backdrop would throw the whole edit away; closing stays deliberate
        // (Anuluj, Escape, drag down).
        dismissOnBackdrop={false}
        footer={
          <div style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}>
            <Button size="lg" fullWidth haptic="impact" onPress={confirm}>
              Gotowe
            </Button>
            <Button variant="ghost" size="md" fullWidth onPress={closeEditor}>
              Anuluj
            </Button>
          </div>
        }
      >
        <div
          // Ctrl/Cmd+Enter confirms. Listened for on the wrapper, so it works for the plain
          // textarea and for VoiceTextarea alike (the event bubbles out of both).
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              confirm();
            }
          }}
          style={{ display: "flex", flexDirection: "column", gap: T.sp2 }}
        >
          {/* No autofocus: the owner opens this to READ a long prompt first, and a keyboard
              popping up would eat half of what he came to see. */}
          {expandedControl}

          {typeof maxLength === "number" && (
            <div
              style={{
                ...TYPO.footnote,
                color: draft.length > maxLength ? T.dangerOnSurface : T.text3,
                textAlign: "right",
              }}
            >
              {draft.length} / {maxLength} znaków
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}

export default ExpandableTextarea;
