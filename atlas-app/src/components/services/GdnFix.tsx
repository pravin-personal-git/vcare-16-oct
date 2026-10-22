'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Layout';
import {
  cancelJobIssueAction, correctJobIssueAction, issueJobChallanAction, receiveReturnedPartsAction, serialChoicesAction,
  swapIssuedUnitAction, unitsOnShelfAction,
} from '@/app/(app)/services/actions';
import { installReceiveReturnAction } from '@/app/(app)/services/installations/actions';

export interface GdnFixLine {
  id: string; productName: string; qtyIssued: number; qtyReturned: number; qtyReturnPending: number;
  /** Serial-number product, and its units still out on the job. */
  serial?: boolean; units?: { id: string; serialNo: string }[];
}

/** Tick exactly `need` serial numbers. */
function SerialChecks({ units, need, value, onChange }: { units: { id: string; serialNo: string }[]; need: number; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid max-h-48 gap-1 overflow-y-auto rounded border border-border p-2">
      {units.length === 0 && <p className="text-xs text-danger">No serial numbers available.</p>}
      {units.map((u) => {
        const on = value.includes(u.id);
        return (
          <label key={u.id} className="flex items-center gap-2 font-mono text-xs">
            <input type="checkbox" checked={on} disabled={!on && value.length >= need}
              onChange={() => onChange(on ? value.filter((x) => x !== u.id) : [...value, u.id])} />
            {u.serialNo}
          </label>
        );
      })}
      <p className="text-xs text-muted-foreground">{value.length} of {need} picked</p>
    </div>
  );
}

/**
 * The store fixes an issued GDN (28 Sep 2026) - lower a quantity that was not
 * really handed over (for serial items: tick the units that came back), or
 * cancel the GDN made by mistake. Stock and cost are reversed at the issue
 * cost; the reason is kept on the job. Stock: Edit only (checked again on the
 * server).
 */
export function GdnFix({ challanId, gdnNo, lines }: { challanId: string; gdnNo: string; lines: GdnFixLine[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | 'correct' | 'cancel'>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [back, setBack] = useState<Record<string, string[]>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canCancel = lines.every((l) => l.qtyReturned === 0 && l.qtyReturnPending === 0);

  const open = (m: 'correct' | 'cancel') => {
    setQty(Object.fromEntries(lines.map((l) => [l.id, l.qtyIssued])));
    setBack({}); setReason(''); setError(null); setMode(m);
  };
  const save = () => start(async () => {
    setError(null);
    const changes = lines.flatMap((l) => {
      if (l.serial) {
        const ids = back[l.id] ?? [];
        return ids.length ? [{ lineId: l.id, qty: l.qtyIssued - ids.length, unitIds: ids }] : [];
      }
      const q = qty[l.id] ?? l.qtyIssued;
      return q !== l.qtyIssued ? [{ lineId: l.id, qty: q }] : [];
    });
    const r = mode === 'cancel' ? await cancelJobIssueAction(challanId, reason) : await correctJobIssueAction(challanId, changes, reason);
    if (r.error) { setError(r.error); return; }
    setMode(null);
    router.refresh();
  });

  return (
    <>
      <span className="inline-flex flex-wrap gap-2">
        <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => open('correct')}>Correct {gdnNo}</button>
        {canCancel && <button type="button" className="text-xs font-medium text-danger hover:underline" onClick={() => open('cancel')}>Cancel {gdnNo}</button>}
      </span>
      {mode && (
        <Modal title={mode === 'cancel' ? `Cancel ${gdnNo}` : `Correct ${gdnNo}`} icon="truck" onClose={() => setMode(null)}
          footer={<><Button onClick={() => setMode(null)}>Back</Button><Button variant={mode === 'cancel' ? 'danger' : 'primary'} loading={pending} disabled={!reason.trim()} onClick={save}>{mode === 'cancel' ? 'Cancel the GDN' : 'Save correction'}</Button></>}>
          <div className="grid gap-3">
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            {mode === 'cancel' ? (
              <p className="text-sm">Every part on {gdnNo} goes back into stock (the same serial numbers) and its cost is reversed. The challan goes back to <em>Parts counter</em>.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Enter what was really handed over. The difference goes back into stock. To give more, raise a new challan.</p>
                {lines.map((l) => l.serial ? (
                  <div key={l.id} className="grid gap-1 text-sm">
                    <span>{l.productName} <span className="text-muted-foreground">- tick the units NOT handed over</span></span>
                    <SerialChecks units={l.units ?? []} need={Math.max(0, l.qtyIssued - l.qtyReturned - l.qtyReturnPending)} value={back[l.id] ?? []} onChange={(v) => setBack({ ...back, [l.id]: v })} />
                  </div>
                ) : (
                  <div key={l.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 flex-1">{l.productName} <span className="text-muted-foreground">(issued {l.qtyIssued})</span></span>
                    <input aria-label={`Handed over: ${l.productName}`} type="number" min={l.qtyReturned + l.qtyReturnPending} max={l.qtyIssued}
                      value={qty[l.id] ?? l.qtyIssued} onChange={(e) => setQty({ ...qty, [l.id]: Number(e.target.value) })} className="field-input w-24" />
                  </div>
                ))}
              </>
            )}
            <Field label="Reason (kept on the job)" htmlFor="gdnfix-reason">
              <input id="gdnfix-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="field-input" placeholder={mode === 'cancel' ? 'Issued on the wrong job…' : 'Only 2 connectors given, not 3…'} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}

/**
 * Issue an approved challan as a GDN. With serial-number items the store picks
 * exactly which units go (live test 2); otherwise one click.
 */
export function IssueParts({ challanId, hasSerial, label = 'Issue (create GDN)', onDone }: { challanId: string; hasSerial: boolean; label?: string; onDone?: (msg: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pick, setPick] = useState<null | { lineId: string; productName: string; qty: number; picked?: string[]; units: { id: string; serialNo: string }[] }[]>(null);
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const issue = (serials: Record<string, string[]> = {}) => start(async () => {
    setError(null);
    const r = await issueJobChallanAction(challanId, serials);
    if (r.error) { setError(r.error); return; }
    setPick(null); onDone?.(`Issued on ${r.gdnNo ?? 'a GDN'}.`); router.refresh();
  });
  const begin = () => {
    if (!hasSerial) { issue(); return; }
    start(async () => {
      const r = await serialChoicesAction(challanId);
      if (r.error || !r.lines) { setError(r.error ?? 'Could not load the serial numbers.'); return; }
      // The units the office reserved when raising come ticked (22 Oct 2026).
      setChosen(Object.fromEntries(r.lines.map((l) => [l.lineId, l.picked ?? []]))); setPick(r.lines);
    });
  };
  return (
    <>
      <Button size="sm" variant="primary" loading={pending && !pick} onClick={begin}>{hasSerial ? `${label} - pick serials` : label}</Button>
      {error && !pick && <span role="alert" className="text-xs text-danger">{error}</span>}
      {pick && (
        <Modal title="Pick the serial numbers" icon="truck" onClose={() => setPick(null)}
          footer={<><Button onClick={() => setPick(null)}>Back</Button><Button variant="primary" loading={pending} disabled={pick.some((l) => (chosen[l.lineId] ?? []).length !== l.qty)} onClick={() => issue(chosen)}>Issue</Button></>}>
          <div className="grid gap-3">
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            {pick.map((l) => (
              <div key={l.lineId} className="grid gap-1 text-sm">
                <span>{l.productName} × {l.qty}</span>
                <SerialChecks units={l.units} need={l.qty} value={chosen[l.lineId] ?? []} onChange={(v) => setChosen({ ...chosen, [l.lineId]: v })} />
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

/** The store receives parts coming back - for serial items, tick which units. */
export function ReceiveBack({ lineId, qty, serial, units = [], onDone }: { lineId: string; qty: number; serial?: boolean; units?: { id: string; serialNo: string }[]; onDone?: (msg: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const go = (unitIds?: string[]) => start(async () => {
    setError(null);
    const r = await receiveReturnedPartsAction(lineId, unitIds);
    if (r.error) { setError(r.error); return; }
    setOpen(false); onDone?.(`${r.qty ?? qty} received back into stock.`); router.refresh();
  });
  return (
    <>
      <Button size="sm" loading={pending && !open} onClick={() => (serial ? (setIds([]), setOpen(true)) : go())}>Receive {qty} into stock</Button>
      {error && !open && <span role="alert" className="text-xs text-danger">{error}</span>}
      {open && (
        <Modal title="Which serial numbers came back?" icon="refresh" onClose={() => setOpen(false)}
          footer={<><Button onClick={() => setOpen(false)}>Back</Button><Button variant="primary" loading={pending} disabled={ids.length !== qty} onClick={() => go(ids)}>Receive</Button></>}>
          {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
          <SerialChecks units={units} need={qty} value={ids} onChange={setIds} />
        </Modal>
      )}
    </>
  );
}

/**
 * Receive an installation's unused goods back (R2, 22 Oct 2026). No serial to
 * pick: a scanned line names its unit, an unscanned one takes back this
 * customer's own.
 */
export function ReceiveInstallBack({ challanId, itemId, qty, onDone }: { challanId: string; itemId: string; qty: number; onDone?: (msg: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const go = () => start(async () => {
    setError(null);
    const r = await installReceiveReturnAction(challanId, itemId);
    if (r.error) { setError(r.error); return; }
    onDone?.(`${r.qty ?? qty} received back into stock.`); router.refresh();
  });
  return (
    <>
      <Button size="sm" loading={pending} onClick={go}>Receive {qty} into stock</Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </>
  );
}

/** Receive a faulty part / old unit at the store, with its serial (finds the original supplier). */
export function ReceiveWithSerial({ onReceive, busy }: { onReceive: (serial: string | null) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [serial, setSerial] = useState('');
  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>Received</Button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <input aria-label="Serial number of the unit" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Serial no. (finds the supplier)" className="h-8 w-52 rounded border border-border bg-card px-2 font-mono text-xs" />
      <Button size="sm" loading={busy} onClick={() => { setOpen(false); onReceive(serial.trim() || null); }}>Confirm</Button>
      <button type="button" className="text-xs text-muted-foreground" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

/**
 * A serial-number product's units on the shelf, ticked up to `need` (22 Oct
 * 2026: the office names them when raising a challan). Ticking none is fine -
 * the store picks them when it issues.
 */
export function ShelfUnits({ productId, need, value, onChange }: {
  productId: string; need: number; value: { id: string; serialNo: string }[]; onChange: (v: { id: string; serialNo: string }[]) => void;
}) {
  const [units, setUnits] = useState<{ id: string; serialNo: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    unitsOnShelfAction(productId).then((r) => { if (!gone) { setUnits(r.units ?? []); setError(r.error ?? null); } });
    return () => { gone = true; };
  }, [productId]);
  // Units already held for this challan are not "on the shelf" - they stay listed, ticked.
  const all = [...value.filter((v) => !(units ?? []).some((u) => u.id === v.id)), ...(units ?? [])];
  if (error) return <p className="text-xs text-danger">{error}</p>;
  if (!units) return <p className="text-xs text-muted-foreground">Loading the serial numbers…</p>;
  return (
    <SerialChecks units={all} need={need} value={value.map((v) => v.id)}
      onChange={(ids) => onChange(all.filter((u) => ids.includes(u.id)))} />
  );
}

/** The store changes a serial on an issued GDN - the unit written down was not the one that went (22 Oct 2026). */
export function SwapSerial({ lineId, productId, productName, units, onDone }: {
  lineId: string; productId: string; productName: string; units: { id: string; serialNo: string }[]; onDone?: (msg: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(units[0]?.id ?? '');
  const [to, setTo] = useState<{ id: string; serialNo: string }[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!units.length) return null;
  const save = () => start(async () => {
    setError(null);
    const r = await swapIssuedUnitAction(lineId, from, to[0]?.id ?? '', reason);
    if (r.error) { setError(r.error); return; }
    setOpen(false); onDone?.('Serial changed.'); router.refresh();
  });
  return (
    <>
      <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => { setTo([]); setReason(''); setError(null); setOpen(true); }}>Change serial</button>
      {open && (
        <Modal title={`Change serial - ${productName}`} icon="refresh" onClose={() => setOpen(false)}
          footer={<><Button onClick={() => setOpen(false)}>Back</Button><Button variant="primary" loading={pending} disabled={!from || to.length !== 1 || !reason.trim()} onClick={save}>Change serial</Button></>}>
          <div className="grid gap-3">
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Field label="Serial on the GDN" htmlFor="sw-from">
              <select id="sw-from" value={from} onChange={(e) => setFrom(e.target.value)} className="field-input font-mono">
                {units.map((u) => <option key={u.id} value={u.id}>{u.serialNo}</option>)}
              </select>
            </Field>
            <div className="grid gap-1 text-sm"><span>The unit that really went</span><ShelfUnits productId={productId} need={1} value={to} onChange={setTo} /></div>
            <Field label="Why" htmlFor="sw-why"><input id="sw-why" value={reason} onChange={(e) => setReason(e.target.value)} className="field-input" /></Field>
            <p className="text-xs text-muted-foreground">The serial on the GDN goes back on the shelf; the one you pick goes to the customer. Stock count and cost do not change.</p>
          </div>
        </Modal>
      )}
    </>
  );
}
