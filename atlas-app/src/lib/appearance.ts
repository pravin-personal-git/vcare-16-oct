import { pageBackgroundRule, pageColours, readPageBackground } from './page-background';
import { lookCss } from './look';

/**
 * Settings › Appearance - the business's look (UI refresh, 4 Oct 2026,
 * 09-documentation/03-specs/UI-REFRESH-SPEC.md).
 *
 * Stored inside `Organization.themeTokens`, next to the three palette tokens,
 * under the key `appearance` - no migration. Every choice is a word from a
 * fixed list; the CSS each word becomes is written HERE, never taken from the
 * database, so nothing a client saves is ever interpolated into a stylesheet.
 *
 * Pure: no database, no React. Shared by the app shell, the customer portal,
 * the shop and the Appearance screen.
 */

export const FONTS = [
  { value: 'inter', label: 'Inter (default)', cssVar: '--font-inter' },
  { value: 'jakarta', label: 'Plus Jakarta Sans', cssVar: '--font-jakarta' },
  { value: 'nunito', label: 'Nunito', cssVar: '--font-nunito' },
  { value: 'manrope', label: 'Manrope', cssVar: '--font-manrope' },
  { value: 'dmsans', label: 'DM Sans', cssVar: '--font-dmsans' },
  { value: 'figtree', label: 'Figtree', cssVar: '--font-figtree' },
  // 12 Oct 2026: twenty more (lib/fonts.ts). Poppins, Noto Sans, Mukta and
  // Hind also carry Hindi letters.
  { value: 'poppins', label: 'Poppins (Hindi too)', cssVar: '--font-poppins' },
  { value: 'montserrat', label: 'Montserrat', cssVar: '--font-montserrat' },
  { value: 'lato', label: 'Lato', cssVar: '--font-lato' },
  { value: 'roboto', label: 'Roboto', cssVar: '--font-roboto' },
  { value: 'opensans', label: 'Open Sans', cssVar: '--font-opensans' },
  { value: 'worksans', label: 'Work Sans', cssVar: '--font-worksans' },
  { value: 'outfit', label: 'Outfit', cssVar: '--font-outfit' },
  { value: 'sora', label: 'Sora', cssVar: '--font-sora' },
  { value: 'lexend', label: 'Lexend', cssVar: '--font-lexend' },
  { value: 'urbanist', label: 'Urbanist', cssVar: '--font-urbanist' },
  { value: 'raleway', label: 'Raleway', cssVar: '--font-raleway' },
  { value: 'rubik', label: 'Rubik', cssVar: '--font-rubik' },
  { value: 'plex', label: 'IBM Plex Sans', cssVar: '--font-plex' },
  { value: 'notosans', label: 'Noto Sans (Hindi too)', cssVar: '--font-notosans' },
  { value: 'mukta', label: 'Mukta (Hindi too)', cssVar: '--font-mukta' },
  { value: 'hind', label: 'Hind (Hindi too)', cssVar: '--font-hind' },
] as const;

/** Page headings may also take a serif - too ornate for a table, fine for a title. */
export const HEADING_FONTS = [
  { value: 'same', label: 'Same as the body', cssVar: '' },
  ...FONTS,
  { value: 'playfair', label: 'Playfair Display (serif)', cssVar: '--font-playfair' },
  { value: 'lora', label: 'Lora (serif)', cssVar: '--font-lora' },
  { value: 'dmserif', label: 'DM Serif Display (serif)', cssVar: '--font-dmserif' },
  { value: 'merriweather', label: 'Merriweather (serif)', cssVar: '--font-merriweather' },
] as const;

export const HEADING_WEIGHTS = [
  { value: '400', label: 'Regular' }, { value: '600', label: 'Semibold' },
  { value: '700', label: 'Bold' }, { value: '800', label: 'Extra bold' },
] as const;

export const HEADING_STYLES = [
  { value: 'normal', label: 'Upright' }, { value: 'italic', label: 'Italic' }, { value: 'caps', label: 'CAPITALS' },
] as const;

/** What sits behind a page title - the fix for a title lost on a dark page background. */
export const HEADING_BACKINGS = [
  { value: 'none', label: 'None' }, { value: 'glass', label: 'Frosted plate' }, { value: 'solid', label: 'Solid band' },
] as const;

export const NUMBER_WEIGHTS = [
  { value: '400', label: 'Regular' }, { value: '600', label: 'Semibold' }, { value: '700', label: 'Bold' },
] as const;

export const TEXT_SIZES = [
  { value: 'small', label: 'Small', pct: '93.75%' }, { value: 'normal', label: 'Normal', pct: '' },
  { value: 'large', label: 'Large', pct: '106.25%' },
] as const;

export const BUTTON_SHAPES = [
  { value: 'pill', label: 'Pill', radius: '' }, { value: 'rounded', label: 'Rounded', radius: '0.625rem' },
  { value: 'square', label: 'Square', radius: '0.25rem' },
] as const;

/** The everyday (not main) buttons: Convert, Export, Views and the rest. */
export const QUIET_BUTTONS = [
  { value: 'white', label: 'White' }, { value: 'soft', label: 'Soft tint' }, { value: 'outline', label: 'Outline' },
] as const;

export const SIDEBARS = [
  { value: 'brand', label: 'Deep brand' },
  { value: 'light', label: 'Light' },
  { value: 'charcoal', label: 'Charcoal' },
] as const;

export const CORNERS = [
  { value: 'sharp', label: 'Sharp', sm: '0.25rem', md: '0.375rem', lg: '0.625rem' },
  { value: 'soft', label: 'Soft', sm: '0.5rem', md: '0.75rem', lg: '1.125rem' },
  { value: 'round', label: 'Round', sm: '0.75rem', md: '1.125rem', lg: '1.5rem' },
] as const;

export const DENSITY_OPTIONS = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
] as const;

export const LINK_STYLES = [
  { value: 'bold', label: 'Bold colour' },
  { value: 'underline', label: 'Underlined' },
] as const;

/**
 * The seven brand presets. Primary and deep (navy) as HSL triples - the form
 * the palette tokens are stored in.
 */
export const PRESETS = [
  { value: 'atlas', label: 'Atlas blue', primary: '210 100% 40%', navy: '224 64.3% 32.9%' },
  { value: 'magenta', label: 'Vcare magenta', primary: '292 100% 31%', navy: '291 100% 17.1%' },
  { value: 'saffron', label: 'Saffron', primary: '21 90.2% 47.8%', navy: '15 74.6% 27.8%' },
  { value: 'emerald', label: 'Emerald', primary: '158 84% 29.4%', navy: '164 85.7% 16.5%' },
  { value: 'royal', label: 'Royal', primary: '254 53.5% 50.2%', navy: '253 64.4% 28.6%' },
  { value: 'teal', label: 'Teal', primary: '189 84.7% 28.2%', navy: '197 78.9% 14.9%' },
  { value: 'slate', label: 'Slate', primary: '215 25% 26.7%', navy: '222 47.4% 11.2%' },
] as const;

type Values<T extends readonly { value: string }[]> = T[number]['value'];

export interface Appearance {
  font: Values<typeof FONTS>;
  sidebar: Values<typeof SIDEBARS>;
  corners: Values<typeof CORNERS>;
  density: Values<typeof DENSITY_OPTIONS>;
  links: Values<typeof LINK_STYLES>;
  headingFont: Values<typeof HEADING_FONTS>;
  headingWeight: Values<typeof HEADING_WEIGHTS>;
  headingStyle: Values<typeof HEADING_STYLES>;
  headingBacking: Values<typeof HEADING_BACKINGS>;
  numberWeight: Values<typeof NUMBER_WEIGHTS>;
  textSize: Values<typeof TEXT_SIZES>;
  buttonShape: Values<typeof BUTTON_SHAPES>;
  quietButtons: Values<typeof QUIET_BUTTONS>;
}

export const DEFAULT_APPEARANCE: Appearance = {
  font: 'inter', sidebar: 'light', corners: 'soft', density: 'comfortable', links: 'bold',
  headingFont: 'same', headingWeight: '600', headingStyle: 'normal', headingBacking: 'none',
  numberWeight: '400', textSize: 'normal', buttonShape: 'pill', quietButtons: 'white',
};

const LISTS: { [K in keyof Appearance]: readonly { value: string }[] } = {
  font: FONTS, sidebar: SIDEBARS, corners: CORNERS, density: DENSITY_OPTIONS, links: LINK_STYLES,
  headingFont: HEADING_FONTS, headingWeight: HEADING_WEIGHTS, headingStyle: HEADING_STYLES,
  headingBacking: HEADING_BACKINGS, numberWeight: NUMBER_WEIGHTS, textSize: TEXT_SIZES,
  buttonShape: BUTTON_SHAPES, quietButtons: QUIET_BUTTONS,
};

function allowed<K extends keyof Appearance>(key: K, v: unknown): v is Appearance[K] {
  return typeof v === 'string' && LISTS[key].some((o) => o.value === v);
}

/** The saved appearance, with anything unknown replaced by the default. */
export function readAppearance(tokens: unknown): Appearance {
  const raw = (tokens && typeof tokens === 'object'
    ? (tokens as Record<string, unknown>).appearance
    : null) as Record<string, unknown> | null;
  const out = { ...DEFAULT_APPEARANCE };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(LISTS) as (keyof Appearance)[]) {
    if (allowed(key, raw[key])) (out as Record<string, string>)[key] = raw[key] as string;
  }
  return out;
}

export class AppearanceError extends Error {}

/**
 * Check a submitted appearance. Unlike `readAppearance` it REFUSES an unknown
 * value instead of quietly defaulting it - a save that silently did something
 * else is worse than one that says no.
 */
export function cleanAppearance(input: Partial<Record<keyof Appearance, string>>): Appearance {
  const out = { ...DEFAULT_APPEARANCE };
  for (const key of Object.keys(LISTS) as (keyof Appearance)[]) {
    const v = input[key];
    if (v === undefined || v === '') continue;
    if (!allowed(key, v)) throw new AppearanceError(`"${v}" is not an option for ${key}.`);
    (out as Record<string, string>)[key] = v;
  }
  return out;
}

const HSL_TRIPLE = /^\d{1,3}(\.\d+)?\s+\d{1,3}(\.\d+)?%\s+\d{1,3}(\.\d+)?%$/;
const PALETTE_KEYS = ['--brand-primary', '--brand-navy', '--brand-accent'] as const;

/**
 * The tenant's stylesheet: palette tokens plus the Appearance choices, as CSS
 * text for a <style> tag. Palette values must be HSL triples; anything else
 * is dropped. Appearance values are mapped through the lists above.
 */
export function tenantCss(tokens: unknown): string {
  const t = (tokens && typeof tokens === 'object' ? tokens : {}) as Record<string, unknown>;
  const vars: string[] = [];
  for (const k of PALETTE_KEYS) {
    const v = t[k];
    if (typeof v === 'string' && HSL_TRIPLE.test(v.trim())) vars.push(`${k}:${v.trim()}`);
  }

  const a = readAppearance(t);
  const font = FONTS.find((f) => f.value === a.font)!;
  if (a.font !== DEFAULT_APPEARANCE.font) vars.push(`--font-sans:var(${font.cssVar})`);
  const c = CORNERS.find((o) => o.value === a.corners)!;
  if (a.corners !== DEFAULT_APPEARANCE.corners) {
    vars.push(`--radius-sm:${c.sm}`, `--radius:${c.md}`, `--radius-lg:${c.lg}`);
  }
  if (a.density === 'compact') vars.push('--ctl-h:2.125rem', '--row-py:0.5rem');

  let css = vars.length ? `:root{${vars.join(';')}}` : '';
  // The page background chosen on Appearance (12 Oct 2026, lib/page-background).
  css += pageBackgroundRule(t);
  if (a.links === 'underline') {
    css += 'main a.text-brand,main a.text-info{text-decoration:underline;text-underline-offset:3px}';
  }
  css += typeCss(a);
  // Colours of the top bar, cards, tables, buttons and text (12 Oct 2026, lib/look).
  css += lookCss(t, a.headingBacking, pageColours(readPageBackground(t)));
  return css;
}

/**
 * Headings, numbers, text size and button shape (12 Oct 2026). Nothing is
 * written for a default, so a business that never touched these renders
 * exactly as before. `.page-title` is every page's h1 (PageHeader, the
 * dashboards); `.page-head` the row it sits in; `.btn` every Button.
 */
export function typeCss(a: Appearance): string {
  let css = '';
  const title: string[] = [];
  const hf = HEADING_FONTS.find((f) => f.value === a.headingFont)!;
  if (hf.cssVar) title.push(`font-family:var(${hf.cssVar}),ui-sans-serif,system-ui,sans-serif`);
  if (a.headingWeight !== DEFAULT_APPEARANCE.headingWeight) title.push(`font-weight:${a.headingWeight}`);
  if (a.headingStyle === 'italic') title.push('font-style:italic');
  if (a.headingStyle === 'caps') title.push('text-transform:uppercase', 'letter-spacing:.04em');
  if (title.length) css += `.page-title.page-title{${title.join(';')}}`;
  if (a.headingBacking === 'glass') {
    css += '.page-head{background:hsl(var(--card)/.72);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);'
      + 'border:1px solid hsl(var(--card)/.6);border-radius:var(--radius-lg);padding:.75rem 1rem}';
  } else if (a.headingBacking === 'solid') {
    css += '.page-head{background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:var(--radius-lg);padding:.75rem 1rem}';
  }
  if (a.numberWeight !== DEFAULT_APPEARANCE.numberWeight) css += `main td.text-end:not(#_){font-weight:${a.numberWeight}}`;
  const size = TEXT_SIZES.find((o) => o.value === a.textSize)!;
  if (size.pct) css += `html{font-size:${size.pct}}`;
  const shape = BUTTON_SHAPES.find((o) => o.value === a.buttonShape)!;
  if (shape.radius) css += `.btn.btn{border-radius:${shape.radius}}`;
  if (a.quietButtons === 'soft') {
    css += '.btn-quiet.btn-quiet{background-color:color-mix(in srgb,hsl(var(--brand-primary)) 9%,hsl(var(--card)));'
      + 'color:color-mix(in srgb,hsl(var(--brand-primary)) 70%,hsl(var(--foreground)));--tw-ring-color:hsl(var(--brand-primary)/.3)}';
  } else if (a.quietButtons === 'outline') {
    css += '.btn-quiet.btn-quiet{background-color:transparent;--tw-ring-color:hsl(var(--foreground)/.55)}';
  }
  return css;
}

/** Which sidebar class the shell renders. */
export function sidebarClass(tokens: unknown): string {
  const s = readAppearance(tokens).sidebar;
  return s === 'light' ? 'sidebar-light' : s === 'charcoal' ? 'sidebar-dark sidebar-charcoal' : 'sidebar-dark';
}

/** `#1D4ED8` → `224 76.3% 48%`, for the live preview. Null when unreadable. */
export function hexToTriple(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
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

/** A preset's primary and deep colours as hex, for the pickers. */
export function tripleToHex(triple: string): string {
  const m = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(triple.trim());
  if (!m) return '';
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const f = (p: number, q: number, t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const [r, g, b] = s === 0 ? [l, l, l] : [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)];
  const to = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/**
 * The business's colours as hex, for Vcare (UI refresh phase 5, 4 Oct
 * 2026). Null where the business kept the product default - the app then
 * keeps its own palette.
 */
export function brandHexes(tokens: unknown): { primary: string | null; navy: string | null } {
  const t = (tokens && typeof tokens === 'object' ? tokens : {}) as Record<string, unknown>;
  const hex = (k: string) => {
    const v = t[k];
    return typeof v === 'string' && HSL_TRIPLE.test(v.trim()) ? tripleToHex(v) || null : null;
  };
  return { primary: hex('--brand-primary'), navy: hex('--brand-navy') };
}
