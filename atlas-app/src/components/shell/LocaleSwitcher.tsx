'use client';

import { useTransition } from 'react';
import { setLocale } from '@/app/actions/locale';
import { locales, localeNames, rtlLocales, translatedLocales, type Locale } from '@/i18n/config';
import { AnchoredPopover, usePopoverAnchor } from '@/components/ui/AnchoredPopover';

export function LocaleSwitcher({ current }: { current: Locale }) {
  const [pending, startTransition] = useTransition();
  const { ref, anchor, toggle, close } = usePopoverAnchor<HTMLButtonElement>();

  return (
    <>
      <button
        ref={ref}
        onClick={toggle}
        disabled={pending}
        title="Language"
        className="rounded border border-border px-2.5 py-1.5 text-sm transition hover:bg-muted disabled:opacity-60"
      >
        {current.toUpperCase()}
      </button>

      {anchor && (
        <AnchoredPopover anchor={anchor} align="end" width={208} onClose={close} className="py-1">
          {locales.map((l) => {
            const available = translatedLocales.includes(l);
            return (
              <button
                key={l}
                disabled={!available}
                onClick={() => {
                  if (!available) return;
                  close();
                  startTransition(() => void setLocale(l));
                }}
                title={available ? undefined : 'Not translated yet - most of the app is still English-only regardless of language chosen'}
                className={`flex w-full items-center justify-between px-3 py-2 text-start text-sm ${
                  available ? 'hover:bg-muted' : 'cursor-not-allowed opacity-50'
                } ${l === current ? 'font-medium text-brand' : ''}`}
              >
                <span>{localeNames[l]}</span>
                {available ? (
                  rtlLocales.includes(l) && (
                    <span className="text-micro uppercase text-muted-foreground">RTL</span>
                  )
                ) : (
                  <span className="text-micro uppercase text-muted-foreground">Coming soon</span>
                )}
              </button>
            );
          })}
        </AnchoredPopover>
      )}
    </>
  );
}
