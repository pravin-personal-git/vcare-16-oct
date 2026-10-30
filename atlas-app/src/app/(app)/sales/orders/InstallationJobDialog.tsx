'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Layout';
import { LocationCapture, type CapturedLocation } from '@/components/ui/LocationCapture';
import { createInstallationJobAction, loadInstallationSetupAction } from '../../services/actions';
import type { InstallationSetup } from '@/server/installation-jobs';

/**
 * Sales order -> installation challan (G-21, 10 Oct 2026; was a complaint).
 * Pick the customer's saved site or capture the location, set the priority,
 * and the challan opens with the order's lines - the work slip the technician
 * fits from, found under Installations and in Schedule a visit.
 */
export function InstallationJobDialog({ salesOrderId, onClose }: { salesOrderId: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [setup, setSetup] = useState<InstallationSetup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [siteId, setSiteId] = useState('');
  const [location, setLocation] = useState<CapturedLocation | null>(null);
  const [siteNote, setSiteNote] = useState('');
  const [priority, setPriority] = useState('normal');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    void loadInstallationSetupAction(salesOrderId).then((r) => {
      if (r.error || !r.setup) { setError(r.error ?? 'Could not load the order.'); return; }
      setSetup(r.setup);
      setLines(r.setup.items.filter((i) => !i.coveredBy && i.qty > 0).map((i) => i.id));
      if (r.setup.sites.length === 1) setSiteId(r.setup.sites[0].id);
    });
  }, [salesOrderId]);

  // The pin follows the complaint Field rule (5 Oct 2026); switched off, the
  // technician captures it on arrival.
  const free = setup ? setup.items.filter((i) => !i.coveredBy && i.qty > 0) : [];
  // '' = not chosen yet, '__other' = another place (30 Oct 2026: '' used to mean "another place",
  // so a customer with several sites got the order's address unless someone changed the box).
  const picked = setup?.sites.find((s) => s.id === siteId);
  const chosen = !!picked || siteId === '__other' || (setup?.sites.length ?? 0) === 0;
  const needPin = !picked || picked.lat === null;
  const ready = !!setup && !setup.openJob && lines.length > 0 && chosen && (!setup.locationRequired || !needPin || !!location);
  const create = () => start(async () => {
    setError(null);
    const r = await createInstallationJobAction(salesOrderId, { siteId: picked?.id ?? null, location: needPin ? location : null, siteNote: siteNote.trim() || null, priority, note: note.trim() || null, lineIds: lines });
    if (r.error || !r.href) { setError(r.error ?? 'Could not create the installation.'); return; }
    router.push(r.href);
  });

  return (
    <Modal title={setup && setup.installations.length ? 'Installations for this order' : 'Create installation job'} icon="map-pin" size="lg" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button>{(!setup || free.length > 0) && <Button variant="primary" loading={pending} disabled={!ready} onClick={create}>{setup?.installations.length ? 'Create another installation' : 'Create installation challan'}</Button>}</>}>
      {!setup && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
      {setup && (
        <div className="grid gap-3">
          <p className="text-sm"><strong>{setup.orderNo}</strong> · {setup.customerName}</p>
          {setup.installations.length > 0 && (
            <div className="rounded-sm bg-brand/5 px-3 py-2 text-sm ring-1 ring-brand/20">
              <p className="text-xs font-semibold text-muted-foreground">Already made for this order</p>
              {setup.installations.map((x) => <a key={x.id} href={x.href} className="me-3 font-mono text-brand hover:underline">{x.number}</a>)}
            </div>
          )}
          {!setup.openJob && (
            <div>
              <p className="mb-1 text-xs font-medium">Lines on this installation</p>
              <div className="grid gap-1">
                {setup.items.map((i) => (
                  <label key={i.id} className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm ${i.coveredBy ? 'text-muted-foreground' : 'cursor-pointer hover:bg-muted'}`}>
                    <input type="checkbox" disabled={!!i.coveredBy || i.qty <= 0} checked={lines.includes(i.id)}
                      onChange={() => setLines((x) => (x.includes(i.id) ? x.filter((y) => y !== i.id) : [...x, i.id]))} className="h-4 w-4 accent-brand" />
                    <span className="flex-1">{i.productName} × {i.qty}</span>
                    {i.coveredBy && <span className="text-xs">on {i.coveredBy.number}</span>}
                  </label>
                ))}
              </div>
              {free.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Every line is already on an installation - open it above.</p>}
            </div>
          )}
          {setup.openJob ? (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm">
              An installation is already open for this order: <a className="font-medium text-brand hover:underline" href={setup.openJob.href}>{setup.openJob.number}</a>
            </p>
          ) : (
            <>
              {setup.sites.length > 0 && (
                <Field label="Customer's site" htmlFor="ij-site">
                  <select id="ij-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} className="field-input">
                    {setup.sites.length > 1 && <option value="">Choose the site…</option>}
                    {setup.sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.address ? ` - ${s.address}` : ''}{s.lat === null ? ' (no pin)' : ''}</option>)}
                    <option value="__other">Another place - capture the location below</option>
                  </select>
                </Field>
              )}
              {setup.sites.length > 1 && !chosen && <p className="text-xs text-warning">This customer has {setup.sites.length} sites - choose where it is fitted.</p>}
              {chosen && needPin && (
                <div className="grid gap-1">
                  <p className="text-xs font-medium">Installation location{setup.locationRequired ? '' : ' (optional)'}</p>
                  <LocationCapture value={location} onChange={setLocation} required={setup.locationRequired}
                    requiredText="Required for the technician's on-site check." />
                </div>
              )}
              <Field label="Site details (gate, floor…)" htmlFor="ij-sitenote">
                <input id="ij-sitenote" value={siteNote} onChange={(e) => setSiteNote(e.target.value)} className="field-input" />
              </Field>
              <Field label="Priority" htmlFor="ij-priority">
                <select id="ij-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="field-input">
                  <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
                </select>
              </Field>
              <Field label="Note for the technician" htmlFor="ij-note">
                <textarea id="ij-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="field-input" />
              </Field>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
