'use client';

import { useState } from 'react';
import { Icon, type IconName } from './Icon';

export interface KpiCard {
  key: string;
  label: string;
  count: number | string;
  subLabel?: string;
  icon?: IconName;
  tone?: 'default' | 'brand' | 'navy' | 'warning' | 'danger' | 'success' | 'info';
}

/**
 * The clickable summary strip.
 *
 * Every list screen in the original opens with one - a horizontal row of
 * status counts that double as filters. Clicking a card narrows the grid;
 * clicking it again clears the filter.
 *
 * Two decisions worth stating:
 *
 * 1. Cards are equal width and wrap, rather than scrolling sideways. Sales
 *    Orders has fifteen of them; a horizontal scroller hides most of the
 *    statuses, which defeats the purpose of a summary.
 *
 * 2. A card showing zero is dimmed but still clickable. Removing empty cards
 *    would make the strip jump around as data changes, and the shape of the
 *    strip is itself information - you learn the pipeline by looking at it.
 */

/**
 * Tone is carried by a tinted fill and a hairline, not by a coloured number.
 *
 * The reference keeps every figure in near-black and lets the card's wash do
 * the signalling. Colouring the number as well doubles the signal and turns a
 * six-card strip into a rainbow - which reads as decoration, not as data.
 */
// Pastel tiles with a small coloured icon chip (look refresh, 29 Sep 2026).
// The figure itself stays near-black - the tile and chip carry the colour.
// The demo tile (11 Oct 2026, ATLAS-DESIGN.md `stat-tile`): every tile is a
// white card on a hairline; the tone lives in the 28px icon chip only, and the
// figure is Plex 26px/600 - red when the tone is danger.
const TONE: Record<string, { chip: string; figure: string }> = {
  default: { chip: 'bg-muted text-muted-foreground', figure: '' },
  brand: { chip: 'bg-brand/10 text-on-tint-brand', figure: '' },
  navy: { chip: 'bg-navy/10 text-on-tint-navy', figure: '' },
  info: { chip: 'bg-info/10 text-on-tint-info', figure: '' },
  success: { chip: 'bg-success/10 text-on-tint-success', figure: '' },
  warning: { chip: 'bg-warning/10 text-on-tint-warning', figure: '' },
  danger: { chip: 'bg-danger/10 text-on-tint-danger', figure: 'text-danger' },
};

export function KpiStrip({
  cards,
  activeKey,
  onSelect,
  columns = 6,
}: {
  cards: KpiCard[];
  activeKey: string | null;
  onSelect: (key: string | null) => void;
  /** Cards per row on a wide screen. */
  columns?: 4 | 5 | 6 | 8;
}) {
  const [visible, setVisible] = useState(true);

  if (!visible) {
    return (
      <button
        type="button"
        onClick={() => setVisible(true)}
        className="mb-3 inline-flex items-center gap-1.5 rounded border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-card transition hover:text-foreground"
      >
        <Icon name="eye" className="h-3.5 w-3.5" />
        Show summary
      </button>
    );
  }

  const GRID = {
    4: 'sm:grid-cols-3 lg:grid-cols-4',
    5: 'sm:grid-cols-3 lg:grid-cols-5',
    6: 'sm:grid-cols-3 lg:grid-cols-6',
    8: 'sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8',
  }[columns];

  return (
    <div className="mb-3 flex items-start gap-2">
      {/*
        `min-w-0` is load-bearing, not tidiness.

        A flex child defaults to `min-width: auto`, which means it refuses to
        shrink below the width of its own content. Without this the grid grows
        to fit the widest number inside it and pushes past the screen -- which
        is how a rupee figure ended up printed across the tile next to it.
      */}
      {/* On a phone the cards are one swipeable row (F1 UI standard) - stacked, seven of them filled the screen before a single record showed. */}
      <div className={`thin-scroll flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 sm:grid sm:overflow-visible sm:pb-0 ${GRID}`}>
        {cards.map((c) => {
          const active = activeKey === c.key;
          const t = TONE[c.tone ?? 'default'];
          const empty = c.count === 0 || c.count === '0';

          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onSelect(active ? null : c.key)}
              aria-pressed={active}
              title={[c.label, c.count, c.subLabel].filter(Boolean).join(' - ')}
              className={`group w-[8.25rem] min-w-0 shrink-0 rounded-lg border bg-card p-3.5 text-start transition sm:w-auto sm:shrink ${
                active ? 'border-brand ring-1 ring-brand' : 'border-border hover:-translate-y-0.5 hover:border-brand/40'
              }`}
            >
              {/* The label may take two lines and the figure has the whole width:
                  on an eight-tile strip each tile is ~128px, and anything sharing
                  a line with "PARTIALLY PAID" or "1,067" cuts one of them short. */}
              <span className="flex items-center gap-2">
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${t.chip}`}>
                  <Icon name={c.icon ?? 'sparkles'} className="h-3.5 w-3.5" />
                </span>
                <span className="line-clamp-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                  {c.label}
                </span>
              </span>
              {/* Long figures (a rupee total) step down a size rather than being cut off. */}
              <p className={`kpi-figure mt-2 truncate font-mono font-semibold leading-tight text-foreground ${t.figure} ${empty && !active ? 'opacity-50' : ''} ${
                String(c.count).length > 9 ? 'text-lg xl:text-xl' : 'text-xl sm:text-2xl xl:text-kpi'
              }`}>
                {c.count}
              </p>
              {c.subLabel && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.subLabel}</p>
              )}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setVisible(false)}
        title="Hide summary cards"
        aria-label="Hide summary cards"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-border bg-card text-muted-foreground shadow-card transition hover:text-foreground"
      >
        <Icon name="eye-off" className="h-4 w-4" />
      </button>
    </div>
  );
}
