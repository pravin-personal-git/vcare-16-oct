/**
 * THE COLOURS OF THE BOXES AND THE TEXT, CHOSEN BY THE BUSINESS (12 Oct 2026, Pravin).
 *
 * Settings > Appearance > Colours and text: the top bar, cards and tiles
 * (solid, frosted or glass), the table header row, alternate rows, card
 * borders, the main button - and nine text colours, each "Auto" or a colour.
 *
 * Why Auto exists: a page title is dark ink, and on 12 Oct a navy page
 * background made every "Invoices"-style heading disappear. Auto picks dark or
 * white for each text from what actually sits behind it - every colour of the
 * page gradient, the card under a frosted plate - so a background can never
 * hide the words again. A colour typed by hand is kept even when it is hard to
 * read; the screen warns (readabilityChecks) rather than refusing.
 *
 * Stored in the organisation's theme tokens as `look`; `lookCss` turns it into
 * a stylesheet for `tenantCss`. Light mode only - dark mode keeps its own.
 * Pure, and strict like lib/page-background: nothing typed reaches the
 * stylesheet except checked hex colours and words from fixed lists. No imports,
 * so lib/appearance can use it without a cycle.
 */

export const TEXT_KEYS = ['heading', 'subtitle', 'body', 'soft', 'link', 'tableHeader', 'topBar', 'button', 'tile'] as const;
export type TextKey = (typeof TEXT_KEYS)[number];

export const TEXT_LABELS: Record<TextKey, string> = {
  heading: 'Page heading',
  subtitle: 'Page subtitle',
  body: 'Card and table text',
  soft: 'Secondary text (dates, labels)',
  link: 'Links and document numbers',
  tableHeader: 'Table header text',
  topBar: 'Top bar text',
  button: 'Main button text',
  tile: 'Tile numbers',
};

export const CARD_GLASS = [
  { value: 'solid', label: 'Solid', alpha: 1 },
  { value: 'frosted', label: 'Frosted', alpha: 0.85 },
  { value: 'glass', label: 'Glass', alpha: 0.65 },
] as const;
export type CardGlass = (typeof CARD_GLASS)[number]['value'];

export const BOX_KEYS = ['topBar', 'card', 'tableHeader', 'zebra', 'border', 'button'] as const;
export type BoxKey = (typeof BOX_KEYS)[number];

export const BOX_LABELS: Record<BoxKey, string> = {
  topBar: 'Top bar',
  card: 'Cards, tiles and tables',
  tableHeader: 'Table header row',
  zebra: 'Alternate table rows',
  border: 'Card borders and lines',
  button: 'Main button',
};

/** Every colour is a hex, or null = the Atlas default (for text: Auto). */
export interface Look {
  box: Record<BoxKey, string | null>;
  cardGlass: CardGlass;
  text: Record<TextKey, string | null>;
}

const nulls = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, null])) as Record<K, null>;
export const DEFAULT_LOOK: Look = { box: nulls(BOX_KEYS), cardGlass: 'solid', text: nulls(TEXT_KEYS) };

/** A colour from its six hex digits (the lint bans a literal hex; these mirror globals.css). */
const h = (digits: string) => `#${digits}`;

/** The Atlas colours the defaults stand for (globals.css), for Auto and the checks. */
export const ATLAS = {
  page: h('f5f5f7'), card: h('ffffff'), surface: h('fafafc'), border: h('e0e0e0'), ink: h('1d1d1f'), soft: h('4f4f54'), brand: h('0066cc'),
} as const;
const WHITE_INK = h('ffffff');
const WHITE_SOFT = h('d6dce6');

const HEX = /^#[0-9a-f]{6}$/i;

export class LookError extends Error {}

/** Check a submitted look. Refuses rather than guesses. */
export function cleanLook(input: unknown): Look {
  const v = (input ?? {}) as Record<string, unknown>;
  const colour = (raw: unknown, label: string): string | null => {
    if (raw === null || raw === undefined || raw === '' || raw === 'auto') return null;
    if (typeof raw !== 'string' || !HEX.test(raw)) throw new LookError(`${label}: pick a colour.`);
    return raw.toLowerCase();
  };
  const box = (v.box ?? {}) as Record<string, unknown>;
  const text = (v.text ?? {}) as Record<string, unknown>;
  const glass = v.cardGlass ?? 'solid';
  if (!CARD_GLASS.some((g) => g.value === glass)) throw new LookError('Cards must be solid, frosted or glass.');
  return {
    box: Object.fromEntries(BOX_KEYS.map((k) => [k, colour(box[k], BOX_LABELS[k])])) as Look['box'],
    cardGlass: glass as CardGlass,
    text: Object.fromEntries(TEXT_KEYS.map((k) => [k, colour(text[k], TEXT_LABELS[k])])) as Look['text'],
  };
}

/** The saved look, or the default when missing or unreadable. */
export function readLook(tokens: unknown): Look {
  const raw = tokens && typeof tokens === 'object' ? (tokens as Record<string, unknown>).look : null;
  if (!raw) return DEFAULT_LOOK;
  try { return cleanLook(raw); } catch { return DEFAULT_LOOK; }
}

export const isDefaultLook = (l: Look) =>
  l.cardGlass === 'solid' && BOX_KEYS.every((k) => !l.box[k]) && TEXT_KEYS.every((k) => !l.text[k]);

/* ---------------------------------------------------------------- colour maths */

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `a` moved `t` (0-1) of the way towards `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const p = rgb(a);
  const q = rgb(b);
  return `#${p.map((v, i) => Math.round(v + (q[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** The worst contrast of a text colour across everything that may sit behind it. */
export const worstContrast = (fg: string, behind: string[]) => Math.min(...behind.map((b) => contrast(fg, b)));

/** Dark ink or white - whichever reads better against the worst of `behind`. */
export const isDarkBehind = (behind: string[]) => worstContrast(WHITE_INK, behind) > worstContrast(ATLAS.ink, behind);
export const inkFor = (behind: string[]) => (isDarkBehind(behind) ? WHITE_INK : ATLAS.ink);
export const softInkFor = (behind: string[]) => (isDarkBehind(behind) ? WHITE_SOFT : ATLAS.soft);

/** `#1D4ED8` → `224 76.3% 48%` - the form the Atlas colour tokens take. */
export function hexTriple(hex: string): string {
  const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 1000) / 10}% ${Math.round(l * 1000) / 10}%`;
}

/* ------------------------------------------------------------- what is behind */

export type HeadingBacking = 'none' | 'glass' | 'solid';

/** The page background's colours (lib/page-background pageColours): every one, and those behind the page titles. */
export interface PageColours { all: string[]; top: string[] }
export const ATLAS_PAGE: PageColours = { all: [], top: [] };

/** What each text sits on, given the look, the page's colours and the title backing. */
export function behindOf(look: Look, pageColours: PageColours, backing: HeadingBacking) {
  const card = look.box.card ?? ATLAS.card;
  const alpha = CARD_GLASS.find((g) => g.value === look.cardGlass)!.alpha;
  const page = pageColours.all.length ? pageColours.all : [ATLAS.page];
  const top = pageColours.top.length ? pageColours.top : page;
  const cardSeen = alpha === 1 ? [card] : page.map((p) => mixHex(p, card, alpha));
  const heading = backing === 'solid' ? [card] : backing === 'glass' ? top.map((p) => mixHex(p, card, 0.72)) : top;
  const surface = look.box.card ? (isDarkBehind([card]) ? mixHex(card, h('ffffff'), 0.05) : mixHex(card, h('000000'), 0.015)) : ATLAS.surface;
  return {
    heading, cardSeen, card,
    tableHeader: [look.box.tableHeader ?? surface],
    topBar: [look.box.topBar ?? card],
    button: [look.box.button],
  };
}

/** Every text colour, resolved: the chosen one, or Auto's pick. Link and button may stay null (= brand). */
export function resolveText(look: Look, pageColours: PageColours, backing: HeadingBacking) {
  const b = behindOf(look, pageColours, backing);
  const t = look.text;
  const darkCard = isDarkBehind(b.cardSeen);
  return {
    heading: t.heading ?? inkFor(b.heading),
    subtitle: t.subtitle ?? softInkFor(b.heading),
    body: t.body ?? inkFor(b.cardSeen),
    soft: t.soft ?? softInkFor(b.cardSeen),
    link: t.link ?? null,
    linkOnDark: !t.link && darkCard,
    tableHeader: t.tableHeader ?? softInkFor(b.tableHeader),
    topBar: t.topBar ?? inkFor(b.topBar),
    button: t.button ?? (look.box.button ? inkFor([look.box.button]) : null),
    tile: t.tile ?? inkFor(b.cardSeen),
  };
}

export interface Readability { key: TextKey; label: string; ratio: number; ok: boolean }

/**
 * How readable each text is, worst case over what sits behind it. Headings
 * and tile numbers are large, so 3:1 is enough; everything else needs 4.5:1
 * (WCAG AA). `brandHex` stands in for links and the main button when no
 * colour of their own is chosen.
 */
export function readabilityChecks(look: Look, pageColours: PageColours, backing: HeadingBacking, brandHex: string): Readability[] {
  const b = behindOf(look, pageColours, backing);
  const r = resolveText(look, pageColours, backing);
  const button = look.box.button ?? brandHex;
  const rows: [TextKey, string, string[], number][] = [
    ['heading', r.heading, b.heading, 3],
    ['subtitle', r.subtitle, b.heading, 4.5],
    ['body', r.body, b.cardSeen, 4.5],
    ['soft', r.soft, b.cardSeen, 4.5],
    ['link', r.link ?? (r.linkOnDark ? mixHex(brandHex, h('ffffff'), 0.55) : brandHex), b.cardSeen, 4.5],
    ['tableHeader', r.tableHeader, b.tableHeader, 4.5],
    ['topBar', r.topBar, b.topBar, 4.5],
    ['button', r.button ?? inkFor([button]), [button], 4.5],
    ['tile', r.tile, b.cardSeen, 3],
  ];
  return rows.map(([key, fg, behind, min]) => {
    const ratio = Math.round(worstContrast(fg, behind) * 10) / 10;
    return { key, label: TEXT_LABELS[key], ratio, ok: ratio >= min };
  });
}

/* ------------------------------------------------------------------ the CSS */

const LIGHT = ":root:not([data-theme='dark']):not([data-theme='system'])";
const SYSTEM = ":root[data-theme='system']";
const NOT_HIGH = ":not([data-contrast='high'])";

/** Rules that apply in light mode only (and in "system" when the device is light). */
function lightOnly(rules: [string, string][]): string {
  const live = rules.filter(([, body]) => body);
  if (!live.length) return '';
  const at = (root: string) => live.map(([sel, body]) => sel.split(',').map((s) => `${root}${s}`).join(',') + `{${body}}`).join('');
  return at(LIGHT) + `@media (prefers-color-scheme: light){${at(SYSTEM)}}`;
}

const decl = (pairs: [string, string | null | false | undefined][]) =>
  pairs.filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(';');

/**
 * The stylesheet for a look. Nothing is written for a default, so a business
 * that never opened the panel renders exactly as before. `pageColours` are
 * the page background's colours (every one, and those behind titles); `backing` what
 * sits behind page titles (Appearance `headingBacking`).
 */
export function lookCss(tokens: unknown, backing: HeadingBacking, pageColours: PageColours): string {
  const look = readLook(tokens);
  const pageChanged = pageColours.all.length > 0 && !(pageColours.all.length === 1 && pageColours.all[0] === ATLAS.page);
  if (isDefaultLook(look) && !pageChanged && backing === 'none') return '';

  const r = resolveText(look, pageColours, backing);
  const { box } = look;
  const darkCard = box.card ? isDarkBehind([box.card]) : false;
  const changed = (v: string | null, atlas: string) => (v && v !== atlas ? v : null);
  const tri = (hex: string | null) => (hex ? hexTriple(hex) : null);

  // Surfaces: the card colour carries its family - a dark card turns on dark
  // inputs, panels and lines so nothing light is left with white text on it.
  const surfaces = decl([
    ['--card', tri(box.card)],
    ['--surface', box.card ? tri(darkCard ? mixHex(box.card, h('ffffff'), 0.05) : mixHex(box.card, h('000000'), 0.015)) : null],
    ['--muted', box.card ? tri(darkCard ? mixHex(box.card, h('ffffff'), 0.09) : mixHex(box.card, h('000000'), 0.05)) : null],
    ['--background', darkCard ? tri(mixHex(box.card!, h('000000'), 0.35)) : null],
    ['--border', tri(box.border ?? (darkCard ? mixHex(box.card!, h('ffffff'), 0.14) : null))],
    ['--border-strong', tri(box.border ? mixHex(box.border, h('000000'), 0.15) : darkCard ? mixHex(box.card!, h('ffffff'), 0.26) : null)],
    ['color-scheme', darkCard ? 'dark' : null],
  ]);
  const inks = decl([
    ['--foreground', tri(changed(r.body, ATLAS.ink))],
    ['--muted-foreground', tri(changed(r.soft, ATLAS.soft))],
  ]);

  const alpha = CARD_GLASS.find((g) => g.value === look.cardGlass)!.alpha;
  const top = box.topBar;
  const topInk = look.text.topBar ?? (top ? inkFor([top]) : null);
  const topShade = top ? mixHex(top, inkFor([top]), 0.07) : null;

  return lightOnly([
    ['', surfaces],
    [NOT_HIGH, inks],
    [' .page-title', decl([['color', changed(r.heading, ATLAS.ink)]])],
    [' .page-sub', decl([['color', changed(r.subtitle, ATLAS.soft)]])],
    [' .kpi-figure:not(.text-danger)', decl([['color', look.text.tile]])],
    [' main a.text-brand, main a.text-info', decl([
      ['color', r.link ?? (r.linkOnDark ? 'color-mix(in srgb,hsl(var(--brand-primary)) 45%,white)' : null)],
    ])],
    [' main thead th', decl([['background-color', box.tableHeader], ['color', box.tableHeader || look.text.tableHeader ? r.tableHeader : null]])],
    [' main tbody tr:nth-child(even):not(:hover) > td', decl([['background-color', box.zebra]])],
    // Buttons keep their own look (Appearance > Everyday buttons); overlays stay solid.
    [' main .bg-card:not(td):not(th):not(.btn):not(.shadow-overlay):not([role=dialog] *):not([role=menu] *)', alpha < 1
      ? `background-color:hsl(var(--card)/${alpha});-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)`
      : ''],
    [' .btn-depth', decl([['--brand-primary', tri(box.button)], ['--brand-primary-fg', tri(r.button)]])],
    [' .app-topbar', decl([
      ['background-color', top],
      ['--card', tri(topShade)],
      ['--background', tri(topShade)],
      ['--border', top ? tri(mixHex(top, inkFor([top]), 0.16)) : null],
      ['--foreground', tri(topInk)],
      // The bar's own text inherits from <body>, which resolved --foreground there.
      ['color', topInk],
      ['--muted-foreground', look.text.topBar ? tri(look.text.topBar) : top ? tri(softInkFor([top])) : null],
    ])],
  ]);
}
