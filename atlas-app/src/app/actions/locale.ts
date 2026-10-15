'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { translatedLocales, type Locale } from '@/i18n/config';
import { LOCALE_COOKIE } from '@/i18n/request';

export async function setLocale(locale: Locale) {
  // Not just "is this a real locale" - is it one we can actually render.
  // `request.ts` would fall back safely either way, but rejecting it here
  // means the switcher's own label never shows a language the page didn't
  // actually switch to.
  if (!translatedLocales.includes(locale)) return;

  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: false, sameSite: 'lax', path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath('/', 'layout');
}
