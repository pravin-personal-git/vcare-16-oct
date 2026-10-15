'use client';

import { useState } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { UI_PREF_COOKIES, type Contrast, type Density, type ThemeMode } from '@/lib/ui-prefs';

/**
 * A person's own display choices, in the user menu (UI refresh, 4 Oct 2026):
 * Light / Dark / Auto, standard or high-contrast text, and spacing.
 *
 * Applied to <html> at once - no reload - and remembered in a cookie for a
 * year, which the root layout reads on the next page so the first paint is
 * already right. Per device on purpose: dark on the phone, light at the desk.
 */
function remember(name: string, value: string | null) {
  document.cookie = value
    ? `${name}=${value}; path=/; max-age=31536000; samesite=lax`
    : `${name}=; path=/; max-age=0; samesite=lax`;
}

function readAttr<T extends string>(attr: string, fallback: T): T {
  if (typeof document === 'undefined') return fallback;
  return (document.documentElement.getAttribute(attr) as T | null) ?? fallback;
}

function Row<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: IconName }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="px-3 py-1.5">
      <p className="eyebrow mb-1">{label}</p>
      <div className="grid rounded-sm border border-border bg-muted/70 p-0.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={`inline-flex items-center justify-center gap-1 rounded-[calc(var(--radius-sm)-2px)] px-1.5 py-1 text-xs font-semibold transition ${
              value === o.value ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.icon && <Icon name={o.icon} className="h-3.5 w-3.5" />}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DisplayPrefs() {
  const [theme, setTheme] = useState<ThemeMode>(() => readAttr('data-theme', 'light'));
  const [contrast, setContrast] = useState<Contrast>(() => readAttr('data-contrast', 'standard'));
  const [density, setDensity] = useState<Density | 'default'>(() => readAttr('data-density', 'default'));
  const html = () => document.documentElement;

  return (
    <div className="border-b border-border py-1.5">
      <Row
        label="Look"
        value={theme}
        options={[
          { value: 'light', label: 'Light', icon: 'sun' },
          { value: 'dark', label: 'Dark', icon: 'moon' },
          { value: 'system', label: 'Auto', icon: 'monitor' },
        ]}
        onChange={(v) => { setTheme(v); html().setAttribute('data-theme', v); remember(UI_PREF_COOKIES.theme, v); }}
      />
      <Row
        label="Text"
        value={contrast}
        options={[{ value: 'standard', label: 'Standard' }, { value: 'high', label: 'High contrast' }]}
        onChange={(v) => { setContrast(v); html().setAttribute('data-contrast', v); remember(UI_PREF_COOKIES.contrast, v); }}
      />
      <Row
        label="Spacing"
        value={density}
        options={[
          { value: 'default', label: 'Business' },
          { value: 'comfortable', label: 'Roomy' },
          { value: 'compact', label: 'Compact' },
        ]}
        onChange={(v) => {
          setDensity(v);
          if (v === 'default') { html().removeAttribute('data-density'); remember(UI_PREF_COOKIES.density, null); }
          else { html().setAttribute('data-density', v); remember(UI_PREF_COOKIES.density, v); }
        }}
      />
    </div>
  );
}
