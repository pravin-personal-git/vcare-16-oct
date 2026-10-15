/**
 * "Sent for approval" without a browser popup (5 Oct 2026).
 *
 * Many screens reload the page after a successful action, so a message shown
 * on the old page vanishes with it. The message is parked in sessionStorage and
 * the toast (components/ui/Toaster) shows it on the page that loads next - or
 * at once, through an event, when the screen does not reload.
 */
const KEY = 'atlas:toast';

export function toast(message: string): void {
  if (typeof window === 'undefined' || !message) return;
  try { window.sessionStorage.setItem(KEY, message); } catch { /* private mode - the event still shows it */ }
  window.dispatchEvent(new CustomEvent(KEY, { detail: message }));
}

/** After a successful action: if the server said it was held for approval, say so. */
export function sayIfHeld(r: { message?: string } | null | undefined): void {
  if (r?.message && /approv/i.test(r.message)) toast(r.message);
}

export const TOAST_KEY = KEY;
