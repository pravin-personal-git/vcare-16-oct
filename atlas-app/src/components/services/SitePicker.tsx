'use client';

import { useEffect, useState } from 'react';
import { addJobSiteAction, loadCustomerSitesAction } from '@/app/(app)/services/actions';

type Site = Awaited<ReturnType<typeof loadCustomerSitesAction>>[number];
/** What was chosen: a saved site, "another place" (typed words), or nothing yet. */
export type SiteChoice = { siteId: string | null; otherPlace: boolean; text: string };

const field = 'h-9 w-full rounded-lg border border-border bg-background px-2.5 text-sm';

/**
 * WHERE THE JOB GOES (30 Oct 2026, Vcare): the customer's saved sites - every
 * active one, pinned or not - or "Another place", or "+ New site" saved to the
 * customer. One site is chosen for you; several, and the office must choose,
 * so a job never lands on the customer's main address by accident. The server
 * (server/sites jobSite) checks the same rule.
 */
export function SitePicker({ id, customerId, value, onChange }: {
  id: string; customerId: string | null; value: SiteChoice; onChange: (v: SiteChoice) => void;
}) {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [adding, setAdding] = useState<{ name: string; address: string; mapLink: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerId) return;
    let live = true;
    void loadCustomerSitesAction(customerId).then((r) => {
      if (!live) return;
      setSites(r);
      // One site: that is where it goes. None: the typed words are the place.
      if (r.length === 1 && !value.siteId && !value.otherPlace) onChange({ ...value, siteId: r[0].id });
      if (r.length === 0 && !value.otherPlace) onChange({ ...value, siteId: null, otherPlace: true });
    });
    return () => { live = false; };
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!customerId) return <p className="text-xs text-muted-foreground">Choose the customer first.</p>;
  if (!sites) return <p className="text-xs text-muted-foreground">Loading their sites…</p>;

  const sel = value.otherPlace ? '__other' : value.siteId ?? '';
  return (
    <div className="grid gap-1.5">
      {sites.length > 0 && (
        <select id={id} aria-label="Site" className={field} value={sel}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__new') { setAdding({ name: '', address: '', mapLink: '' }); return; }
            onChange(v === '__other' ? { ...value, siteId: null, otherPlace: true } : { ...value, siteId: v || null, otherPlace: false });
          }}>
          {sites.length > 1 && <option value="">Choose the site…</option>}
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.address ? ` - ${s.address}` : ''}{s.latitude === null ? ' (no pin)' : ''}</option>)}
          <option value="__other">Another place (type it below)</option>
          <option value="__new">+ New site for this customer</option>
        </select>
      )}
      {sites.length > 1 && !value.siteId && !value.otherPlace && <p className="text-xs text-warning">This customer has {sites.length} sites - choose where the job is.</p>}
      {(value.otherPlace || value.siteId) && (
        <input aria-label={value.otherPlace ? 'Address' : 'Site details'} className={field} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })}
          placeholder={value.otherPlace ? 'Address of the place' : 'Gate, floor, room… (optional)'} />
      )}
      {sites.length === 0 && !adding && (
        <button type="button" className="justify-self-start text-xs font-medium text-brand hover:underline" onClick={() => setAdding({ name: '', address: '', mapLink: '' })}>+ Save this as a site of the customer</button>
      )}
      {adding && (
        <div className="grid gap-2 rounded-lg border border-border p-2.5">
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <input aria-label="Site name" className={field} placeholder="Site name, e.g. Factory, Godown 2" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} autoFocus />
          <input aria-label="Site address" className={field} placeholder="Address" value={adding.address || value.text} onChange={(e) => setAdding({ ...adding, address: e.target.value })} />
          <input aria-label="Google Maps link" className={field} placeholder="Google Maps link (optional - gives the pin)" value={adding.mapLink} onChange={(e) => setAdding({ ...adding, mapLink: e.target.value })} />
          <div className="flex justify-end gap-2">
            <button type="button" className="h-8 rounded-lg border border-border px-3 text-xs" onClick={() => { setAdding(null); setError(null); }}>Cancel</button>
            <button type="button" disabled={busy} className="h-8 rounded-lg bg-brand px-3 text-xs font-medium text-brand-fg disabled:opacity-50" onClick={async () => {
              setBusy(true); setError(null);
              const r = await addJobSiteAction(customerId, { name: adding.name, address: adding.address || value.text || null, mapLink: adding.mapLink || null });
              setBusy(false);
              if (r.error || !r.site) { setError(r.error ?? 'Could not save the site.'); return; }
              setSites((s) => [...(s ?? []), r.site!]); setAdding(null);
              onChange({ siteId: r.site.id, otherPlace: false, text: '' });
            }}>{busy ? 'Saving…' : 'Save site'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
