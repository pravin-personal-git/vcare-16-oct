import type { Palette } from './tokens';
import type { Brand } from '@/lib/brand';

/**
 * Re-colour a palette with the business's brand (UI refresh phase 5).
 *
 * Only the brand tokens move: status colours (success, warning, danger) keep
 * their meaning in every business, the same rule as the website. In dark mode
 * the brand is lifted towards white so a deep colour stays readable on a dark
 * ground, and the text on a brand button flips to whichever of white or ink
 * reads better.
 */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** `a` with `t` (0-1) of `b` mixed in. */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

function luminance(hex: string): number {
  const ch = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

export function withBrand(base: Palette, brand: Brand | null, isDark: boolean): Palette {
  if (!brand?.primary) return base;
  const white = '#ffffff';
  let main = brand.primary;
  if (isDark) {
    // Lift until it reads on the dark surface (at most 60% towards white).
    for (let t = 0; t <= 0.6 && contrast(main, base.surface) < 4.5; t += 0.1) main = mix(brand.primary, white, t);
  }
  // In dark mode `base.ink` is itself light, so the dark choice is the page colour.
  const darkInk = isDark ? base.bg : base.ink;
  const ink = contrast(white, main) >= contrast(darkInk, main) ? white : darkInk;
  return {
    ...base,
    // The intro and hero surfaces stay dark (the wordmark must glow) but take
    // the business's deep colour.
    ...(brand.navy ? { hero: mix(brand.navy, '#000000', isDark ? 0.6 : 0.4) } : {}),
    brand: main,
    brandInk: ink,
    brandSoft: isDark ? mix(base.surface, main, 0.22) : mix(white, main, 0.12),
  };
}
