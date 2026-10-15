'use client';

/**
 * The dashboards' kit (11 Oct 2026) - a straight port of the approved
 * `09-documentation/dashboards-demo.html`: the same icons, the same marks,
 * the same sizes. Charts are hand-drawn SVG so every bar, slice and cell can
 * be hovered and clicked, which is the point of the new dashboards.
 *
 * Every clickable mark that is not a <button> carries role="button", a tab
 * stop and Enter/Space, so the charts work from the keyboard too.
 */

import { createContext, Fragment, useContext, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { inrC, num, pct } from '@/lib/dash/format';
import type { DashAction, Drill, KpiData, Tone } from '@/lib/dash/types';

/* ================================================================ icons */
const P: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  trend: 'M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6',
  wrench: 'M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3z M14.7 6.3 17 4l3 3-2.3 2.3',
  box: 'M21 8 12 3 3 8v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8',
  card: 'M2 5h20v14H2z M2 10h20',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.9 M16 3.1a4 4 0 0 1 0 7.8',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  calendar: 'M3 4h18v18H3z M16 2v4 M8 2v4 M3 10h18',
  chevDown: 'M6 9l6 6 6-6',
  chevRight: 'M9 18l6-6-6-6',
  chevLeft: 'M15 18l-6-6 6-6',
  arrowUpRight: 'M7 17 17 7 M7 7h10v10',
  arrowLeft: 'M19 12H5 M12 19l-7-7 7-7',
  up: 'M12 19V5 M5 12l7-7 7 7',
  down: 'M12 5v14 M19 12l-7 7-7-7',
  x: 'M18 6 6 18 M6 6l12 12',
  plus: 'M12 5v14 M5 12h14',
  check: 'M20 6 9 17l-5-5',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z M12 9v4 M12 17h.01',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
  receipt: 'M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2z M8 8h8 M8 12h8 M8 16h5',
  rupee: 'M6 3h12 M6 8h12 M6 13l8.5 8 M6 13h3 M9 13c6.7 0 6.7-10 0-10',
  cart: 'M6 6h15l-1.5 9h-12z M6 6 5 2H2 M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  truck: 'M1 3h15v13H1z M16 8h4l3 3v5h-7z M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  whatsapp: 'M3 21l1.7-4.6A9 9 0 1 1 8 19.6L3 21z M9 10c0 3 2 5 5 5l1.5-1.5-2-1-1 1c-1 0-2-1-2-2l1-1-1-2L9 10z',
  pin: 'M12 22s-8-6-8-12a8 8 0 0 1 16 0c0 6-8 12-8 12z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18 18 0 0 1 5-5.9 M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.2 3.2 M1 1l22 22',
  refresh: 'M23 4v6h-6 M1 20v-6h6 M3.5 9a9 9 0 0 1 14.8-3.4L23 10 M1 14l4.7 4.4A9 9 0 0 0 20.5 15',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  sparkle: 'M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z',
  zoom: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3 M11 8v6 M8 11h6',
  bank: 'M3 21h18 M3 10h18 M5 6l7-3 7 3 M4 10v11 M20 10v11 M8 14v3 M12 14v3 M16 14v3',
  gst: 'M9 14l6-6 M9.5 8.5h.01 M14.5 13.5h.01 M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z',
  keyboard: 'M2 6h20v12H2z M6 10h.01 M10 10h.01 M14 10h.01 M18 10h.01 M7 14h10',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2 M5.5 5h13L22 12v7H2v-7z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z M7 7h.01',
  cake: 'M20 21V11H4v10 M4 16c2 0 2-1 4-1s2 1 4 1 2-1 4-1 2 1 4 1 M12 11V7 M12 4h.01 M2 21h20',
};
export function DIcon({ n, s = 16, className = '', w = 1.8 }: { n: string; s?: number; className?: string; w?: number }) {
  const d = P[n] ?? P.info;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {d.split(' M').map((x, i) => <path key={i} d={(i ? 'M' : '') + x} />)}
    </svg>
  );
}

/* ============================================================ context */
export interface DashUI {
  hidden: Set<string>;
  editing: boolean;
  toggleHide: (id: string) => void;
  go: (href: string) => void;
  toast: (msg: string) => void;
  drill: (d: Drill) => void;
  act: (a: DashAction) => void;
  zoom: (i: number) => void;
  gran: 'hour' | 'day' | 'week' | 'month';
  labels: string[];
  setBranch: (id: string) => void;
  goTab: (tab: string) => void;
}
export const UICtx = createContext<DashUI | null>(null);
export const useUI = () => useContext(UICtx)!;

/** role="button" + keyboard for SVG marks and table rows. */
export function clickable(fn: () => void, label?: string) {
  return {
    role: 'button' as const, tabIndex: 0, 'aria-label': label,
    onClick: fn,
    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } },
  };
}

/* ============================================================== chart kit */
export const cv = (n: number) => `hsl(var(--c${n}))`;
export const tone = { success: 'hsl(var(--success))', warning: 'hsl(var(--warning))', danger: 'hsl(var(--danger))', brand: 'hsl(var(--brand-primary))', muted: 'hsl(var(--muted-foreground))' };
const inkOf = (t?: Tone) => (t === 'success' ? tone.success : t === 'danger' ? tone.danger : t === 'warning' ? tone.warning : undefined);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function niceMax(v: number) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }

export function Spark({ data, color = cv(1), h = 30, fill = true }: { data: number[]; color?: string; h?: number; fill?: boolean }) {
  const w = 100; const max = Math.max(...data, 1); const min = Math.min(...data, 0);
  const pts = data.map((v, i) => [i / Math.max(1, data.length - 1) * w, h - 2 - (v - min) / (max - min || 1) * (h - 4)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: h }} aria-hidden="true">
      {fill && <path d={`${d} L${w} ${h} L0 ${h}Z`} fill={color} opacity=".1" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export interface Series { key: string; label: string; color: string; type: 'bar' | 'line' | 'dash' | 'area'; data: number[] }

/** Bars + lines over buckets. */
export function Combo({ labels, series, height = 250, fmt = inrC, onPick, pickHint = 'Click a bar to zoom into it', stacked = false }: {
  labels: string[]; series: Series[]; height?: number; fmt?: (v: number) => string; onPick?: (i: number) => void; pickHint?: string; stacked?: boolean;
}) {
  const [hov, setHov] = useState<number | null>(null);
  const W = 760, H = height, pl = 56, pr = 10, pt = 14, pb = 26;
  const n = Math.max(1, labels.length);
  const bars = series.filter((s) => s.type === 'bar');
  const all = series.flatMap((s) => s.data);
  const maxV = stacked ? Math.max(0, ...labels.map((_, i) => sum(bars.map((s) => Math.max(0, s.data[i] ?? 0))))) : Math.max(...all, 0);
  const minV = Math.min(0, ...all);
  const max = niceMax(maxV > 0 ? maxV : 4); const min = minV < 0 ? -niceMax(-minV) : 0;
  const bw = (W - pl - pr) / n;
  const x = (i: number) => pl + bw * i + bw / 2;
  const y = (v: number) => pt + (H - pt - pb) * (max - v) / (max - min);
  const ticks = [0, 1, 2, 3, 4].map((t) => min + (max - min) * t / 4);
  const step = Math.ceil(n / 14);
  const inner = Math.min(bw * 0.72, 46);
  return (
    <div className="relative select-none">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} onMouseLeave={() => setHov(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke="hsl(var(--border))" strokeDasharray={t === 0 ? '' : '3 4'} />
            <text x={pl - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="hsl(var(--muted-foreground))">{fmt(t)}</text>
          </g>
        ))}
        {hov !== null && <rect x={pl + bw * hov} y={pt} width={bw} height={H - pt - pb} fill="hsl(var(--muted))" opacity=".7" rx="6" />}
        {labels.map((_, i) => {
          let acc = 0;
          return bars.map((s, k) => {
            const v = s.data[i] ?? 0;
            const bwi = stacked ? inner : inner / bars.length;
            const bx = stacked ? x(i) - inner / 2 : x(i) - inner / 2 + k * bwi;
            const y1 = stacked ? y(acc + Math.max(0, v)) : y(Math.max(0, v));
            const y2 = stacked ? y(acc) : y(Math.min(0, v));
            if (stacked) acc += Math.max(0, v);
            return <rect key={s.key + i} x={bx + (stacked ? 0 : 1)} y={y1} width={Math.max(1, bwi - (stacked ? 0 : 2))} height={Math.max(0, y2 - y1)} rx={stacked ? 0 : 3} fill={s.color} opacity={hov === null || hov === i ? 1 : 0.55} />;
          });
        })}
        {series.filter((s) => s.type !== 'bar').map((s) => {
          const d = s.data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v ?? 0).toFixed(1)}`).join(' ');
          return (
            <g key={s.key}>
              {s.type === 'area' && <path d={`${d} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)}Z`} fill={s.color} opacity=".12" />}
              <path d={d} fill="none" stroke={s.color} strokeWidth={s.type === 'dash' ? 1.6 : 2.2} strokeDasharray={s.type === 'dash' ? '5 4' : ''} strokeLinejoin="round" />
              {hov !== null && <circle cx={x(hov)} cy={y(s.data[hov] ?? 0)} r="4" fill="hsl(var(--card))" stroke={s.color} strokeWidth="2" />}
            </g>
          );
        })}
        {labels.map((l, i) => (i % step === 0 || i === n - 1) && <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">{l}</text>)}
        {labels.map((l, i) => (
          <rect key={`h${i}`} x={pl + bw * i} y={pt} width={bw} height={H - pt - pb} fill="transparent"
            style={{ cursor: onPick ? 'zoom-in' : 'default', outline: 'none' }} onMouseEnter={() => setHov(i)} onFocus={() => setHov(i)}
            {...(onPick ? clickable(() => onPick(i), `${l}: ${series.map((s) => `${s.label} ${fmt(s.data[i] ?? 0)}`).join(', ')}`) : {})} />
        ))}
      </svg>
      {hov !== null && (
        <div className="pointer-events-none absolute top-1 z-10 min-w-[170px] rounded-sm border border-border bg-card px-3 py-2 text-xs dash-raised"
          style={{ insetInlineStart: `clamp(0px, calc(${(x(hov) / W) * 100}% - 85px), calc(100% - 180px))` }}>
          <div className="mb-1 font-semibold">{labels[hov]}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
              <span className="flex items-center gap-1.5 text-muted-foreground"><i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
              <span className="font-mono font-semibold">{fmt(s.data[hov] ?? 0)}</span>
            </div>
          ))}
          {onPick && <div className="mt-1 border-t border-border pt-1 text-muted-foreground">{pickHint}</div>}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dash?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-muted-foreground">
          <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: it.color, opacity: it.dash ? 0.6 : 1, border: it.dash ? '1px dashed' : undefined }} />{it.label}
        </span>
      ))}
    </div>
  );
}

export interface Seg { label: string; value: number; color: string; ink?: string; [k: string]: unknown }

export function Donut({ segs, size = 168, thick = 22, center, sub, onPick, fmt = num }: {
  segs: Seg[]; size?: number; thick?: number; center: ReactNode; sub: ReactNode; onPick?: (s: Seg) => void; fmt?: (v: number) => string;
}) {
  const [hov, setHov] = useState<number | null>(null);
  const total = sum(segs.map((s) => s.value)) || 1;
  const r = (size - thick) / 2; const C = 2 * Math.PI * r;
  let off = 0;
  const h = hov !== null ? segs[hov] : null;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={thick} />
          {segs.map((s, i) => {
            const len = s.value / total * C;
            const el = (
              <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={hov === i ? thick + 6 : thick}
                strokeDasharray={`${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}`} strokeDashoffset={-off}
                style={{ cursor: onPick ? 'pointer' : 'default', transition: 'stroke-width .15s', outline: 'none' }}
                onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}
                {...(onPick ? clickable(() => onPick(s), s.label) : {})} />
            );
            off += len; return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="font-mono text-xl font-bold">{h ? fmt(h.value) : center}</div>
          <div className="max-w-[90px] text-cap leading-tight text-muted-foreground">{h ? `${h.label} · ${pct(h.value / total, 0)}` : sub}</div>
        </div>
      </div>
      <div className="min-w-[150px] flex-1 space-y-1">
        {segs.map((s, i) => (
          <button type="button" key={s.label} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} onClick={() => onPick?.(s)}
            className={`flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1 text-sm ${hov === i ? 'bg-muted' : ''} ${onPick ? 'hover:bg-muted' : 'cursor-default'}`}>
            <span className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.label}</span>
            <span className="font-mono text-xs font-semibold">{fmt(s.value)} <span className="font-normal text-muted-foreground">· {pct(s.value / total, 0)}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}

export interface ShareRow { label: string; value: number; extra?: string; color?: string; [k: string]: unknown }
export function ShareRows({ rows, fmt = inrC, color = cv(1), onPick, empty = 'Nothing in this period.' }: {
  rows: ShareRow[]; fmt?: (v: number) => string; color?: string; onPick?: (r: ShareRow) => void; empty?: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length) return <Empty text={empty} />;
  return (
    <div className="-mx-2">
      {rows.map((r, i) => (
        <button type="button" key={r.label + i} onClick={() => onPick?.(r)} className="group block w-full rounded-sm px-2 py-1.5 text-start hover:bg-muted">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2"><span className="w-4 font-mono text-xs text-muted-foreground">{i + 1}</span><span className="truncate group-hover:text-brand group-hover:underline">{r.label}</span></span>
            <span className={`shrink-0 font-mono font-semibold ${r.value < 0 ? 'text-danger' : ''}`}>{fmt(r.value)}{r.extra && <span className="ms-2 text-xs font-normal text-muted-foreground">{r.extra}</span>}</span>
          </div>
          <div className="ms-6 mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="dash-bar h-full rounded-full" style={{ width: `${Math.max(0, r.value) / max * 100}%`, background: r.color || color }} /></div>
        </button>
      ))}
    </div>
  );
}

export interface FunnelStep { label: string; count: number; value: number; [k: string]: unknown }
export function Funnel({ steps, onPick }: { steps: FunnelStep[]; onPick?: (s: FunnelStep) => void }) {
  const max = Math.max(1, steps[0]?.count ?? 1);
  return (
    <div className="space-y-1.5">
      {steps.map((s, i) => {
        const conv = i ? (steps[i - 1].count ? s.count / steps[i - 1].count : 0) : null;
        return (
          <Fragment key={s.label}>
            {conv !== null && <div className="ps-[132px] text-cap text-muted-foreground">↓ <b className={conv < 0.35 ? 'text-danger' : 'text-foreground'}>{pct(conv, 0)}</b> moved on</div>}
            <button type="button" onClick={() => onPick?.(s)} className="group flex w-full items-center gap-3 text-start">
              <span className="w-[120px] shrink-0 text-sm text-muted-foreground group-hover:text-foreground">{s.label}</span>
              <div className="relative h-9 flex-1 overflow-hidden rounded-sm bg-muted">
                <div className="dash-bar flex h-full items-center rounded-sm px-3 text-sm font-semibold text-white" style={{ width: `${Math.max(14, s.count / max * 100)}%`, background: cv(1), opacity: 1 - i * 0.13 }}>
                  <span className="font-mono">{num(s.count)}</span>
                </div>
              </div>
              <span className="w-24 shrink-0 text-end font-mono text-sm font-semibold">{inrC(s.value)}</span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

export function StackBar({ segs, fmt = inrC, onPick, h = 30 }: { segs: Seg[]; fmt?: (v: number) => string; onPick?: (s: Seg) => void; h?: number }) {
  const total = sum(segs.map((s) => s.value));
  const [hov, setHov] = useState<number | null>(null);
  return (
    <div>
      <div className="flex overflow-hidden rounded-sm bg-muted" style={{ height: h }}>
        {total > 0 && segs.map((s, i) => (
          <button type="button" key={s.label} title={`${s.label}: ${fmt(s.value)}`} aria-label={`${s.label}: ${fmt(s.value)}`} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} onClick={() => onPick?.(s)}
            className="dash-seg h-full border-e-2 border-card last:border-e-0" style={{ width: `${s.value / total * 100}%`, background: s.color, opacity: hov === null || hov === i ? 1 : 0.5 }} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {segs.map((s, i) => (
          <button type="button" key={s.label} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} onClick={() => onPick?.(s)} className={`rounded-sm px-2 py-1 text-start hover:bg-muted ${hov === i ? 'bg-muted' : ''}`}>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</div>
            <div className="font-mono text-sm font-semibold" style={{ color: s.ink }}>{fmt(s.value)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Gauge({ value, target, label, size = 200 }: { value: number; target: number; label: string; size?: number }) {
  const p = Math.min(1, target ? value / target : 0);
  const r = size / 2 - 14; const C = Math.PI * r;
  const col = p >= 0.9 ? tone.success : p >= 0.6 ? tone.warning : tone.danger;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size / 2 + 30 }}>
      <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`} aria-hidden="true">
        <path d={`M14 ${size / 2} A${r} ${r} 0 0 1 ${size - 14} ${size / 2}`} fill="none" stroke="hsl(var(--muted))" strokeWidth="16" strokeLinecap="round" />
        <path d={`M14 ${size / 2} A${r} ${r} 0 0 1 ${size - 14} ${size / 2}`} fill="none" stroke={col} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${C * p} ${C}`} style={{ transition: 'stroke-dasharray .6s' }} />
      </svg>
      <div className="absolute inset-x-0 text-center" style={{ top: size / 2 - 34 }}>
        <div className="font-mono text-2xl font-bold">{pct(p, 0)}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

export function Heat({ rows, cols, values, fmt = num, onPick }: { rows: string[]; cols: string[]; values: number[][]; fmt?: (v: number) => string; onPick?: (r: string, c: string, v: number) => void }) {
  const max = Math.max(...values.flat(), 1);
  const [hov, setHov] = useState<[number, number] | null>(null);
  return (
    <div className="overflow-x-auto thin-scroll">
      <table className="w-full border-separate" style={{ borderSpacing: 3 }}>
        <thead><tr><th aria-label="Day" />{cols.map((c) => <th key={c} className="text-cap font-medium text-muted-foreground">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r}>
              <td className="pe-2 text-xs text-muted-foreground">{r}</td>
              {cols.map((c, j) => {
                const v = values[i]?.[j] ?? 0; const on = hov && hov[0] === i && hov[1] === j;
                return (
                  <td key={c} className="p-0">
                    <button type="button" aria-label={`${r} ${c}: ${fmt(v)}`} onMouseEnter={() => setHov([i, j])} onMouseLeave={() => setHov(null)} onClick={() => onPick?.(r, c, v)}
                      className="block h-7 w-full min-w-[26px] rounded-[5px] text-center font-mono text-cap"
                      style={{ background: `hsl(var(--c1) / ${0.06 + v / max * 0.9})`, color: v / max > 0.55 ? 'hsl(var(--brand-primary-fg))' : 'hsl(var(--muted-foreground))', outline: on ? '2px solid hsl(var(--foreground))' : undefined }}>
                      {on ? fmt(v) : ''}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface TlBlockUI { s: number; e: number; label: string; st: 'done' | 'onsite' | 'next' | 'late' | 'travel'; time: string; [k: string]: unknown }
export interface TlRow { name: string; sub: string; blocks: TlBlockUI[]; [k: string]: unknown }
export function Timeline({ rows, onPick, nowH }: { rows: TlRow[]; onPick?: (r: TlRow, b: TlBlockUI) => void; nowH: number }) {
  const S = 9, E = 19; const xp = (h: number) => `${(h - S) / (E - S) * 100}%`;
  const col: Record<string, string> = { done: tone.success, onsite: tone.brand, next: 'hsl(var(--muted-foreground))', late: tone.danger, travel: tone.warning };
  const nowLabel = `${Math.floor(nowH) % 12 || 12}:${String(Math.round((nowH % 1) * 60)).padStart(2, '0')} ${nowH >= 12 ? 'pm' : 'am'}`;
  return (
    <div className="overflow-x-auto thin-scroll">
      <div className="min-w-[620px]">
        <div className="relative ms-[130px] h-5 text-cap text-muted-foreground">
          {[9, 11, 13, 15, 17, 19].map((h) => <span key={h} className={`absolute font-mono ${h === 9 ? '' : h === 19 ? '-translate-x-full' : '-translate-x-1/2'}`} style={{ insetInlineStart: xp(h) }}>{h > 12 ? h - 12 : h}{h >= 12 ? ' pm' : ' am'}</span>)}
        </div>
        {rows.map((r) => (
          <div key={r.name} className="flex items-center border-t border-border py-1.5">
            <div className="w-[130px] shrink-0 pe-2">
              <div className="truncate text-sm font-medium">{r.name}</div>
              <div className="text-cap text-muted-foreground">{r.sub}</div>
            </div>
            <div className="relative h-8 flex-1 rounded-sm bg-surface">
              {r.blocks.map((b, i) => (
                <button type="button" key={i} onClick={() => onPick?.(r, b)} title={`${b.label} · ${b.time}`}
                  className="absolute bottom-1 top-1 overflow-hidden rounded-[6px] px-1.5 text-start text-cap font-medium text-white hover:brightness-110"
                  style={{ insetInlineStart: xp(Math.max(S, b.s)), width: `calc(${(Math.min(E, b.e) - Math.max(S, b.s)) / (E - S) * 100}% - 2px)`, background: col[b.st], opacity: b.st === 'next' ? 0.55 : 1 }}>
                  <span className="block truncate leading-6">{b.label}</span>
                </button>
              ))}
              {nowH >= S && nowH <= E && <div className="absolute bottom-0 top-0 w-px bg-danger" style={{ insetInlineStart: xp(nowH) }} />}
            </div>
          </div>
        ))}
        <div className="ms-[130px] mt-2 flex flex-wrap gap-3 text-cap text-muted-foreground">
          {[['done', 'Done'], ['onsite', 'On site now'], ['travel', 'Travelling'], ['late', 'Running late'], ['next', 'Booked']].map(([k, l]) => <span key={k} className="flex items-center gap-1"><i className="inline-block h-2 w-3 rounded-sm" style={{ background: col[k], opacity: k === 'next' ? 0.55 : 1 }} />{l}</span>)}
          <span className="flex items-center gap-1"><i className="inline-block h-3 w-px bg-danger" />now {nowLabel}</span>
        </div>
      </div>
    </div>
  );
}

export interface WfStep { label: string; value: number; kind: 'total' | 'minus'; last?: boolean }
export function Waterfall({ steps, onPick }: { steps: WfStep[]; onPick?: (b: WfStep) => void }) {
  let run = 0;
  const bars = steps.map((s) => {
    if (s.kind === 'total') { const b = { ...s, a: Math.min(0, s.value), b: Math.max(0, s.value) }; run = s.value; return b; }
    const b = { ...s, a: run - s.value, b: run }; run -= s.value; return b;
  });
  const max = niceMax(Math.max(1, ...bars.map((b) => b.b)));
  const W = 520, H = 220, pb = 34, pt = 10;
  const bw = W / bars.length;
  const y = (v: number) => pt + (H - pt - pb) * (1 - Math.max(0, v) / max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {bars.map((b, i) => (
        <g key={b.label} style={{ cursor: 'pointer', outline: 'none' }} {...clickable(() => onPick?.(b), b.label)}>
          <rect x={i * bw + bw * 0.18} y={y(b.b)} width={bw * 0.64} height={Math.max(2, y(b.a) - y(b.b))} rx="4" fill={b.kind === 'total' ? (b.last ? (b.value >= 0 ? tone.success : tone.danger) : cv(1)) : tone.danger} opacity={b.kind === 'total' ? 1 : 0.8} />
          {i < bars.length - 1 && <line x1={i * bw + bw * 0.82} x2={(i + 1) * bw + bw * 0.18} y1={y(bars[i + 1].kind === 'total' ? bars[i + 1].b : b.kind === 'total' ? b.b : b.a)} y2={y(bars[i + 1].kind === 'total' ? bars[i + 1].b : b.kind === 'total' ? b.b : b.a)} stroke="hsl(var(--border-strong))" strokeDasharray="3 3" />}
          <text x={i * bw + bw / 2} y={y(b.b) - 5} textAnchor="middle" fontSize="11" fontWeight="600" fill="hsl(var(--foreground))">{b.kind === 'minus' ? '−' : ''}{inrC(b.value).replace('₹ ', '')}</text>
          <text x={i * bw + bw / 2} y={H - 14} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">{b.label}</text>
        </g>
      ))}
    </svg>
  );
}

/* ============================================================ building blocks */
export function Empty({ text }: { text: string }) {
  return <div className="rounded-sm bg-surface px-3 py-6 text-center text-sm text-muted-foreground">{text}</div>;
}

export function Delta({ d, goodUp = true, small }: { d: number | null | undefined; goodUp?: boolean; small?: boolean }) {
  if (d === null || d === undefined || !Number.isFinite(d)) return null;
  const up = d >= 0; const good = up === goodUp;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-cap font-semibold ${good ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
      <DIcon n={up ? 'up' : 'down'} s={small ? 9 : 10} w={2.6} />{Math.abs(d * 100).toFixed(1)}%
    </span>
  );
}

export function Kpi({ k, onClick }: { k: KpiData; onClick?: () => void }) {
  const ui = useUI();
  if (ui.hidden.has(k.id)) return ui.editing ? <HiddenStub id={k.id} label={k.label} /> : null;
  const sparkColor = k.sparkTone === 'brand' ? cv(1) : (k.d === null || k.d === undefined || (k.d >= 0) === (k.goodUp !== false) ? tone.success : tone.danger);
  const subTone = k.subTone === 'danger' ? 'text-danger' : k.subTone === 'warning' ? 'text-warning' : k.subTone === 'success' ? 'text-success' : 'text-muted-foreground';
  return (
    <div className="relative">
      {ui.editing && <HideBtn id={k.id} />}
      <button type="button" onClick={onClick ?? (() => ui.drill(k.drill))} className="dash-tile group flex h-full w-full flex-col rounded border border-border bg-card p-4 text-start outline-none focus-visible:ring-[3px] focus-visible:ring-brand">
        <div className="flex w-full items-center justify-between gap-2">
          <span className="micro-l flex items-center gap-1.5">{k.icon && <DIcon n={k.icon} s={13} />}{k.label}</span>
          <DIcon n="arrowUpRight" s={14} className="dash-go text-brand" />
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-2xl font-bold leading-tight tracking-tight sm:text-num" style={{ color: inkOf(k.ink) }}>{k.value}</span>
          <Delta d={k.d} goodUp={k.goodUp !== false} />
        </div>
        {k.sub && <div className={`mt-0.5 text-xs ${subTone}`}>{k.sub}</div>}
        {k.spark && k.spark.length > 1 && <div className="mt-auto pt-2"><Spark data={k.spark} color={sparkColor} /></div>}
      </button>
    </div>
  );
}

export function Card({ id, title, sub, icon, right, children, className = '', pad = true, route }: {
  id: string; title: string; sub?: ReactNode; icon?: string; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean; route?: string;
}) {
  const ui = useUI();
  if (ui.hidden.has(id)) return ui.editing ? <div className={className}><HiddenStub id={id} label={title} /></div> : null;
  return (
    <section className={`relative rounded border border-border bg-card ${className}`}>
      {ui.editing && <HideBtn id={id} />}
      <header className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-title font-semibold">{icon && <DIcon n={icon} s={16} className="text-muted-foreground" />}{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        <div className="flex items-center gap-2">
          {right}
          {route && <button type="button" onClick={() => ui.go(route)} className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-brand hover:bg-brand/10">Open <DIcon n="arrowUpRight" s={12} /></button>}
        </div>
      </header>
      <div className={pad ? 'px-5 pb-5 pt-3' : 'pt-3'}>{children}</div>
    </section>
  );
}
function HideBtn({ id }: { id: string }) {
  const ui = useUI();
  return <button type="button" onClick={() => ui.toggleHide(id)} className="absolute -top-2 end-2 z-20 flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-cap font-medium dash-raised hover:text-danger"><DIcon n="eyeOff" s={12} />Hide</button>;
}
function HiddenStub({ id, label }: { id: string; label: string }) {
  const ui = useUI();
  return <button type="button" onClick={() => ui.toggleHide(id)} className="flex h-full min-h-[72px] w-full items-center justify-center gap-2 rounded border border-dashed border-border-strong text-sm text-muted-foreground hover:text-brand"><DIcon n="eye" s={14} />Show “{label}”</button>;
}

export function SegCtl({ value, onChange, options, size = 'md', nowrap }: { value: string; onChange: (k: string) => void; options: { k: string; l: string; key?: string }[]; size?: 'sm' | 'md'; nowrap?: boolean }) {
  return (
    <div className={`flex rounded-full bg-muted p-0.5 ${nowrap ? 'w-max flex-nowrap' : 'flex-wrap'}`}>
      {options.map((o) => (
        <button type="button" key={o.k} onClick={() => onChange(o.k)} title={o.key ? `Shortcut: ${o.key}` : undefined} aria-pressed={value === o.k}
          className={`whitespace-nowrap rounded-full ${size === 'sm' ? 'px-2.5 py-2.5 text-xs sm:py-1' : 'px-3 py-2.5 text-chip sm:py-1.5'} font-medium transition ${value === o.k ? 'bg-card text-foreground dash-raised' : 'text-muted-foreground hover:text-foreground'}`}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function Badge({ t = 'neutral', children }: { t?: Tone; children: ReactNode }) {
  const m: Record<Tone, string> = { success: 'bg-success/10 text-on-tint-success', warning: 'bg-warning/10 text-on-tint-warning', danger: 'bg-danger/10 text-on-tint-danger', info: 'bg-brand/10 text-on-tint-brand', neutral: 'bg-muted text-muted-foreground' };
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-cap font-semibold ${m[t]}`}>{children}</span>;
}

export function Btn({ kind = 'outline', size = 'md', icon, children, onClick, className = '', disabled }: {
  kind?: 'primary' | 'money' | 'outline' | 'ghost' | 'success'; size?: 'sm' | 'md'; icon?: string; children: ReactNode; onClick?: () => void; className?: string; disabled?: boolean;
}) {
  const k = {
    primary: 'bg-brand text-brand-fg hover:bg-brand-hover',
    money: 'bg-money text-money-fg hover:bg-money-hover',
    outline: 'border border-border-strong bg-card hover:bg-muted',
    ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
    success: 'bg-success text-white hover:brightness-110',
  }[kind];
  return <button type="button" disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition disabled:opacity-50 ${size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm'} ${k} ${className}`}>{icon && <DIcon n={icon} s={size === 'sm' ? 13 : 15} />}{children}</button>;
}

/* ============================================================ drill-down drawer */
export function Drawer({ d, onClose, labels }: { d: Drill | null; onClose: () => void; labels: string[] }) {
  const ui = useUI();
  if (!d) return null;
  const fmt = d.chart?.fmt === 'num' ? num : inrC;
  const goodUp = d.goodUp !== false;
  return (
    <DialogFrame label={d.title} onClose={onClose} closeOnBackdrop className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <aside className="dash dash-drawer flex h-full w-full max-w-[560px] flex-col rounded-s-lg bg-card">
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <div className="micro-l">{d.eyebrow || 'Drill down'}</div>
            <h2 className="mt-1 text-h2 font-bold leading-tight">{d.title}</h2>
            {d.sub && <p className="mt-1 text-sm text-muted-foreground">{d.sub}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-muted" aria-label="Close"><DIcon n="x" s={18} /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5 thin-scroll">
          {d.value && (
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="font-mono text-hero font-bold tracking-tight" style={{ color: inkOf(d.ink) }}>{d.value}</span>
              <Delta d={d.delta} goodUp={goodUp} />
            </div>
          )}
          {d.chart && d.chart.data.length > 1 && (
            <div className="rounded border border-border p-3">
              <Combo height={170} labels={labels} fmt={fmt} series={[{ key: 'v', label: d.chart.label, color: cv(1), type: d.chart.type ?? 'area', data: d.chart.data }]} />
            </div>
          )}
          {d.moved && d.moved.length > 0 && (
            <div>
              <div className="micro-l mb-2 flex items-center gap-1.5"><DIcon n="sparkle" s={12} />What moved it</div>
              <div className="space-y-1.5">
                {d.moved.map((m) => (
                  <div key={m.label} className="flex items-center justify-between gap-3 rounded-sm bg-surface px-3 py-2 text-sm">
                    <span className="truncate">{m.label}</span>
                    <span className={`shrink-0 font-mono font-semibold ${(m.v >= 0) === goodUp ? 'text-success' : 'text-danger'}`}>{m.v >= 0 ? '+' : '−'}{m.fmt === 'num' ? num(Math.abs(m.v)) : inrC(Math.abs(m.v))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {d.rows && d.cols && (
            <div>
              <div className="micro-l mb-2 flex items-center justify-between"><span>{d.rowsTitle || 'Behind this number'}</span><span className="normal-case tracking-normal">{d.rows.length} of {d.rowsTotal ?? d.rows.length}</span></div>
              {d.rows.length === 0 ? <Empty text="Nothing behind this number in the period." /> : (
                <div className="overflow-hidden rounded border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-surface"><tr>{d.cols.map((c) => <th key={c.k} className={`micro-l px-3 py-2 ${c.num ? 'text-end' : 'text-start'}`}>{c.l}</th>)}</tr></thead>
                    <tbody>
                      {d.rows.map((r, i) => (
                        <tr key={i} className="border-t border-border hover:bg-muted">
                          {d.cols!.map((c, j) => (
                            <td key={c.k} className={`px-3 py-2 ${c.num ? 'text-end font-mono' : ''}`} style={{ color: c.ink ? inkOf(c.ink) : undefined }}>
                              {j === 0 && r._href ? <button type="button" onClick={() => ui.go(r._href!)} className="text-start text-brand hover:underline">{r[c.k]}</button> : r[c.k]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {d.note && <div className="rounded-sm border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">{d.note}</div>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-4">
          <div className="flex flex-wrap gap-2">
            {(d.actions || []).map((a) => <Btn key={a.label} kind={a.kind || 'outline'} icon={a.icon} onClick={() => ui.act(a)}>{a.label}</Btn>)}
          </div>
          {d.route && <Btn kind="primary" icon="arrowUpRight" onClick={() => ui.go(d.route!)}>Open full list</Btn>}
        </div>
      </aside>
    </DialogFrame>
  );
}

/* ============================================================ shortcuts row */
export interface Shortcut { l: string; i: string; href: string; money?: boolean; c?: number }
export function Shortcuts({ items }: { items: Shortcut[] }) {
  const ui = useUI();
  return (
    <div className="no-print flex gap-2 overflow-x-auto pb-1 thin-scroll">
      {items.map((s) => (
        <button type="button" key={s.l} onClick={() => ui.go(s.href)} className={`press flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition ${s.money ? 'border-transparent bg-money text-money-fg hover:bg-money-hover' : 'border-border bg-card hover:border-brand/50 hover:text-brand'}`}>
          <DIcon n={s.i} s={15} />{s.l}
          {s.c !== undefined && s.c > 0 && <span className={`rounded-full px-1.5 font-mono text-cap ${s.money ? 'bg-black/10' : 'bg-muted text-muted-foreground'}`}>{s.c}</span>}
        </button>
      ))}
    </div>
  );
}

/* ============================================================ "Needs you" list */
export interface ActionItem { label: string; sub: string; count: number; amt?: string; t: 'danger' | 'warning' | 'info' | 'success'; i: string; onClick: () => void }
export function ActionList({ items }: { items: ActionItem[] }) {
  const bg = { danger: 'bg-danger/10 text-on-tint-danger', warning: 'bg-warning/10 text-on-tint-warning', info: 'bg-brand/10 text-on-tint-brand', success: 'bg-success/10 text-on-tint-success' };
  return (
    <div className="-mx-2 divide-y divide-border">
      {items.map((it) => (
        <button type="button" key={it.label} onClick={it.onClick} className="group flex w-full items-center gap-3 px-2 py-2.5 text-start hover:bg-muted">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${bg[it.t]}`}><DIcon n={it.i} s={15} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium group-hover:text-brand">{it.label}</span>
            <span className="block truncate text-xs text-muted-foreground">{it.sub}</span>
          </span>
          <span className="shrink-0 text-end">
            <span className="block font-mono text-sm font-bold">{it.count}</span>
            {it.amt && <span className="block font-mono text-cap text-muted-foreground">{it.amt}</span>}
          </span>
          <DIcon n="chevRight" s={14} className="text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}

export { inrC, num, pct };
