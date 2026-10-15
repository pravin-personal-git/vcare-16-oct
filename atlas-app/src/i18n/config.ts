export const locales = ['en', 'hi'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

/**
 * Which locales actually have a `./messages/*.json` file today.
 *
 * Trimmed to just English and Hindi on request - the product may grow back
 * to the full ten-locale, RTL-ready architecture CLAUDE.md describes, but
 * for now two languages that work correctly beats ten where eight silently
 * fall back to English. Most of the app's text is still hardcoded English
 * throughout, not routed through next-intl at all - this list is just "the
 * locale actually has a translation file," not "the whole app is
 * translated." Keep it in sync with `src/i18n/messages/`.
 */
export const translatedLocales: readonly Locale[] = ['en', 'hi'];

/** Neither English nor Hindi is RTL. Left in place, empty, so the direction
 * logic and logical-CSS-property discipline don't need to change if Arabic
 * or another RTL locale comes back later. */
export const rtlLocales: Locale[] = [];

export const localeNames: Record<Locale, string> = {
  en: 'English',
  hi: 'हिंदी',
};

export function getDirection(locale: Locale): 'ltr' | 'rtl' {
  return rtlLocales.includes(locale) ? 'rtl' : 'ltr';
}
