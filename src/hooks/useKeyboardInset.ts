"use client";

import { useEffect, useState } from "react";

/**
 * On-screen keyboard support for the app shell.
 *
 * WHY TWO MECHANISMS
 * Android (Chrome / installed PWA) honours `interactiveWidget: "resizes-content"`
 * from src/app/layout.tsx: the LAYOUT viewport shrinks when the keyboard opens, so
 * `position: fixed; bottom: 0` already lands above the keyboard and no JavaScript is
 * needed to lift anything.
 * iOS Safari (and an installed PWA on iOS) ignores that hint: the layout viewport keeps
 * its full height and only the VISUAL viewport shrinks, so a fixed bottom bar stays
 * underneath the keyboard.
 *
 * `useKeyboardInsetVar` measures the gap between the two viewports and publishes it as
 * `--kb` on <html>. The formula self-corrects: where the layout viewport also shrinks
 * (Android) the gap is ~0 and nothing is lifted twice.
 *
 * KNOWN LIMITS (documented on purpose, do not "fix" by guessing):
 * - `window.visualViewport` is missing on very old WebViews. `--kb` then stays 0 and we
 *   fall back to the browser's own scroll-into-view. No crash, just no lift.
 * - On iOS the keyboard height reported mid-animation is intermediate, so the lift
 *   follows the keyboard instead of jumping. That is intended.
 * - A floating / split keyboard on iPad reports its real height only while docked.
 * - A hardware (Bluetooth) keyboard shows no on-screen keyboard: the inset stays 0,
 *   which is correct, but `useKeyboardOpen` still reports "open" because a text field
 *   has focus. That only hides the tab bar, it never hides content.
 */

const KB_VAR = "--kb";

/** True for a control that actually raises a soft keyboard. */
function isTextEntry(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !(
    type === "checkbox" ||
    type === "radio" ||
    type === "button" ||
    type === "submit" ||
    type === "reset" ||
    type === "range" ||
    type === "color" ||
    type === "file" ||
    type === "image"
  );
}

/** Distance in px between the bottom of the layout viewport and the visual viewport. */
function measureInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const gap = window.innerHeight - (vv.height + vv.offsetTop);
  // Sub-pixel noise on every scroll: anything under 40px is not a keyboard.
  return gap > 40 ? Math.round(gap) : 0;
}

/**
 * Publishes the keyboard height as `--kb` on <html>. Mount ONCE, in the app shell.
 *
 * @example
 * // in a fixed bottom bar
 * style={{ paddingBottom: "calc(var(--sp-3) + max(var(--safe-b), var(--kb, 0px)))" }}
 */
export function useKeyboardInsetVar(): void {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    if (!vv) {
      root.style.setProperty(KB_VAR, "0px");
      return;
    }

    let frame = 0;
    const apply = () => {
      frame = 0;
      root.style.setProperty(KB_VAR, `${measureInset()}px`);
    };
    // visualViewport fires resize AND scroll many times per keyboard animation frame;
    // coalescing into one rAF keeps this off the main-thread hot path.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
      root.style.removeProperty(KB_VAR);
    };
  }, []);
}

/**
 * True while a soft keyboard is (about to be) on screen on a touch device.
 *
 * Deliberately driven by FOCUS, not by viewport height: on Android the layout viewport
 * shrinks with the keyboard, so a height comparison there measures ~0 and would never
 * fire. Focus is the one signal both platforms agree on.
 * Always false on a mouse device, so the desktop layout never changes.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    if (!coarse) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      setOpen(isTextEntry(document.activeElement));
    };
    // focusout fires before the next focusin; one rAF later the new field is already
    // focused, so moving between two fields never flickers the tab bar.
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(apply);
    };

    window.addEventListener("focusin", schedule);
    window.addEventListener("focusout", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("focusin", schedule);
      window.removeEventListener("focusout", schedule);
    };
  }, []);

  return open;
}
