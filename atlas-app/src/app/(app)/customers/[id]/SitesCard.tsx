'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { SectionCard, Badge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import type { SiteRow } from '@/server/sites';
import { saveSiteAction, setSiteActiveAction } from './site-actions';

const field = 'h-9 w-full rounded border border-border bg-card px-2.5 text-sm outline-none focus:border-brand';
const label = 'mb-1 block text-micro font-semibold uppercase tracking-wide text-muted-foreground';

/**
 * A customer's named sites - "Head office", "Bhilai godown" - each with its
 * own contact and map pin. A complaint can then be raised against the site,
 * so the technician goes to the right building without anyone retyping it.
 */
export function SitesCard({ partyId, sites, canEdit }: { partyId: string; sites: SiteRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SiteRow | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (s: SiteRow) => {
    const r = await setSiteActiveAction(partyId, s.id, !s.isActive);
    if (r.error) setError(r.error); else router.refresh();
  };

  return (
    <SectionCard
      title={`Sites (${sites.filter((s) => s.isActive).length})`}
      icon="map-pin"
      className="mt-4"
      bodyClassName="p-0"
      action={canEdit ? <Button size="sm" variant="outline" icon="plus" onClick={() => setEditing('new')}>Add site</Button> : undefined}
    >
      {error && <p className="px-4 py-2 text-xs text-danger">{error}</p>}
      {sites.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          No named sites. Add one for each place you serve this customer at, so complaints can point at the right building.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {sites.map((s) => (
            <li key={s.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm ${s.isActive ? '' : 'opacity-50'}`}>
              <span className="font-medium">{s.name}</span>
              {s.contactName && <span className="text-xs text-muted-foreground">{s.contactName}</span>}
              {s.contactPhone && <span className="font-mono text-xs text-muted-foreground">{s.contactPhone}</span>}
              {s.address && <span className="text-xs text-muted-foreground">{s.address}</span>}
              {s.mapLink && (
                <a href={s.mapLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
                  <Icon name="map-pin" className="h-3 w-3" />{s.latitude !== null ? 'Map' : 'Map link'}
                </a>
              )}
              {s.complaintCount > 0 && <Badge tone="info">{s.complaintCount} complaint{s.complaintCount === 1 ? '' : 's'}</Badge>}
              {!s.isActive && <Badge>Retired</Badge>}
              {canEdit && (
                <span className="ms-auto flex gap-1">
                  <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditing(s)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(s)}>{s.isActive ? 'Retire' : 'Restore'}</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <SiteDialog partyId={partyId} site={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onDone={() => { setEditing(null); router.refresh(); }} />
      )}
    </SectionCard>
  );
}

function SiteDialog({ partyId, site, onClose, onDone }: { partyId: string; site: SiteRow | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({
    name: site?.name ?? '', contactName: site?.contactName ?? '', contactPhone: site?.contactPhone ?? '',
    address: site?.address ?? '', mapLink: site?.mapLink ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    const r = await saveSiteAction(partyId, v, site?.id ?? null);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    onDone();
  }

  return (
    <Modal title={site ? `Edit ${site.name}` : 'Add a site'} icon="map-pin" size="md" onClose={onClose}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={submit} loading={busy} icon="check">Save site</Button></div>}>
      {error && <p className="mb-3 rounded border border-danger/30 bg-danger/[0.06] px-3 py-2 text-xs text-on-tint-danger">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label htmlFor="sitescar-f97" className={label}>Site name *</label><input id="sitescar-f97" className={field} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Head office, Godown, Branch name…" /></div>
        <div><label htmlFor="sitescar-f98" className={label}>Contact person</label><input id="sitescar-f98" className={field} value={v.contactName} onChange={(e) => setV({ ...v, contactName: e.target.value })} /></div>
        <div><label htmlFor="sitescar-f99" className={label}>Contact number</label><input id="sitescar-f99" className={field} value={v.contactPhone} onChange={(e) => setV({ ...v, contactPhone: e.target.value })} inputMode="tel" /></div>
        <div className="sm:col-span-2"><label htmlFor="sitescar-f100" className={label}>Address</label><input id="sitescar-f100" className={field} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></div>
        <div className="sm:col-span-2">
          <label htmlFor="sitescar-f102" className={label}>Google Maps link</label>
          <input id="sitescar-f102" className={field} value={v.mapLink} onChange={(e) => setV({ ...v, mapLink: e.target.value })} placeholder="https://www.google.com/maps?q=…" />
          <p className="mt-1 text-xs text-muted-foreground">The pin is read from the link when it carries coordinates. Short links still open, but carry no pin.</p>
        </div>
      </div>
    </Modal>
  );
}
