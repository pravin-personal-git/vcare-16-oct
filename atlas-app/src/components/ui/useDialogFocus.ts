'use client';

import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard behaviour every dialog needs (health check UX-2): focus moves into
 * the dialog when it opens, Tab and Shift+Tab stay inside it, and focus goes
 * back to whatever opened it when it closes - so a keyboard or screen-reader
 * user is never left behind the overlay.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement as HTMLElement | null;
    const box = ref.current;
    if (!box) return;
    const items = () => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    // Prefer the first form field over the close button.
    const first = items().find((el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) ?? items()[0];
    if (!box.contains(document.activeElement)) (first ?? box).focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = items();
      if (list.length === 0) { e.preventDefault(); return; }
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); list[list.length - 1].focus(); }
      else if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0].focus(); }
    };
    box.addEventListener('keydown', onKey);
    return () => {
      box.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
