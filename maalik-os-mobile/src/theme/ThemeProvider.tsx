import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { dark, light, type Palette } from './tokens';
import { saveTheme, type ThemeMode } from '@/lib/prefs';
import { onBrand, type Brand } from '@/lib/brand';
import { withBrand } from './brand';

/**
 * Light, dark, or follow the phone. The choice is saved on the phone and
 * applies to every screen at once - the switch in any header flips the whole
 * app, it is not a per-screen setting.
 */
interface ThemeValue {
  mode: ThemeMode;
  isDark: boolean;
  c: Palette;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ initial, initialBrand = null, children }: {
  initial: ThemeMode;
  /** The business's colours saved on the phone (lib/brand), for the first frame. */
  initialBrand?: Brand | null;
  children: ReactNode;
}) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(initial);
  const [brand, setBrand] = useState<Brand | null>(initialBrand);
  useEffect(() => onBrand(setBrand), []);
  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    void saveTheme(m);
  }, []);

  const toggle = useCallback(() => setMode(isDark ? 'light' : 'dark'), [isDark, setMode]);

  const value = useMemo(
    () => ({ mode, isDark, c: withBrand(isDark ? dark : light, brand, isDark), setMode, toggle }),
    [mode, isDark, brand, setMode, toggle],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme must be used inside <ThemeProvider>');
  return v;
}
