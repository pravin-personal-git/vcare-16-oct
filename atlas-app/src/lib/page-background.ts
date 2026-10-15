/**
 * THE PAGE BACKGROUND, CHOSEN BY THE BUSINESS (12 Oct 2026, Pravin).
 *
 * Settings > Appearance > Page background: the product's grey, one solid
 * colour, or a gradient (straight or round, 2-5 colour stops). Stored in the
 * organisation's theme tokens as `pageBackground`; `tenantCss` turns it into
 * `--page-bg`, which the main area and the dashboard filter bar paint with
 * (globals.css). Light mode only - dark mode keeps its own dark page, or a
 * pale gradient would make light text unreadable.
 *
 * Pure, and strict: a saved value is rebuilt from checked numbers and
 * colours, never passed through as CSS - the stylesheet is injected on every
 * page, so nothing typed may reach it unchecked.
 */
import { tripleToHex } from './appearance';

export type BgStop = { color: string; at: number };
export type PageBackground =
  | { kind: 'default' }
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; type: 'linear' | 'radial'; angle: number; stops: BgStop[] };

export const DEFAULT_BG: PageBackground = { kind: 'default' };

const HEX = /^#[0-9a-f]{6}$/i;
const clampInt = (n: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(n))));

export class PageBackgroundError extends Error {}

/** Check a submitted background. Refuses rather than guesses. */
export function cleanPageBackground(input: unknown): PageBackground {
  const v = (input ?? {}) as Record<string, unknown>;
  if (v.kind === 'default' || v.kind === undefined) return DEFAULT_BG;
  if (v.kind === 'solid') {
    if (typeof v.color !== 'string' || !HEX.test(v.color)) throw new PageBackgroundError('Pick a colour.');
    return { kind: 'solid', color: v.color.toLowerCase() };
  }
  if (v.kind === 'gradient') {
    const type = v.type === 'radial' ? 'radial' : 'linear';
    if (!Number.isFinite(Number(v.angle ?? 180))) throw new PageBackgroundError('The angle is not a number.');
    const stops = Array.isArray(v.stops) ? v.stops : [];
    if (stops.length < 2 || stops.length > 5) throw new PageBackgroundError('A gradient needs 2 to 5 colours.');
    const clean = stops.map((s) => {
      const c = (s ?? {}) as Record<string, unknown>;
      if (typeof c.color !== 'string' || !HEX.test(c.color)) throw new PageBackgroundError('One of the gradient colours is not a colour.');
      if (!Number.isFinite(Number(c.at))) throw new PageBackgroundError('A colour position is not a number.');
      return { color: c.color.toLowerCase(), at: clampInt(c.at, 0, 100) };
    }).sort((a, b) => a.at - b.at);
    return { kind: 'gradient', type, angle: clampInt(v.angle ?? 180, 0, 360), stops: clean };
  }
  throw new PageBackgroundError('Choose default, solid or gradient.');
}

/** The saved background, or the default when missing or unreadable. */
export function readPageBackground(tokens: unknown): PageBackground {
  const raw = tokens && typeof tokens === 'object' ? (tokens as Record<string, unknown>).pageBackground : null;
  try { return cleanPageBackground(raw); } catch { return DEFAULT_BG; }
}

/** CSS `background` value; null = the product's own. Built only from cleaned values. */
export function pageBackgroundCss(bg: PageBackground): string | null {
  if (bg.kind === 'solid') return bg.color;
  if (bg.kind === 'gradient') {
    const stops = bg.stops.map((s) => `${s.color} ${s.at}%`).join(', ');
    return bg.type === 'radial'
      ? `radial-gradient(circle at center, ${stops})`
      : `linear-gradient(${bg.angle}deg, ${stops})`;
  }
  return null;
}

/**
 * Where page titles sit, as fractions of a 16:9 window: the top band, from
 * just right of the menu to the middle. The background is fixed to the window
 * (globals.css .page-bg), so this is the stretch of a gradient a title is
 * always drawn on - however far the page scrolls.
 */
const TITLE_POINTS: [number, number][] = [[0.2, 0.04], [0.5, 0.04], [0.2, 0.16], [0.5, 0.16]];

const lerpHex = (a: string, b: string, t: number) => {
  const p = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const q = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${p.map((v, i) => Math.round(v + (q[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

/** The gradient's colour at a point of the window (fractions), as CSS draws it. */
export function gradientColourAt(bg: Extract<PageBackground, { kind: 'gradient' }>, fx: number, fy: number): string {
  const W = 16;
  const H = 9;
  const x = fx * W - W / 2;
  const y = fy * H - H / 2;
  let t: number;
  if (bg.type === 'radial') {
    t = Math.hypot(x, y) / Math.hypot(W / 2, H / 2); // circle, farthest corner
  } else {
    const a = (bg.angle * Math.PI) / 180; // 0deg points up, 180deg down
    const len = Math.abs(W * Math.sin(a)) + Math.abs(H * Math.cos(a));
    t = (x * Math.sin(a) - y * Math.cos(a)) / len + 0.5;
  }
  const at = Math.min(100, Math.max(0, t * 100));
  const stops = [...bg.stops].sort((p, q) => p.at - q.at);
  if (at <= stops[0]!.at) return stops[0]!.color;
  for (let i = 1; i < stops.length; i++) {
    const p = stops[i - 1]!;
    const q = stops[i]!;
    if (at <= q.at) return q.at === p.at ? q.color : lerpHex(p.color, q.color, (at - p.at) / (q.at - p.at));
  }
  return stops[stops.length - 1]!.color;
}

/**
 * The colours a page background shows, for Auto text (lib/look): `all` -
 * every stop of a gradient, what a card may sit on - and `top`, what the page
 * titles sit on. Both empty = the Atlas grey.
 */
export function pageColours(bg: PageBackground): { all: string[]; top: string[] } {
  if (bg.kind === 'solid') return { all: [bg.color], top: [bg.color] };
  if (bg.kind === 'gradient') {
    return { all: bg.stops.map((s) => s.color), top: TITLE_POINTS.map(([fx, fy]) => gradientColourAt(bg, fx, fy)) };
  }
  return { all: [], top: [] };
}

/**
 * The stylesheet rule for tenantCss: `--page-bg` in light mode; switched
 * back off in dark mode (an unset custom property makes var() fall back).
 */
export function pageBackgroundRule(tokens: unknown): string {
  const css = pageBackgroundCss(readPageBackground(tokens));
  if (!css) return '';
  return `:root{--page-bg:${css}}`
    + ":root[data-theme='dark']{--page-bg:initial}"
    + "@media (prefers-color-scheme: dark){:root[data-theme='system']{--page-bg:initial}}";
}

/** Soft ready-made colours (as HSL, turned into hex for the picker). */
const SOLID_TRIPLES: [string, string][] = [
  ['Atlas grey', '220 14% 96%'], ['Paper', '40 33% 97%'], ['Cream', '43 60% 94%'], ['Mint', '150 40% 94%'],
  ['Sky', '205 70% 95%'], ['Lavender', '250 50% 96%'], ['Blush', '350 60% 96%'], ['Sand', '30 35% 92%'],
];
export const solidPresets = () => SOLID_TRIPLES.map(([label, t]) => ({ label, color: tripleToHex(t) }));

const GRADIENT_TRIPLES: { label: string; type: 'linear' | 'radial'; angle: number; stops: [string, number][] }[] = [
  { label: 'Morning', type: 'linear', angle: 180, stops: [['205 70% 96%', 0], ['0 0% 100%', 100]] },
  { label: 'Lavender mist', type: 'linear', angle: 135, stops: [['250 60% 96%', 0], ['205 70% 96%', 100]] },
  { label: 'Peach', type: 'linear', angle: 135, stops: [['25 90% 95%', 0], ['350 70% 96%', 100]] },
  { label: 'Mint fresh', type: 'linear', angle: 160, stops: [['150 45% 94%', 0], ['190 55% 95%', 100]] },
  { label: 'Sunrise', type: 'linear', angle: 120, stops: [['45 90% 94%', 0], ['20 85% 95%', 50], ['340 70% 96%', 100]] },
  { label: 'Soft glow', type: 'radial', angle: 0, stops: [['0 0% 100%', 0], ['220 25% 93%', 100]] },
];
export const gradientPresets = (): { label: string; bg: PageBackground }[] => GRADIENT_TRIPLES.map((g) => ({
  label: g.label,
  bg: { kind: 'gradient', type: g.type, angle: g.angle, stops: g.stops.map(([t, at]) => ({ color: tripleToHex(t), at })) },
}));
