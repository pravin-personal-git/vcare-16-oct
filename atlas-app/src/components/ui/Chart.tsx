'use client';

import { formatCurrencyCompact } from '@/lib/format';

/**
 * Dashboard charts.
 *
 * Drawn with CSS gradients and inline SVG rather than a charting library. The
 * dashboard needs exactly two shapes - a ring and a grouped bar - and pulling
 * in a charting dependency for two shapes is weight a white-label product does
 * not need to carry. Both read their colours from theme tokens, which a library
 * would not.
 */

export interface Slice {
  label: string;
  value: number;
  /** A theme token name, e.g. 'brand' | 'success'. */
  tone: 'brand' | 'navy' | 'success' | 'warning' | 'danger' | 'info';
}

const TONE_VAR: Record<Slice['tone'], string> = {
  brand: 'var(--brand-primary)',
  navy: 'var(--brand-navy)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
};

const TONE_TEXT: Record<Slice['tone'], string> = {
  brand: 'text-brand',
  navy: 'text-navy',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

/**
 * Ring chart with a value in the middle and a legend beside it.
 * A total of zero renders a flat grey ring rather than an error - an empty
 * pipeline is a normal state, not a failure.
 */
export function Donut({
  slices, centerValue, centerLabel, size = 92,
}: {
  slices: Slice[];
  centerValue: number | string;
  centerLabel: string;
  size?: number;
}) {
  const total = slices.reduce((n, s) => n + s.value, 0);

  let cursor = 0;
  const stops = total
    ? slices
        .filter((s) => s.value > 0)
        .map((s) => {
          const from = (cursor / total) * 360;
          cursor += s.value;
          const to = (cursor / total) * 360;
          return `hsl(${TONE_VAR[s.tone]}) ${from}deg ${to}deg`;
        })
        .join(', ')
    : `hsl(var(--muted)) 0deg 360deg`;

  return (
    <div className="flex items-center gap-4">
      <div
        className="relative shrink-0 rounded-full"
        style={{ width: size, height: size, background: `conic-gradient(${stops})` }}
      >
        <div className="absolute inset-[18%] grid place-items-center rounded-full bg-card">
          <span className="text-lg font-bold leading-none tabular-nums">{centerValue}</span>
          <span className="text-xs text-muted-foreground">{centerLabel}</span>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-1">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: `hsl(${TONE_VAR[s.tone]})` }}
            />
            <span className="truncate text-muted-foreground">{s.label}</span>
            <span className="ms-auto font-semibold tabular-nums">{s.value}</span>
          </li>
        ))}
        {slices.length === 0 && (
          <li className="text-xs text-muted-foreground">Nothing to show yet.</li>
        )}
      </ul>
    </div>
  );
}

export interface BarPoint {
  label: string;
  values: number[];
}

/**
 * Grouped bar chart in paise.
 *
 * Deliberately renders an axis and month labels even when every value is zero.
 * A chart that collapses to nothing when empty tells you less than an empty
 * chart does - you cannot tell "no data" from "not loaded".
 */
export function GroupedBars({
  points, series, height = 220,
}: {
  points: BarPoint[];
  series: { label: string; tone: Slice['tone'] }[];
  height?: number;
}) {
  const max = Math.max(1, ...points.flatMap((p) => p.values));
  const ticks = [max, max * 0.75, max * 0.5, max * 0.25, 0];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {series.map((s, i) => {
          const sum = points.reduce((n, p) => n + (p.values[i] ?? 0), 0);
          return (
            <span key={s.label} className="flex items-center gap-1.5 text-xs">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: `hsl(${TONE_VAR[s.tone]})` }}
              />
              <span className="text-muted-foreground">{s.label}:</span>
              <span className={`font-semibold ${TONE_TEXT[s.tone]}`}>
                {formatCurrencyCompact(sum)}
              </span>
            </span>
          );
        })}
      </div>

      <div className="flex gap-2">
        {/* y axis */}
        <div
          className="flex w-14 shrink-0 flex-col justify-between text-end text-xs text-muted-foreground"
          style={{ height }}
        >
          {ticks.map((t, i) => (
            <span key={i}>{formatCurrencyCompact(t)}</span>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="relative flex items-end gap-1 border-b border-s border-border"
            style={{ height }}
          >
            {/* gridlines */}
            {[0.25, 0.5, 0.75].map((f) => (
              <span
                key={f}
                className="pointer-events-none absolute inset-inline-0 border-t border-dashed border-border/70"
                style={{ bottom: `${f * 100}%` }}
              />
            ))}

            {points.map((p) => (
              <div key={p.label} className="flex h-full flex-1 items-end justify-center gap-px">
                {p.values.map((v, i) => (
                  <span
                    key={i}
                    title={`${series[i]?.label ?? ''} ${p.label}: ${formatCurrencyCompact(v)}`}
                    className="w-full max-w-[10px] rounded-t-sm transition hover:opacity-80"
                    style={{
                      height: `${Math.max(v > 0 ? 2 : 0, (v / max) * 100)}%`,
                      background: `hsl(${TONE_VAR[series[i]?.tone ?? 'brand']})`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="mt-1 flex gap-1">
            {points.map((p) => (
              <span
                key={p.label}
                className="flex-1 text-center text-xs text-muted-foreground"
              >
                {p.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A two-tone proportion bar - the original's customer FREQUENCY strip. */
export function SplitBar({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((n, s) => n + s.value, 0);
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
      {total > 0 &&
        slices.map((s) => (
          <span
            key={s.label}
            style={{
              width: `${(s.value / total) * 100}%`,
              background: `hsl(${TONE_VAR[s.tone]})`,
            }}
          />
        ))}
    </div>
  );
}
