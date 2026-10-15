import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Small, non-secret preferences: theme and language. Never tokens - those go
 * in secure storage (see session.ts). Every read and write tolerates failure,
 * because a preference that cannot be saved must never break the app.
 */

export type ThemeMode = 'system' | 'light' | 'dark';
export type Lang = 'en' | 'hi';

const KEY = { theme: 'maalik.theme', lang: 'maalik.lang' } as const;

async function get(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function set(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    /* preference not saved - the app carries on with it in memory */
  }
}

export async function loadPrefs(): Promise<{ theme: ThemeMode; lang: Lang }> {
  const [theme, lang] = await Promise.all([get(KEY.theme), get(KEY.lang)]);
  return {
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
    lang: lang === 'hi' ? 'hi' : 'en',
  };
}

export const saveTheme = (mode: ThemeMode) => set(KEY.theme, mode);
export const saveLang = (lang: Lang) => set(KEY.lang, lang);

/** Has the person picked a language themselves? If not, their layout's default applies (13 Oct 2026, decision 7). */
export const hasChosenLang = async () => (await get(KEY.lang)) !== null;
