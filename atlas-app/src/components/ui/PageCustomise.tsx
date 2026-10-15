'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './Button';
import { Icon } from './Icon';
import { StatusBadge } from './Layout';
import {
  PALETTE, paletteVar, type CustomiseScope, type PageCustomisation, type PaletteKey,
} from '@/lib/page-customise';
import { resetCustomisationAction, saveCustomisationAction } from '@/app/actions/ui-customisation';
import { ask } from '@/components/ui/ask';

/**
 * THE PAGE-CUSTOMISE LAYER (11 Oct 2026, ops-pages demo tab 7).
 *
 * `useCustomise` holds the draft while an admin is in customise mode; the
 * `CustomiseButton` and `CustomiseBar` sit in the page header; `StageChip`
 * is any colour-able value (click it in customise mode to pick a colour).
 * Everyone else sees the saved result and never the button.
 */
export interface CustomiseProps {
  page: string;
  initial: PageCustomisation;
  from: CustomiseScope | 'default';
  canCustomise: boolean;
  roles: { id: string; name: string }[];
}

export function useCustomise(p: CustomiseProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PageCustomisation>(p.initial);
  // What was just saved, shown until the refreshed page brings it back as `initial`.
  const [saved, setSaved] = useState<PageCustomisation | null>(null);
  useEffect(() => { setSaved(null); }, [p.initial]);
  const current = saved ?? p.initial;
  return {
    ...p,
    editing,
    /** What the page draws: the draft while editing, the saved layout otherwise. */
    value: editing ? draft : current,
    draft,
    setDraft,
    start: () => { setDraft(current); setEditing(true); },
    stop: () => setEditing(false),
    /** After a save: show the draft as the layout and leave customise mode. */
    keep: () => { setSaved(draft); setEditing(false); },
    /** After a reset: back to the server's answer once the page refreshes. */
    forget: () => { setSaved(null); setEditing(false); },
  };
}
export type Customise = ReturnType<typeof useCustomise>;

export function CustomiseButton({ c }: { c: Customise }) {
  if (!c.canCustomise) return null;
  return (
    <Button size="sm" variant={c.editing ? 'primary' : 'soft'} icon="palette" iconTone={c.editing ? undefined : 'brand'}
      onClick={c.editing ? c.stop : c.start}>
      {c.editing ? 'Done' : 'Customise page'}
    </Button>
  );
}

export function CustomiseBar({ c, hint = 'Click a stage to colour it.', children }: { c: Customise; hint?: string; children?: React.ReactNode }) {
  const router = useRouter();
  const [scope, setScope] = useState<string>('everyone');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (!c.editing) return null;

  const parse = () => (scope.startsWith('role:') ? { s: 'role' as const, roleId: scope.slice(5) } : { s: scope as CustomiseScope, roleId: null });
  const label = () => {
    const { s, roleId } = parse();
    return s === 'everyone' ? 'everyone' : s === 'user' ? 'you only' : `the ${c.roles.find((r) => r.id === roleId)?.name ?? ''} role`;
  };
  const save = () => start(async () => {
    const { s, roleId } = parse();
    const r = await saveCustomisationAction(c.page, s, roleId, c.draft);
    if (r.error) { setMsg(r.error); return; }
    setMsg(null);
    c.keep();
    router.refresh();
  });
  const reset = async () => {
    if (!(await ask.confirm({
      icon: 'rotate-ccw',
      title: 'Reset this layout?',
      message: `The layout saved for ${label()} is removed, and the page goes back to the one set above it.`,
      confirmLabel: 'Reset layout',
    }))) return;
    doReset();
  };
  const doReset = () => start(async () => {
    const { s, roleId } = parse();
    const r = await resetCustomisationAction(c.page, s, roleId);
    if (r.error) { setMsg(r.error); return; }
    c.forget();
    router.refresh();
  });
  const days = c.draft.overdueDays;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-sm bg-brand/5 p-3 text-sm ring-1 ring-brand/20">
      <Icon name="palette" className="h-4 w-4 text-brand" />
      <span>{hint}</span>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={days !== null} onChange={(e) => c.setDraft({ ...c.draft, overdueDays: e.target.checked ? 7 : null })} className="h-4 w-4 accent-brand" />
        Rule: open more than
        <input type="number" min={1} max={365} disabled={days === null} value={days ?? 7} aria-label="Days"
          onChange={(e) => c.setDraft({ ...c.draft, overdueDays: Math.max(1, Number(e.target.value) || 1) })}
          className="w-14 rounded-sm border border-border bg-card px-1.5 py-0.5 text-sm disabled:opacity-50" />
        days → red
      </label>
      {children}
      <span className="ms-auto flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Now showing: {c.from === 'default' ? 'standard layout' : c.from === 'user' ? 'your own' : c.from === 'role' ? 'a role layout' : 'everyone’s'}</span>
        Save for
        <select value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Save for" className="rounded-full border border-border bg-card px-2 py-1 text-xs">
          <option value="everyone">Everyone</option>
          {c.roles.map((r) => <option key={r.id} value={`role:${r.id}`}>{r.name} role</option>)}
          <option value="user">Only me</option>
        </select>
        <Button size="sm" variant="ghost" icon="rotate-ccw" disabled={pending} onClick={reset}>Reset</Button>
        <Button size="sm" variant="primary" icon="check" loading={pending} onClick={save}>Save</Button>
      </span>
      {msg && <p role="alert" className="w-full text-xs text-danger">{msg}</p>}
    </div>
  );
}

/**
 * A status in the colour an admin gave it, or the standard status badge when
 * none was set - for lists that show the colours but are not where they are
 * chosen (the Complaints Tracker follows the Jobs Dashboard).
 */
export function ColoredStatus({ colors, status, label }: { colors: Record<string, PaletteKey>; status: string; label?: string }) {
  const key = colors[status];
  if (!key) return <StatusBadge status={status} label={label} />;
  const color = paletteVar(key);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
      <i className="h-2 w-2 rounded-full" style={{ background: color }} />{label ?? status}
    </span>
  );
}

/** A status value in its colour. In customise mode it opens the sixteen-colour palette. */
export function StageChip({ c, value, label }: { c: Customise; value: string; label: string }) {
  const [open, setOpen] = useState(false);
  const key = c.value.colors[value];
  const color = key ? paletteVar(key) : null;
  const pick = (k: PaletteKey) => { c.setDraft({ ...c.draft, colors: { ...c.draft.colors, [value]: k } }); setOpen(false); };
  const chip = (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={color ? { background: `color-mix(in srgb, ${color} 12%, transparent)`, color } : undefined}>
      <i className="h-2 w-2 rounded-full" style={{ background: color ?? 'hsl(var(--muted-foreground))' }} />
      <span className={color ? '' : 'text-muted-foreground'}>{label}</span>
    </span>
  );
  if (!c.editing) return chip;
  return (
    <span className="relative inline-block">
      <button type="button" onClick={() => setOpen(!open)} aria-label={`Colour of ${label}`} className="rounded-full ring-2 ring-brand/40 ring-offset-1">{chip}</button>
      {open && (
        <span role="menu" className="absolute start-0 top-8 z-20 grid w-max grid-cols-8 gap-1.5 rounded-md border border-border bg-card p-2 shadow-raised">
          {PALETTE.map((k) => (
            <button key={k} type="button" role="menuitem" aria-label={k} onClick={() => pick(k)}
              className="h-6 w-6 rounded-full ring-2 ring-card transition hover:scale-110" style={{ background: paletteVar(k) }} />
          ))}
        </span>
      )}
    </span>
  );
}
