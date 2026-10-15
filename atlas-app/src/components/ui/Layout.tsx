'use client';

import { cloneElement, isValidElement, useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { Icon, type IconName, isIconName } from './Icon';
import { translateLabel } from '@/i18n/ui-translations';
import { statusLabel, statusTone } from '@/lib/status-tones';

/**
 * Page and section furniture.
 *
 * Every screen in the original opens the same way - a round badge, a title, a
 * quiet subtitle, and the page's actions pinned to the far end. Repeating that
 * by hand on fifty screens is how fifty screens end up slightly different.
 */

export function PageHeader({
  badge, title, subtitle, actions,
}: {
  /** Two or three letters. Falls back to an icon if you pass one instead. */
  badge?: string | IconName;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  const isIcon = badge != null && badge.length > 3;
  const locale = useLocale();

  return (
    <div className="page-head mb-5 flex flex-wrap items-center gap-3">
      {badge && (
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand/10 text-sm font-bold text-on-tint-brand">
          {/*
            `isIconName` rather than a cast. The old test was "longer than three
            characters", which is true of plenty of badges that are not icons -
            and the cast then handed the name straight to `Icon`. A real check
            means a long text badge renders as text, which is what it is.
          */}
          {isIcon && isIconName(badge) ? <Icon name={badge} className="h-5 w-5" /> : badge}
        </span>
      )}
      <div className="me-auto min-w-0">
        <h1 className="page-title truncate text-h2 font-semibold text-foreground sm:text-h1">{translateLabel(title, locale)}</h1>
        {subtitle && (
          <p className="page-sub mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A titled panel. The original uses a tinted title bar above a white body,
 * which does more work than a heading alone: it tells you where a group of
 * fields starts and, more importantly, where it stops.
 */
export function SectionCard({
  title, icon, action, children, className = '', bodyClassName = 'p-4',
}: {
  title: string;
  icon?: IconName;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-lg border border-border bg-card ${className}`}>
      {/* The demo's panel head (11 Oct 2026): white, a 28px icon chip, a 14px/600 title. */}
      <header className="flex min-h-[2.875rem] items-center gap-2 border-b border-border px-4 py-2.5">
        {icon && (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand/10 text-on-tint-brand">
            <Icon name={icon} className="h-3.5 w-3.5" />
          </span>
        )}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action && <div className="ms-auto">{action}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** A plain card with no title bar. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-border bg-card ${className}`}>
      {children}
    </div>
  );
}

export function Field({
  label, required, hint, error, htmlFor, children, className = '',
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  // Every label names its field for a screen reader (13 Oct 2026, WCAG audit:
  // 175 of 470 Fields passed no htmlFor). A plain input / select / textarea
  // child gets the id here; anything else (a picker, a wrapped input) gets it
  // on its first form control once mounted.
  const auto = useId();
  const box = useRef<HTMLDivElement>(null);
  const child = isValidElement(children) && typeof children.type === 'string' && /^(input|select|textarea)$/.test(children.type)
    ? (children as ReactElement<{ id?: string }>) : null;
  const target = htmlFor ?? child?.props.id ?? auto;
  useEffect(() => {
    if (htmlFor || child) return;
    const el = box.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea');
    if (el && !el.id && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')) el.id = auto;
  }, [htmlFor, child, auto]);

  return (
    <div ref={box} className={className}>
      <label htmlFor={target} className="field-label">
        {label}
        {required && <span className="ms-0.5 text-danger">*</span>}
      </label>
      {child && !child.props.id ? cloneElement(child, { id: target }) : children}
      {error ? (
        <p className="mt-1 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** A label/value row for a summary panel. */
export function SummaryRow({
  label, value, strong = false, tone,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  tone?: 'default' | 'danger' | 'success';
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 py-1.5 ${
        strong ? 'border-t border-border-strong pt-2 text-sm font-bold' : 'text-sm'
      }`}
    >
      <span className={strong ? '' : 'text-muted-foreground'}>{label}</span>
      <span
        className={`font-mono tabular-nums ${
          tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export function EmptyState({
  icon = 'folder', title, hint, action,
}: {
  icon?: IconName;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-brand/10 text-on-tint-brand ring-8 ring-brand/[0.04]">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <p className="mt-1 text-base font-bold text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

const TONE_CLASS = {
  neutral: 'bg-muted text-muted-foreground',
  brand: 'bg-brand/10 text-on-tint-brand',
  navy: 'bg-navy/10 text-on-tint-navy',
  success: 'bg-success/[0.12] text-on-tint-success',
  warning: 'bg-warning/15 text-on-tint-warning',
  danger: 'bg-danger/10 text-on-tint-danger',
  info: 'bg-info/10 text-on-tint-info',
} as const;

export type BadgeTone = keyof typeof TONE_CLASS;

export function Badge({
  children, tone = 'neutral', icon, className = '', title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: IconName;
  className?: string;
  /**
   * Hover text.
   *
   * A badge is a count or a state in two words. Often the useful detail - which
   * records, why the number is what it is - does not fit and would clutter the
   * row if it did. This is where that goes.
   */
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASS[tone]} ${className}`}
    >
      {icon && <Icon name={icon} className="h-3 w-3" />}
      {children}
    </span>
  );
}

/**
 * A status word in its one colour (F1 UI standard - see lib/status-tones).
 * `label` overrides the words shown; the colour still comes from `status`.
 */
export function StatusBadge({ status, label, icon, className }: {
  status: string | null | undefined; label?: string; icon?: IconName; className?: string;
}) {
  return <Badge tone={statusTone(status)} icon={icon} className={className}>{label ?? statusLabel(status)}</Badge>;
}

/** The original's Road / Air style control. */
export function Segmented<T extends string>({
  options, value, onChange, size = 'md',
}: {
  options: { value: T; label: string; icon?: IconName }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-sm border border-border bg-muted/70 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`inline-flex items-center gap-1 rounded-sm font-semibold transition ${
            size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-xs'
          } ${
            value === o.value
              ? 'bg-brand text-brand-fg shadow-brand'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.icon && <Icon name={o.icon} className="h-3.5 w-3.5" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
