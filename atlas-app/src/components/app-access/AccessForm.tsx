'use client';

import { ACCESS_KEYS, type AccessKey, type AccessSettings, type ResolvedAccess } from '@/lib/app-access';
import { LayoutPreview } from './LayoutPreview';

/**
 * The Phone app switches, grouped the way the phone is laid out (26 Sep 2026).
 *
 * Role mode: every switch has a value. Person mode: each one can be left
 * "Same as role" (the key is simply absent from the override) or set.
 * A switch the website permissions do not allow is greyed with the reason -
 * the app setting only narrows (PHONE-APP-ACCESS-SPEC.md).
 */
const SECTIONS = ['attendance', 'complaints', 'stock', 'leads', 'tasks'];

const PERM_LABEL: Record<string, string> = {
  'complaints.view': 'Complaints: view', 'complaints.edit': 'Complaints: edit',
  'leads.view': 'Leads: view', 'leads.edit': 'Leads: edit', 'leads.create': 'Leads: create',
  'stock.view': 'Stock: view', 'purchase.view': 'Purchase: view', 'purchase.edit': 'Purchase: edit',
};

export function AccessForm({ mode, values, onChange, permissions, base, disabled }: {
  mode: 'role' | 'user';
  /** Role: the full settings. Person: only the keys that differ. */
  values: AccessSettings;
  onChange: (next: AccessSettings) => void;
  permissions: string[];
  /** Person mode: what the roles give, for "Same as role (...)". */
  base?: AccessSettings;
  disabled?: boolean;
}) {
  const perms = new Set(permissions);
  const blockedBy = (k: AccessKey) => (k.needs && !k.needs.some((p) => perms.has(p))
    ? `Needs ${k.needs.map((p) => PERM_LABEL[p] ?? p).join(' or ')} on the website`
    : null);
  const current = (k: AccessKey) => (values[k.key] !== undefined ? values[k.key] : base?.[k.key] ?? k.default);
  const set = (key: string, v: string | boolean | undefined) => {
    const next = { ...values };
    if (v === undefined) delete next[key];
    else next[key] = v;
    onChange(next);
  };
  const keys = (group: AccessKey['group'], section?: string) =>
    ACCESS_KEYS.filter((k) => k.group === group && (section === undefined || k.section === section));

  const row = (k: AccessKey, indent?: boolean) => {
    const why = blockedBy(k);
    const sectionOff = k.section ? current(ACCESS_KEYS.find((x) => x.key === `section.${k.section}`)!) !== true : false;
    const off = disabled || !!why;
    const label = (v: string | boolean) => (typeof v === 'boolean'
      ? (k.group === 'hide' ? (v ? 'Hidden' : 'Shown') : v ? 'On' : 'Off')
      : k.choices?.find((c) => c.value === v)?.label ?? String(v));
    const id = `acc-${k.key}`;

    return (
      <div key={k.key} className={`flex flex-wrap items-start gap-x-3 gap-y-1 py-2 ${indent ? 'ps-6' : ''} ${why || sectionOff ? 'opacity-55' : ''}`}>
        <div className="min-w-0 flex-1">
          <label htmlFor={id} className="block text-sm font-medium">{k.label}</label>
          <p className="text-xs text-muted-foreground">{why ?? (sectionOff ? 'The section is off.' : k.hint)}</p>
        </div>
        {mode === 'role' && k.kind === 'bool' ? (
          <input id={id} type="checkbox" className="mt-1 h-4 w-4" disabled={off}
            checked={current(k) === true && !why} onChange={(e) => set(k.key, e.target.checked)} />
        ) : (
          <select
            id={id} disabled={off}
            value={mode === 'user' && values[k.key] === undefined ? '__role' : String(current(k))}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__role') set(k.key, undefined);
              else set(k.key, k.kind === 'bool' ? v === 'true' : v);
            }}
            className="h-8 min-w-[10rem] rounded-lg border border-border bg-card px-2 text-xs outline-none focus:border-brand"
          >
            {mode === 'user' && <option value="__role">Same as role ({label(base?.[k.key] ?? k.default)})</option>}
            {k.kind === 'bool'
              ? [true, false].map((b) => <option key={String(b)} value={String(b)}>{label(b)}</option>)
              : k.choices!.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        )}
      </div>
    );
  };

  const group = (title: string, children: React.ReactNode) => (
    <section className="rounded-lg border border-border">
      <h3 className="border-b border-border bg-muted/30 px-3 py-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="divide-y divide-border px-3">{children}</div>
    </section>
  );

  // Layout (13 Oct 2026): the preset first; its switches only matter for Simple.
  const layoutKeys = keys('layout');
  const simple = String(current(layoutKeys[0]!)) === 'simple';
  const value = (key: string) => current(ACCESS_KEYS.find((x) => x.key === key)!);

  return (
    <div className="grid gap-3">
      {group('App home', keys('home').map((k) => row(k)))}
      <section className="rounded-lg border border-border">
        <h3 className="border-b border-border bg-muted/30 px-3 py-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Layout - how the phone looks</h3>
        <div className="grid gap-3 p-3 md:grid-cols-[1fr_auto]">
          <div className="divide-y divide-border">
            {row(layoutKeys[0]!)}
            {simple
              ? layoutKeys.slice(1).map((k) => row(k, true))
              : <p className="py-2 text-xs text-muted-foreground">Choose Simple to set the filters, job screen, language and text size. Vcare 1.0.19 or later.</p>}
          </div>
          <LayoutPreview get={value} />
        </div>
      </section>
      {group('Sections and what they can do there', SECTIONS.map((s) => (
        <div key={s}>
          {keys('sections').filter((k) => k.key === `section.${s}`).map((k) => row(k))}
          {keys('scope', s).map((k) => row(k, true))}
          {keys('actions', s).map((k) => row(k, true))}
        </div>
      )))}
      {group('On the website too', ACCESS_KEYS.filter((k) => k.group === 'scope' && !k.section).map((k) => row(k)))}
      {group('Hide details', keys('hide').map((k) => row(k)))}
      {group('Tracking', keys('tracking').map((k) => row(k)))}
      {group('Clock-in places', keys('clockin').map((k) => row(k)))}
    </div>
  );
}

/** "What <name> sees on the phone" - the combined result, in plain lines. */
export function WhatTheySee({ name, r }: { name: string; r: ResolvedAccess }) {
  const on = (Object.entries(r.sections) as [string, boolean][]).filter(([, v]) => v).map(([k]) => k[0].toUpperCase() + k.slice(1));
  const scopeText = { mine: 'only theirs', mine_unassigned: 'theirs + unassigned', team: 'theirs, their team + unassigned', branch: 'whole branch' };
  const hidden = [
    r.hide.prices && 'prices', r.hide.purchaseRate && 'purchase rate', r.hide.customerPhone && 'customer phone numbers',
    r.hide.customerAddress && 'customer addresses',
  ].filter(Boolean);
  const lines = r.home === 'website'
    ? [r.isOwner ? 'The full website (owner - always).' : 'The full website, inside the app.']
    : [
      `Home: ${on.length ? on.join(', ') : 'nothing but the sign-out button'}.`,
      r.sections.complaints && `Complaints: ${scopeText[r.scope.complaints]}.`,
      r.sections.leads && `Leads: ${scopeText[r.scope.leads]}.`,
      r.sections.tasks && `Tasks: ${scopeText[r.scope.tasks]}.`,
      r.scope.sales !== 'branch' && `Quotations, orders and invoices: ${scopeText[r.scope.sales]}.`,
      r.scope.people !== 'branch' && `Attendance and leave: ${r.scope.people === 'team' ? 'theirs and their team' : 'only theirs'}.`,
    ].filter((x): x is string => !!x);
  lines.push(hidden.length ? `Hidden: ${hidden.join(', ')}.` : 'Nothing hidden.');
  lines.push(`Clock in from the app: ${r.tracking.clockIn ? 'yes' : 'no'} · Location tracking: ${r.tracking.location ? 'on' : 'off'} · Call-log sync: ${r.tracking.callLog ? 'on' : 'off'}.`);
  return (
    <div className="rounded-lg border border-brand/30 bg-brand/5 p-3">
      <p className="mb-1 text-xs font-semibold">What {name} sees on the phone</p>
      <ul className="list-disc space-y-0.5 ps-5 text-xs">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </div>
  );
}
