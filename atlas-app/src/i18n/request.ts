import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { defaultLocale, locales, type Locale } from './config';

export const LOCALE_COOKIE = 'atlas_locale';

/**
 * Locale resolution.
 *
 * Phase 0 reads a cookie set by the header switcher. Phase 1 adds a [locale]
 * route segment so language is shareable in the URL, falling back to the user's
 * stored preference.
 *
 * SEVERITY NOTE, 17 Sep 2026: `locales` in `./config` lists all ten languages
 * the switcher offers, but only `en` and `ar` have a `./messages/*.json` file
 * today - the rest of this app's text is still hardcoded English throughout,
 * not yet pulled through this system at all. Selecting one of the other
 * eight used to throw here (`import` of a file that doesn't exist), and
 * because the cookie this reads is long-lived and non-httpOnly, that crash
 * repeated on every single request from that browser until the cookie was
 * cleared by hand - a UI language switch is never allowed to be able to take
 * the whole app down like that, no matter how incomplete the translation
 * coverage is. Falls back to `defaultLocale`'s messages instead of throwing;
 * `LocaleSwitcher` also stops offering a locale that would hit this path.
 */
export default getRequestConfig(async () => {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale =
    cookie && (locales as readonly string[]).includes(cookie)
      ? (cookie as Locale)
      : defaultLocale;

  try {
    return {
      locale,
      messages: (await import(`./messages/${locale}.json`)).default,
    };
  } catch {
    return {
      locale: defaultLocale,
      messages: (await import(`./messages/${defaultLocale}.json`)).default,
    };
  }
});

export { locales, defaultLocale };
