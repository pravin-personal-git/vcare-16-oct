'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { setActiveStore } from '@/app/actions/store';
import { Icon } from '@/components/ui/Icon';

interface Props {
  stores: { id: string; name: string; branchCode: string }[];
  activeStoreId: string | null;
}

interface Anchor { top: number; left: number; width: number }

/**
 * Store scope selector.
 *
 * Deliberately prominent and deliberately outlined in the brand colour: the
 * active store changes what every screen shows AND whether you may write at
 * all. A control with that much power should not look like a settings dropdown
 * tucked into a corner.
 *
 * The panel renders through a portal into `document.body` rather than as a
 * plain absolutely-positioned child. The header bar clips overflow, so the
 * panel used to render - and even reported `visibility: visible` - while
 * being entirely invisible, cut off by an ancestor it had no way to escape.
 * Same class of bug as `DataGrid`'s row menu; same fix.
 */
export function StoreSwitcher({ stores, activeStoreId }: Props) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [pending, startTransition] = useTransition();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const open = anchor !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setAnchor(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const active = stores.find((s) => s.id === activeStoreId);
  const label = active ? active.name : 'All Company';

  const toggle = () => {
    if (open) { setAnchor(null); return; }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  };

  const choose = (id: string | null) => {
    setAnchor(null);
    startTransition(() => void setActiveStore(id));
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        disabled={pending}
        className="inline-flex h-9 min-w-0 shrink items-center gap-2 rounded-full border border-brand/50 bg-brand/[0.06] px-2.5 text-sm font-medium text-on-tint-brand transition hover:bg-brand/10 disabled:opacity-60 sm:px-3"
      >
        <Icon name={active ? 'building' : 'home'} className="h-4 w-4" />
        <span className="max-w-[6rem] truncate sm:max-w-[10rem]">{label}</span>
        {!active && (
          <span
            title="All Company shows every branch but cannot save. Pick a branch to make changes."
            className="hidden rounded-full bg-warning/15 px-1.5 py-px text-micro font-semibold uppercase tracking-wide text-on-tint-warning sm:inline"
          >
            View only
          </span>
        )}
        <Icon name="chevron-down" className="h-3.5 w-3.5 opacity-70" />
      </button>

      {anchor && createPortal(
        <>
          <div aria-hidden="true" className="fixed inset-0 z-[100]" onClick={() => setAnchor(null)} />
          <div
            style={{ position: 'fixed', top: anchor.top, left: anchor.left, width: Math.max(256, anchor.width) }}
            className="z-[101] animate-fade-in overflow-hidden rounded-lg border border-border bg-card py-1 shadow-overlay"
          >
            <button
              type="button"
              onClick={() => choose(null)}
              className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-start transition hover:bg-muted ${
                activeStoreId === null ? 'bg-brand/[0.06]' : ''
              }`}
            >
              <Icon
                name="home"
                className={`mt-0.5 h-4 w-4 shrink-0 ${
                  activeStoreId === null ? 'text-brand' : 'text-muted-foreground'
                }`}
              />
              <span className="min-w-0">
                <span
                  className={`block text-sm ${
                    activeStoreId === null ? 'font-semibold text-brand' : ''
                  }`}
                >
                  All Company
                </span>
                <span className="block text-xs text-muted-foreground">
                  View only, across {stores.length} store{stores.length === 1 ? '' : 's'} - pick a branch to save anything
                </span>
              </span>
            </button>

            <div className="my-1 h-px bg-border" />

            {stores.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => choose(s.id)}
                className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-start transition hover:bg-muted ${
                  activeStoreId === s.id ? 'bg-brand/[0.06]' : ''
                }`}
              >
                <Icon
                  name="building"
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    activeStoreId === s.id ? 'text-brand' : 'text-muted-foreground'
                  }`}
                />
                <span className="min-w-0">
                  <span
                    className={`block truncate text-sm ${
                      activeStoreId === s.id ? 'font-semibold text-brand' : ''
                    }`}
                  >
                    {s.name}
                  </span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {s.branchCode}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
