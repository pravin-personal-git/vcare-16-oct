import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { getDirection, type Locale } from '@/i18n/config';
import '@/styles/globals.css';
import Script from 'next/script';
import { cookies } from 'next/headers';
import { FONT_VARIABLES } from '@/lib/fonts';
import { readUiPrefs } from '@/lib/ui-prefs';
import { HindiTranslator } from '@/components/shell/HindiTranslator';

export const metadata: Metadata = {
  title: 'Atlas - Business Operating System',
  description: 'Run your entire business from one platform',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = (await getLocale()) as Locale;
  const messages = await getMessages();
  // The person's own light/dark, density and contrast, on the first paint.
  const jar = await cookies();
  const prefs = readUiPrefs((name) => jar.get(name)?.value);

  // dir flips the whole layout. Because every component uses logical CSS
  // properties (margin-inline-start, border-inline-end), this single attribute
  // mirrors the entire UI - no per-component RTL overrides.
  return (
    <html
      lang={locale}
      dir={getDirection(locale)}
      className={FONT_VARIABLES}
      data-theme={prefs.theme}
      data-contrast={prefs.contrast}
      {...(prefs.density ? { 'data-density': prefs.density } : {})}
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <NextIntlClientProvider messages={messages}>
          {children}
          {/* Hindi: translates everything on screen - see HindiTranslator. */}
          {locale === 'hi' && <HindiTranslator />}
        </NextIntlClientProvider>
        {/* Vercel Speed Insights - real load and click timings from real use
            (health check, 25 Sep 2026). Reports once Speed Insights is switched
            on for the project in Vercel; until then the request is a quiet 404. */}
        {process.env.VERCEL && <Script src="/_vercel/speed-insights/script.js" strategy="afterInteractive" />}
      </body>
    </html>
  );
}
