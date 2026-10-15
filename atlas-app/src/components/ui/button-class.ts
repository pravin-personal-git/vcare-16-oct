/**
 * The button look as plain class names (11 Oct 2026).
 *
 * Lives outside Button.tsx because that file is 'use client': a server component
 * that called `buttonClass` from it got a client reference instead of a
 * function and the page failed to render (every live sales order with an
 * installation, via InstallationStrip). Plain module - safe on both sides.
 */

export type Variant =
  | 'primary' | 'navy' | 'accent' | 'outline' | 'ghost' | 'success' | 'danger' | 'money'
  | 'wa' | 'tint' | 'soft' | 'dangerText';
export type Size = 'sm' | 'md' | 'lg' | 'icon';

export const VARIANTS: Record<Variant, string> = {
  // UI refresh (4 Oct 2026): the primary button has depth - a top-light
  // gradient, an inner highlight and a soft shadow in the brand colour.
  primary: 'btn-depth btn-lift bg-brand text-brand-fg hover:bg-brand-hover',
  navy: 'bg-navy text-navy-fg shadow-card hover:bg-navy-hover active:translate-y-px',
  accent: 'bg-accent text-accent-fg shadow-card hover:bg-accent-hover active:translate-y-px',
  // Option A (11 Oct 2026, ops-pages demo): soft - a card with an inset
  // hairline ring that darkens on hover and a 1px lift. The icon carries the
  // colour (see `iconTone`), the label stays ink.
  outline: 'btn-quiet btn-lift bg-card text-foreground ring-1 ring-inset ring-border hover:bg-surface hover:ring-border-strong',
  soft: 'btn-quiet btn-lift bg-card text-foreground ring-1 ring-inset ring-border hover:bg-surface hover:ring-border-strong',
  // WhatsApp in its own green, tinted - sending to a customer is not the
  // page's primary action, but it is the one people look for.
  wa: 'btn-lift bg-wa/10 text-wa ring-1 ring-inset ring-wa/25 hover:bg-wa/15',
  tint: 'btn-lift bg-brand/10 text-brand hover:bg-brand/15',
  // Destructive inside a menu or at the end of a bar: red text, no fill.
  dangerText: 'text-danger hover:bg-danger/10',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
  success: 'bg-success text-brand-fg shadow-card hover:brightness-95 active:translate-y-px',
  danger: 'bg-danger text-brand-fg shadow-card hover:brightness-95 active:translate-y-px',
  // G-39: the money action - Binance yellow, black text. Record payment, nothing else.
  money: 'btn-lift bg-money text-money-fg shadow-money hover:bg-money-hover',
};

// `h-ctl` follows density: 40px comfortable, 34px compact.
// Pills since G-39 (10 Oct 2026) - Apple's action shape, on every button.
export const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 rounded-full px-3.5 text-xs',
  md: 'h-ctl gap-2 rounded-full px-5 text-sm',
  lg: 'h-11 gap-2 rounded-full px-6 text-sm',
  icon: 'h-ctl w-ctl rounded-full',
};

/** The button look, for a link that has to be a real <a> (a file download). */
export function buttonClass(variant: Variant = 'outline', size: Size = 'md'): string {
  return ['btn inline-flex shrink-0 items-center justify-center whitespace-nowrap font-semibold transition', VARIANTS[variant], SIZES[size]].join(' ');
}

