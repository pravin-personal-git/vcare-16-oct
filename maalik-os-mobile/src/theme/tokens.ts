/**
 * The Vcare design tokens - every colour, size and font the app uses.
 *
 * Screens never write a colour or a font name of their own; they take them
 * from here through `useTheme()`. That is what lets the brand colours change
 * in one file when the logo arrives, and what keeps light and dark mode
 * complete: each palette defines every token, so no screen can end up with
 * dark text on a dark ground.
 *
 * PLACEHOLDER BRAND: deep royal blue with a saffron-gold accent, until the
 * Vcare logo is supplied (roadmap §10). Only `brand*` and `accent*` are
 * expected to move.
 */

export interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  ink: string;
  inkSoft: string;
  muted: string;
  line: string;
  brand: string;
  brandInk: string;
  brandSoft: string;
  accent: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  /** The intro and hero surfaces - dark in both themes, so the wordmark always glows. */
  hero: string;
  heroInk: string;
  heroSoft: string;
  shadow: string;
}

export const light: Palette = {
  bg: '#F6F5F1',
  surface: '#FFFFFF',
  surface2: '#EFEDE6',
  ink: '#121826',
  inkSoft: '#465062',
  muted: '#858B97',
  line: '#E3E0D6',
  brand: '#1F43C2',
  brandInk: '#FFFFFF',
  brandSoft: '#E5EAFB',
  accent: '#B9852A',
  accentSoft: '#F6ECD7',
  success: '#1E8552',
  successSoft: '#E1F3E9',
  warning: '#A86B12',
  warningSoft: '#FBF0D9',
  danger: '#C0392B',
  dangerSoft: '#FBE7E3',
  hero: '#0B1220',
  heroInk: '#F3F5FA',
  heroSoft: '#9AA6BD',
  shadow: 'rgba(18, 24, 38, 0.10)',
};

export const dark: Palette = {
  bg: '#0B1220',
  surface: '#121B2D',
  surface2: '#19243A',
  ink: '#EEF1F7',
  inkSoft: '#B7C0D0',
  muted: '#7D879A',
  line: '#243049',
  brand: '#7390FF',
  brandInk: '#0B1220',
  brandSoft: '#1B2A55',
  accent: '#E3B25C',
  accentSoft: '#33291A',
  success: '#46C08A',
  successSoft: '#12291F',
  warning: '#E2A948',
  warningSoft: '#2E2413',
  danger: '#F0806B',
  dangerSoft: '#34191A',
  hero: '#070C16',
  heroInk: '#F3F5FA',
  heroSoft: '#8E9AB2',
  shadow: 'rgba(0, 0, 0, 0.45)',
};

/** Spacing on a 4-point grid. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 18, xl: 26, pill: 999 } as const;

/**
 * Mukta carries both English and Hindi (Latin + Devanagari) in one family, so
 * a sentence never switches typeface halfway when a Hindi word appears. Sora
 * is used only for the Vcare wordmark and large numbers.
 */
export const font = {
  regular: 'Mukta_400Regular',
  medium: 'Mukta_500Medium',
  semibold: 'Mukta_600SemiBold',
  bold: 'Mukta_700Bold',
  brand: 'Sora_700Bold',
  brandLight: 'Sora_300Light',
} as const;

/** Type scale - sizes and line heights, generous enough for outdoor reading. */
export const type = {
  hero: { fontSize: 40, lineHeight: 46 },
  h1: { fontSize: 28, lineHeight: 36 },
  h2: { fontSize: 22, lineHeight: 30 },
  h3: { fontSize: 18, lineHeight: 26 },
  body: { fontSize: 16, lineHeight: 24 },
  small: { fontSize: 14, lineHeight: 20 },
  micro: { fontSize: 12, lineHeight: 16 },
} as const;

/** Minimum touch target, per Android accessibility guidance. */
export const TOUCH = 48;
