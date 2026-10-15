'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { VARIANTS, SIZES, type Variant, type Size } from './button-class';
import { ask } from './ask';

export { buttonClass } from './button-class';

/**
 * One button, seven intents.
 *
 * The original app's screens each grew their own buttons, so "save" is a
 * different shape on three different forms. Defining the variants once is the
 * cheapest way to stop that happening again - and it means a tenant's palette
 * swap reaches every button without touching a screen.
 *
 * Intent mapping, deliberately:
 *   primary   the one thing this screen is for
 *   navy      a strong secondary - cancel on a form, back on a page
 *   accent    coral, used sparingly. Reserved for genuinely irreversible
 *             actions that are not destructive (send, convert, publish)
 *   outline   everything else in a toolbar
 *   ghost     icon-only chrome
 *   success / danger  outcome-carrying actions
 */

const TONE = {
  brand: 'text-brand', success: 'text-success', danger: 'text-danger', warning: 'text-warning', wa: 'text-wa', muted: 'text-muted-foreground',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  /** Places the icon after the label. */
  iconEnd?: IconName;
  /** Colour of the leading icon on soft / outline buttons (Option A): brand, success, danger, warning, wa, muted. */
  iconTone?: 'brand' | 'success' | 'danger' | 'warning' | 'wa' | 'muted';
  /** A keyboard hint shown at the end, e.g. "N". */
  kbd?: string;
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'outline',
  size = 'md',
  icon,
  iconEnd,
  iconTone,
  kbd,
  loading = false,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  // A disabled button that knows why (its `title`) stays tappable and says so
  // in the app's pop-up (13 Oct 2026, audit): a hover tooltip never shows on a
  // phone, so the button just looked broken. It still looks disabled and does
  // nothing else.
  const why = disabled && !loading && typeof rest.title === 'string' && rest.title ? rest.title : null;
  if (why) {
    const { onClick: _unused, ...shown } = rest;
    void _unused;
    return (
      <button
        type="button"
        {...shown}
        aria-disabled="true"
        onClick={() => void ask.tell({ icon: 'lock', title: 'Not available yet', message: why })}
        className={[
          'btn inline-flex shrink-0 cursor-not-allowed items-center justify-center whitespace-nowrap font-semibold opacity-45 transition',
          VARIANTS[variant].replace(/\S*hover:\S+/g, ''),
          SIZES[size],
          className,
        ].join(' ')}
      >
        {icon && <Icon name={icon} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
        {children}
        {iconEnd && <Icon name={iconEnd} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={[
        'btn inline-flex shrink-0 items-center justify-center whitespace-nowrap font-semibold transition',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {loading ? (
        <Icon name="refresh" className="h-3.5 w-3.5 animate-spin" />
      ) : (
        icon && <Icon name={icon} className={`${size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${iconTone ? TONE[iconTone] : (variant === 'outline' || variant === 'soft') ? 'text-muted-foreground' : ''}`} />
      )}
      {children}
      {kbd && <kbd className="ms-0.5 rounded bg-foreground/10 px-1.5 font-mono text-cap font-semibold opacity-70">{kbd}</kbd>}
      {iconEnd && !loading && (
        <Icon name={iconEnd} className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      )}
    </button>
  );
}

/**
 * A toolbar toggle - the original's Active / Page ON controls.
 * Reads as a switch rather than a button, because it holds state.
 */
export function ToggleChip({
  on, onChange, label, offLabel,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
  offLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`inline-flex h-ctl shrink-0 items-center gap-2 rounded-full border px-1 pe-3.5 text-sm font-semibold transition ${
        on
          ? 'border-brand/40 bg-brand/10 text-on-tint-brand'
          : 'border-border bg-card text-muted-foreground hover:bg-muted'
      }`}
    >
      <span
        className={`grid h-6 w-6 place-items-center rounded-full transition ${
          on ? 'bg-brand text-brand-fg' : 'bg-muted text-muted-foreground'
        }`}
      >
        <Icon name={on ? 'check' : 'minus'} className="h-3 w-3" strokeWidth={3} />
      </span>
      {on ? label : offLabel ?? label}
    </button>
  );
}
