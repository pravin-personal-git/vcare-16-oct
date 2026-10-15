'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from 'next-intl';
import { Icon, type IconName } from './Icon';
import { buttonClass } from './button-class';
import { useDialogFocus } from './useDialogFocus';
import { translateLabel } from '@/i18n/ui-translations';

/**
 * Atlas's own pop-up, in place of the browser's confirm / alert / prompt
 * (13 Oct 2026, Pravin: "the Chrome dialogue box sometimes looks scary").
 *
 * The browser's box shows the site's address as its title, cannot be themed,
 * blocks the whole tab and looks like a warning even when it is only asking
 * "are you sure?". This one is a calm card in the business's own look: a soft
 * round icon, a plain title, the message, and pill buttons that say what they
 * do. Centred on a laptop, a sheet from the bottom on a phone.
 *
 * Promise-based so a call site changes one line, not its structure:
 *   if (!(await ask.confirm({ title, message, confirmLabel }))) return;
 *   await ask.error(r.error);
 *   const reason = await ask.text({ title, label, required: true });
 *
 * `<AskHost />` is mounted once in the app layout. Anywhere it is not mounted
 * (a page outside the app shell) the browser's own box is used, so nothing
 * ever silently skips the question. `ConfirmDialog` (Modal.tsx) draws the
 * same `PopupCard`, so every confirmation in the app looks alike.
 */

export type PopupTone = 'brand' | 'danger' | 'success' | 'warning' | 'info';

type Base = { title?: string; message?: ReactNode; tone?: PopupTone; icon?: IconName };

export type ConfirmOptions = Base & { confirmLabel?: string; cancelLabel?: string };
export type TellOptions = Base & { okLabel?: string };
export type TextOptions = Base & {
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Empty answers are refused with a line under the box, not a second pop-up. */
  required?: boolean;
  multiline?: boolean;
  inputMode?: 'text' | 'decimal' | 'numeric';
  /** Return a message to refuse the answer and keep the box open. */
  validate?: (value: string) => string | null;
};
export type ChoiceOptions = Base & { yesLabel: string; noLabel: string; cancelLabel?: string };

type Request =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'tell'; opts: TellOptions; resolve: (v: void) => void }
  | { kind: 'text'; opts: TextOptions; resolve: (v: string | null) => void }
  | { kind: 'choice'; opts: ChoiceOptions; resolve: (v: 'yes' | 'no' | null) => void };

let enqueue: ((r: Request) => void) | null = null;

const plain = (m: ReactNode): string => (typeof m === 'string' ? m : '');
const asOpts = <T extends Base>(o: string | T): T => (typeof o === 'string' ? ({ message: o } as T) : o);

export const ask = {
  /** Yes / no before doing something. Resolves true only on the confirm button. */
  confirm(o: string | ConfirmOptions): Promise<boolean> {
    const opts = asOpts(o);
    if (!enqueue) return Promise.resolve(window.confirm([opts.title, plain(opts.message)].filter(Boolean).join('\n\n')));
    return new Promise((resolve) => enqueue!({ kind: 'confirm', opts, resolve }));
  },

  /** Tell the person something - a warning, a note, or that it worked. */
  tell(o: string | TellOptions): Promise<void> {
    const opts = asOpts(o);
    if (!enqueue) { window.alert([opts.title, plain(opts.message)].filter(Boolean).join('\n\n')); return Promise.resolve(); }
    return new Promise((resolve) => enqueue!({ kind: 'tell', opts, resolve }));
  },

  /** Something went wrong - says it gently, with what the server said. */
  error(message: string, title?: string): Promise<void> {
    return ask.tell({ tone: 'warning', title: title ?? 'That did not go through', message });
  },

  /** One typed answer (a reason, an amount). Resolves null when cancelled. */
  text(o: TextOptions): Promise<string | null> {
    if (!enqueue) {
      const v = window.prompt([o.title, plain(o.message)].filter(Boolean).join('\n\n'), o.defaultValue ?? '');
      return Promise.resolve(v);
    }
    return new Promise((resolve) => enqueue!({ kind: 'text', opts: o, resolve }));
  },

  /** Two real answers plus "not now" - e.g. "How did the call go?" */
  choice(o: ChoiceOptions): Promise<'yes' | 'no' | null> {
    if (!enqueue) return Promise.resolve(window.confirm(plain(o.message) || o.title || '') ? 'yes' : 'no');
    return new Promise((resolve) => enqueue!({ kind: 'choice', opts: o, resolve }));
  },
};

const TONE: Record<PopupTone, { chip: string; icon: IconName; button: 'primary' | 'danger' | 'success' }> = {
  brand: { chip: 'bg-brand/10 text-on-tint-brand', icon: 'help-circle', button: 'primary' },
  info: { chip: 'bg-info/10 text-on-tint-info', icon: 'info', button: 'primary' },
  success: { chip: 'bg-success/10 text-on-tint-success', icon: 'check-circle', button: 'success' },
  warning: { chip: 'bg-warning/10 text-on-tint-warning', icon: 'alert-circle', button: 'primary' },
  danger: { chip: 'bg-danger/10 text-on-tint-danger', icon: 'alert-triangle', button: 'danger' },
};

/** Button looks for a pop-up's footer: full width on a phone, natural on a laptop. */
export const popupButton = {
  primary: (tone: PopupTone) => `${buttonClass(TONE[tone].button, 'md')} w-full sm:w-auto`,
  secondary: `${buttonClass('outline', 'md')} w-full sm:w-auto`,
  quiet: `${buttonClass('ghost', 'md')} w-full sm:w-auto`,
};

/**
 * The card itself: dimmed page, soft round icon, title, message, then whatever
 * the caller puts in `children` (a field) and `footer` (the buttons). Escape
 * and a click on the dimmed page call `onDismiss` when it is given.
 */
export function PopupCard({
  tone = 'brand',
  icon,
  title,
  message,
  onDismiss,
  onSubmit,
  children,
  footer,
}: {
  tone?: PopupTone;
  icon?: IconName;
  title: string;
  message?: ReactNode;
  onDismiss?: () => void;
  onSubmit?: () => void;
  children?: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, true);
  const id = useId();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismiss.current) { e.preventDefault(); e.stopPropagation(); dismiss.current(); }
    };
    // Capture, so Escape closes this pop-up and not the drawer underneath it.
    window.addEventListener('keydown', onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey, true); document.body.style.overflow = prev; };
  }, []);

  if (typeof document === 'undefined') return null;
  const look = TONE[tone];

  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- backdrop click; Escape and the buttons do the same by keyboard
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center bg-black/40 animate-fade-in motion-reduce:animate-none sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) dismiss.current?.(); }}
    >
      <div
        ref={ref}
        role={tone === 'danger' || tone === 'warning' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={message ? `${id}-m` : undefined}
        tabIndex={-1}
        className="w-full rounded-t-lg border border-border bg-card px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 shadow-overlay outline-none animate-slide-up motion-reduce:animate-none sm:max-w-[27rem] sm:rounded-lg sm:px-6 sm:pb-5"
      >
        <form
          onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); onSubmit?.(); }}
          className="flex flex-col"
        >
          <span className={`grid h-12 w-12 place-items-center rounded-full ${look.chip}`} aria-hidden>
            <Icon name={icon ?? look.icon} className="h-6 w-6" />
          </span>
          <h2 id={`${id}-t`} className="mt-4 text-lg font-bold leading-snug tracking-tight text-foreground [text-wrap:balance]">
            {title}
          </h2>
          {message && (
            <div id={`${id}-m`} className="thin-scroll mt-1.5 max-h-[45vh] overflow-y-auto whitespace-pre-line break-words text-sm leading-relaxed text-muted-foreground">
              {message}
            </div>
          )}
          {children}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

const DEFAULT_TITLE: Record<Request['kind'], Partial<Record<PopupTone, string>> & { brand: string }> = {
  confirm: { brand: 'Just checking', warning: 'Before you go on', danger: 'Are you sure?' },
  tell: { brand: 'Good to know', success: 'Done', warning: 'Please note', danger: 'Please note' },
  text: { brand: 'One more thing' },
  choice: { brand: 'Quick question' },
};

/** Mount once, inside the app shell. Shows one pop-up at a time, in order. */
export function AskHost() {
  const [queue, setQueue] = useState<Request[]>([]);

  useEffect(() => {
    enqueue = (r) => setQueue((q) => [...q, r]);
    return () => { enqueue = null; };
  }, []);

  const current = queue[0];
  if (!current) return null;
  return <AskCard key={queueKey(current)} req={current} onDone={() => setQueue((q) => q.slice(1))} />;
}

const keys = new WeakMap<Request, number>();
let seq = 0;
function queueKey(r: Request): number {
  if (!keys.has(r)) keys.set(r, ++seq);
  return keys.get(r)!;
}

function AskCard({ req, onDone }: { req: Request; onDone: () => void }) {
  const locale = useLocale();
  const t = (s: string) => translateLabel(s, locale);

  const tone: PopupTone = req.opts.tone ?? (req.kind === 'tell' ? 'info' : 'brand');
  const title = req.opts.title ?? DEFAULT_TITLE[req.kind][tone] ?? DEFAULT_TITLE[req.kind].brand;

  const [value, setValue] = useState(req.kind === 'text' ? req.opts.defaultValue ?? '' : '');
  const [problem, setProblem] = useState<string | null>(null);

  // Settle the promise exactly once, then hand over to the next pop-up.
  const settled = useRef(false);
  function finish(answer: 'ok' | 'cancel' | 'yes' | 'no') {
    if (settled.current) return;
    if (req.kind === 'text' && answer === 'ok') {
      const v = value.trim();
      if (req.opts.required && !v) { setProblem(t('Please fill this in to carry on.')); return; }
      const why = req.opts.validate?.(v) ?? null;
      if (why) { setProblem(why); return; }
    }
    settled.current = true;
    switch (req.kind) {
      case 'confirm': req.resolve(answer === 'ok'); break;
      case 'tell': req.resolve(); break;
      case 'text': req.resolve(answer === 'ok' ? value.trim() : null); break;
      case 'choice': req.resolve(answer === 'yes' ? 'yes' : answer === 'no' ? 'no' : null); break;
    }
    onDone();
  }

  // A risky action starts on Cancel, so a stray Enter never deletes anything.
  const safeFirst = tone === 'danger';

  return (
    <PopupCard
      tone={tone}
      icon={req.opts.icon}
      title={t(title)}
      message={req.opts.message}
      // A half-typed reason is not thrown away by a stray click on the page.
      onDismiss={req.kind === 'text' && value.trim() ? undefined : () => finish(req.kind === 'tell' ? 'ok' : 'cancel')}
      onSubmit={() => finish(req.kind === 'choice' ? 'yes' : 'ok')}
      footer={
        <>
          {req.kind === 'tell' && (
            <button type="submit" autoFocus className={popupButton.primary(tone)}>{t(req.opts.okLabel ?? 'OK, got it')}</button>
          )}
          {(req.kind === 'confirm' || req.kind === 'text') && (
            <>
              <button type="button" autoFocus={safeFirst && req.kind === 'confirm'} onClick={() => finish('cancel')} className={popupButton.secondary}>
                {t(req.opts.cancelLabel ?? 'Cancel')}
              </button>
              <button type="submit" autoFocus={!safeFirst && req.kind === 'confirm'} className={popupButton.primary(tone)}>
                {t(req.opts.confirmLabel ?? (req.kind === 'text' ? 'Save' : 'Yes, go ahead'))}
              </button>
            </>
          )}
          {req.kind === 'choice' && (
            <>
              <button type="button" onClick={() => finish('cancel')} className={`${popupButton.quiet} sm:me-auto`}>
                {t(req.opts.cancelLabel ?? 'Not now')}
              </button>
              <button type="button" onClick={() => finish('no')} className={popupButton.secondary}>{req.opts.noLabel}</button>
              <button type="submit" autoFocus className={popupButton.primary(tone)}>{req.opts.yesLabel}</button>
            </>
          )}
        </>
      }
    >
      {req.kind === 'text' && (
        <label className="mt-4 block">
          {req.opts.label && <span className="field-label">{req.opts.label}</span>}
          {req.opts.multiline ? (
            <textarea
              autoFocus
              rows={3}
              value={value}
              placeholder={req.opts.placeholder}
              aria-invalid={!!problem}
              onChange={(e) => { setValue(e.target.value); setProblem(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish('ok'); } }}
              className="field-input resize-y"
            />
          ) : (
            <input
              autoFocus
              value={value}
              inputMode={req.opts.inputMode}
              placeholder={req.opts.placeholder}
              aria-invalid={!!problem}
              onChange={(e) => { setValue(e.target.value); setProblem(null); }}
              onFocus={(e) => e.currentTarget.select()}
              className="field-input"
            />
          )}
          {problem && (
            <span role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-danger">
              <Icon name="alert-circle" className="h-3.5 w-3.5 shrink-0" />{problem}
            </span>
          )}
        </label>
      )}
    </PopupCard>
  );
}
