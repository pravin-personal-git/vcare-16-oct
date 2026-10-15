/**
 * A person's own display choices (UI refresh, 4 Oct 2026): light or dark,
 * comfortable or compact, standard or high contrast.
 *
 * Kept in cookies rather than on the user row, deliberately: they belong to
 * the DEVICE as much as the person - dark on the phone at night, light on the
 * office PC - and a cookie lets the root layout render <html> with the right
 * attributes on the very first paint, for the login page and the shop too,
 * without a database read.
 *
 * Every value is checked against its list before it reaches the page; an
 * unknown cookie value is ignored, never echoed.
 */
export const UI_PREF_COOKIES = {
  theme: 'atlas_theme',
  density: 'atlas_density',
  contrast: 'atlas_contrast',
} as const;

export const THEME_MODES = ['light', 'dark', 'system'] as const;
export const DENSITIES = ['comfortable', 'compact'] as const;
export const CONTRASTS = ['standard', 'high'] as const;

export type ThemeMode = (typeof THEME_MODES)[number];
export type Density = (typeof DENSITIES)[number];
export type Contrast = (typeof CONTRASTS)[number];

export interface UiPrefs {
  theme: ThemeMode;
  /** null = follow the business default (Settings › Appearance). */
  density: Density | null;
  contrast: Contrast;
}

function pick<T extends string>(list: readonly T[], v: string | undefined): T | null {
  return v && (list as readonly string[]).includes(v) ? (v as T) : null;
}

export function readUiPrefs(get: (name: string) => string | undefined): UiPrefs {
  return {
    theme: pick(THEME_MODES, get(UI_PREF_COOKIES.theme)) ?? 'light',
    density: pick(DENSITIES, get(UI_PREF_COOKIES.density)),
    contrast: pick(CONTRASTS, get(UI_PREF_COOKIES.contrast)) ?? 'standard',
  };
}

export function isUiPref(key: keyof typeof UI_PREF_COOKIES, value: string): boolean {
  const list = key === 'theme' ? THEME_MODES : key === 'density' ? DENSITIES : CONTRASTS;
  return (list as readonly string[]).includes(value);
}
