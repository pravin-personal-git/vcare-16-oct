import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildTranslator } from '@shared/lib/translate-text';
import webHindi from '@shared/i18n/hi-dictionary.json';
import appHindi from './app-hi.json';
import { hasChosenLang, saveLang, type Lang } from '@/lib/prefs';
import { FullScreenAlert } from '../../modules/full-screen-alert';

/**
 * English and Hindi, the same way the website does it.
 *
 * Screens are written in English and every visible string goes through
 * `t()`. In Hindi, `t()` looks the English up in the website's own Hindi
 * dictionary (5,000+ strings, already reviewed) plus a small dictionary of
 * app-only strings. Templates work too: `t(\`Welcome, ${name}\`)` matches the
 * dictionary's "Welcome, {0}". A string with no Hindi yet stays English
 * rather than showing a blank - the same rule as the website.
 */
interface I18nValue {
  lang: Lang;
  t: (english: string) => string;
  setLang: (l: Lang) => void;
  toggle: () => void;
  /** The layout's language (Settings > Roles > Phone app > Layout) - only until the person picks one. */
  applyLayoutLang: (l: Lang) => void;
}

const translator = buildTranslator({ ...(webHindi as Record<string, string>), ...(appHindi as Record<string, string>) });

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    void saveLang(l);
  }, []);

  const applyLayoutLang = useCallback((l: Lang) => {
    void hasChosenLang().then((chosen) => { if (!chosen) setLangState(l); });
  }, []);

  // The alarm card is drawn natively; it speaks the app's language.
  useEffect(() => { try { FullScreenAlert?.setLang?.(lang); } catch { /* older build */ } }, [lang]);

  const t = useCallback(
    (english: string) => (lang === 'hi' ? translator.translate(english) ?? english : english),
    [lang],
  );

  const value = useMemo(
    () => ({ lang, t, setLang, toggle: () => setLang(lang === 'hi' ? 'en' : 'hi'), applyLayoutLang }),
    [lang, t, setLang, applyLayoutLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error('useT must be used inside <I18nProvider>');
  return v;
}
