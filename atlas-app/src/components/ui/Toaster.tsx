'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { TOAST_KEY } from '@/lib/held-message';

/**
 * One toast at a time, bottom of the screen (5 Oct 2026). Shows a message
 * parked by `toast()` before a reload, or sent while the page stays. Stays 8
 * seconds - long enough to read "It waits on …" - or until closed.
 */
export function Toaster() {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    try {
      const parked = window.sessionStorage.getItem(TOAST_KEY);
      if (parked) { window.sessionStorage.removeItem(TOAST_KEY); setText(parked); }
    } catch { /* storage blocked */ }
    const on = (e: Event) => {
      try { window.sessionStorage.removeItem(TOAST_KEY); } catch { /* storage blocked */ }
      setText((e as CustomEvent<string>).detail);
    };
    window.addEventListener(TOAST_KEY, on);
    return () => window.removeEventListener(TOAST_KEY, on);
  }, []);

  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => setText(null), 8000);
    return () => clearTimeout(t);
  }, [text]);

  if (!text) return null;
  return (
    <div role="status" aria-live="polite"
      className="fixed inset-x-0 bottom-4 z-[100] mx-auto flex w-[min(34rem,calc(100%-2rem))] items-start gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-lg">
      <Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 leading-relaxed">{text}</span>
      <button type="button" aria-label="Close" onClick={() => setText(null)} className="shrink-0 text-muted-foreground hover:text-foreground">
        <Icon name="x" className="h-4 w-4" />
      </button>
    </div>
  );
}
