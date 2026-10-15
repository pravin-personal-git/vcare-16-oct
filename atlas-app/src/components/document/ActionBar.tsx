'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ask } from '@/components/ui/ask';

/**
 * The action bar on every document and job page (11 Oct 2026, Option A of the
 * approved ops-pages demo).
 *
 * One clear first action (filled, key N), money in yellow, WhatsApp in its own
 * green with a menu of other ways to send, the everyday actions soft with a
 * coloured icon, and everything else - including the destructive one, in red
 * - behind More. Cancel used to sit beside Edit as an equal; it no longer
 * does, and it always asks for a reason (the caller's onClick opens that).
 */

export interface BarAction {
  label: string;
  icon?: IconName;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  /** A keyboard key that triggers it (ignored while typing). */
  kbd?: string;
  iconTone?: 'brand' | 'success' | 'danger' | 'warning' | 'wa' | 'muted';
}

export function ActionBar({
  status, next, money, whatsapp, sendMenu = [], actions = [], more = [], destructive, right, className = '',
}: {
  /** A badge or text at the start (e.g. "Issued"). */
  status?: ReactNode;
  next?: BarAction & { variant?: 'primary' | 'success' };
  money?: BarAction;
  whatsapp?: BarAction;
  /** Under WhatsApp's ▾: other ways to send (copy link, print, email). */
  sendMenu?: BarAction[];
  /** Soft buttons (Edit, Print…). */
  actions?: BarAction[];
  /** Inside More. */
  more?: BarAction[];
  /** Last item in More, in red. */
  destructive?: BarAction;
  right?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState<null | 'more' | 'send'>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  useEffect(() => {
    const keyed = [next, money, whatsapp, ...actions].filter((a): a is BarAction => !!a?.kbd && !a.disabled);
    if (!keyed.length) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return;
      if (document.querySelector('[role="dialog"]')) return;
      const hit = keyed.find((a) => a.kbd!.toLowerCase() === e.key.toLowerCase());
      if (hit) { e.preventDefault(); hit.onClick(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, money, whatsapp, actions]);

  const menu = (items: BarAction[], tail?: BarAction) => (
    <div className="absolute end-0 top-11 z-30 w-60 animate-fade-in rounded border border-border bg-card p-1.5 shadow-raised" role="menu">
      {items.map((a) => (
        <button key={a.label} type="button" role="menuitem" disabled={a.disabled && !a.title} aria-disabled={a.disabled || undefined} title={a.title}
          onClick={() => { setOpen(null); if (a.disabled) { if (a.title) void ask.tell({ icon: 'lock', title: 'Not available yet', message: a.title }); return; } a.onClick(); }}
          className={`flex w-full items-center gap-2 rounded-sm px-3 py-2 text-start text-sm disabled:opacity-45 ${a.disabled ? 'opacity-45' : 'hover:bg-muted'}`}>
          {a.icon && <Icon name={a.icon} className="h-3.5 w-3.5 text-muted-foreground" />}{a.label}
        </button>
      ))}
      {tail && (
        <>
          {items.length > 0 && <div className="my-1 h-px bg-border" />}
          <button type="button" role="menuitem" disabled={tail.disabled && !tail.title} aria-disabled={tail.disabled || undefined} title={tail.title}
            onClick={() => { setOpen(null); if (tail.disabled) { if (tail.title) void ask.tell({ icon: 'lock', title: 'Not available yet', message: tail.title }); return; } tail.onClick(); }}
            className={`flex w-full items-center gap-2 rounded-sm px-3 py-2 text-start text-sm text-danger disabled:opacity-45 ${tail.disabled ? 'opacity-45' : 'hover:bg-danger/10'}`}>
            <Icon name={tail.icon ?? 'ban'} className="h-3.5 w-3.5" />{tail.label}
          </button>
        </>
      )}
    </div>
  );

  return (
    <div ref={ref} className={`no-print flex flex-wrap items-center gap-2 rounded border border-border bg-card p-2 ${className}`}>
      {status}
      {next && (
        <Button variant={next.variant ?? 'primary'} icon={next.icon} kbd={next.kbd} disabled={next.disabled} title={next.title} onClick={next.onClick}>{next.label}</Button>
      )}
      {money && <Button variant="money" icon={money.icon ?? 'credit-card'} kbd={money.kbd} disabled={money.disabled} title={money.title} onClick={money.onClick}>{money.label}</Button>}
      {whatsapp && (
        <div className="relative flex">
          <Button variant="wa" icon="whatsapp" disabled={whatsapp.disabled} title={whatsapp.title} onClick={whatsapp.onClick}
            className={sendMenu.length ? 'rounded-e-none' : ''}>{whatsapp.label}</Button>
          {sendMenu.length > 0 && (
            <button type="button" aria-label="Other ways to send" aria-expanded={open === 'send'} onClick={() => setOpen(open === 'send' ? null : 'send')}
              className="btn-lift flex h-ctl items-center rounded-e-full border-s border-wa/25 bg-wa/10 px-2.5 text-wa ring-1 ring-inset ring-wa/25 hover:bg-wa/15">
              <Icon name="chevron-down" className="h-3.5 w-3.5" />
            </button>
          )}
          {open === 'send' && menu(sendMenu)}
        </div>
      )}
      {actions.map((a) => (
        <Button key={a.label} variant="soft" icon={a.icon} iconTone={a.iconTone} kbd={a.kbd} disabled={a.disabled} title={a.title} onClick={a.onClick}>{a.label}</Button>
      ))}
      {right}
      {(more.length > 0 || destructive) && (
        <div className="relative ms-auto">
          <Button variant="ghost" icon="more-vertical" aria-expanded={open === 'more'} onClick={() => setOpen(open === 'more' ? null : 'more')}>More</Button>
          {open === 'more' && menu(more, destructive)}
        </div>
      )}
    </div>
  );
}
