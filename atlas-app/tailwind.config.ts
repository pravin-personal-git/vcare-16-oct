import type { Config } from 'tailwindcss';

/**
 * Every colour is a CSS custom property, never a literal.
 *
 * The original app hard-codes its palette and therefore cannot be
 * white-labelled without a code change. A lint rule blocks hex values in
 * `src/`; this file is the only place colour is named at all, and even here it
 * only names a token.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  // `dark:` follows the person's own choice (data-theme on <html>, set from
  // their menu), not only the operating system. Prefer tokens; this exists for
  // the rare literal that has no token.
  darkMode: ['variant', [
    '&:is([data-theme="dark"] *)',
    '@media (prefers-color-scheme: dark) { &:is([data-theme="system"] *) }',
  ]],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: 'hsl(var(--brand-primary))',
          hover: 'color-mix(in srgb, hsl(var(--brand-primary)) 86%, black)',
          fg: 'hsl(var(--brand-primary-fg))',
        },
        navy: {
          DEFAULT: 'hsl(var(--brand-navy))',
          hover: 'color-mix(in srgb, hsl(var(--brand-navy)) 82%, black)',
          fg: 'hsl(var(--brand-navy-fg))',
        },
        accent: {
          DEFAULT: 'hsl(var(--brand-accent))',
          hover: 'color-mix(in srgb, hsl(var(--brand-accent)) 86%, black)',
          fg: 'hsl(var(--brand-accent-fg))',
        },
        // The money action (G-39): Binance yellow with black text, on Record payment only.
        money: { DEFAULT: '#fcd535', hover: '#f0b90b', fg: '#181a20' },
        // WhatsApp's own green, for send-on-WhatsApp actions (11 Oct 2026).
        wa: 'hsl(var(--wa))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        danger: 'hsl(var(--danger))',
        info: 'hsl(var(--info))',

        background: 'hsl(var(--background))',
        surface: 'hsl(var(--surface))',
        card: 'hsl(var(--card))',
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        border: {
          DEFAULT: 'hsl(var(--border))',
          strong: 'hsl(var(--border-strong))',
        },
        foreground: 'hsl(var(--foreground))',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        raised: 'var(--shadow-raised)',
        overlay: 'var(--shadow-overlay)',
        brand: 'var(--shadow-brand)',
        money: '0 6px 16px -6px rgb(240 185 11 / 0.7)',
      },
      /*
       * One type scale (UI refresh, 4 Oct 2026). Nothing below 11px, and 11px
       * only for uppercase labels. Arbitrary `text-[Npx]` sizes are refused by
       * the type-scale ratchet test - add a step here instead.
       *
       * xs and sm keep their Tailwind names (1,500 uses) but xs grows from 12
       * to 12.5px. small / body / lead / h3 / h2 / h1 / num are the named steps.
       */
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.07em' }],
        // Dashboards (11 Oct 2026): chart captions and chips at 11px without
        // the label tracking, the 13px period switch, 15px card titles and the
        // 34px figure in a drill-down.
        cap: ['0.6875rem', { lineHeight: '1rem' }],
        chip: ['0.8125rem', { lineHeight: '1.2rem' }],
        title: ['0.9375rem', { lineHeight: '1.35rem' }],
        hero: ['2.125rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        xs: ['0.78125rem', { lineHeight: '1.15rem' }],
        small: ['0.78125rem', { lineHeight: '1.15rem' }],
        sm: ['0.875rem', { lineHeight: '1.3rem' }],
        body: ['0.875rem', { lineHeight: '1.35rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lead: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.6rem' }],
        h3: ['1.125rem', { lineHeight: '1.5rem', fontWeight: '700' }],
        xl: ['1.25rem', { lineHeight: '1.7rem' }],
        h2: ['1.375rem', { lineHeight: '1.8rem', letterSpacing: '-0.01em' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        num: ['1.625rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        h1: ['1.75rem', { lineHeight: '2.15rem', letterSpacing: '-0.02em' }],
        kpi: ['1.625rem', { lineHeight: '1.1', fontWeight: '600', letterSpacing: '-0.02em' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
        '5xl': ['3rem', { lineHeight: '1.05' }],
        // Marketing only (10 Oct 2026). The scale above is built for dense
        // screens full of figures; a landing page headline is the one place
        // that wants to be read from across a room. Added as steps rather
        // than arbitrary values, which is what the type-scale ratchet asks.
        display: ['3.5rem', { lineHeight: '1.02', letterSpacing: '-0.03em' }],
        mega: ['4.75rem', { lineHeight: '0.98', letterSpacing: '-0.035em' }],
      },
      // The look tops out at 700 (ATLAS-DESIGN.md): `font-extrabold` reads as bold.
      fontWeight: { extrabold: '700', black: '700' },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Noto Sans Devanagari', 'sans-serif'],
        // Figures (G-39): every `font-mono` amount and document number reads in the number face.
        mono: ['var(--font-plex)', 'var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      spacing: {
        ctl: 'var(--ctl-h)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'slide-up': 'slide-up 160ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
