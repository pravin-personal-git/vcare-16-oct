'use client';

import { ProductLink } from '@/components/document/ProductLink';
import { SerialLink } from '@/components/document/SerialLink';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Badge, Field, type BadgeTone } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ProductFinder, type FindableProduct } from '@/components/document/ProductFinder';
import {
  editJobChallanAction, logFaultyPartAction, raiseJobChallanAction, receiveFaultyPartAction, returnUnusedPartsAction, withdrawJobChallanAction,
} from '../../actions';
import { installEditChallanAction, installRaiseChallanAction, installWithdrawChallanAction } from '../../installations/actions';
import { AddSerial, GdnFix, IssueParts, ReceiveBack, ReceiveWithSerial, ShelfUnits, SwapSerial } from '@/components/services/GdnFix';

/**
 * Parts on a job (workflow slice 4, spec §4.4): job challans with their
 * approval status and GDN numbers, raising one from the office, the store's
 * Issue, unused parts coming back, and the faulty part taken out. Internal -
 * none of this reaches the customer.
 */
export interface ChallanVM {
  id: string; challanNo: string; type: string; status: string; note: string | null; createdAt: string;
  createdByName: string | null; rejectionReason: string | null; gdnNos: string[]; cancelledGdnNos?: string[];
  lines: { id: string; productId?: string; productName: string; productCode: string; qty: number; qtyIssued: number; qtyReturned: number; qtyReturnPending: number; serial?: boolean; units?: { id: string; serialNo: string }[] }[];
}
export interface FaultyVM {
  id: string; description: string; serialNo: string | null; productName: string | null; loggedAt: string; receivedAt: string | null;
  /** The Replacements case a received old unit went into (28 Sep 2026). */
  caseNo?: string | null;
  caseId?: string | null;
}

/** Parts of a serial line out with the customer that no serial names. */
const unnamed = (l: ChallanVM['lines'][number]) => (l.serial ? Math.max(0, l.qtyIssued - l.qtyReturned - (l.units ?? []).length) : 0);

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending_approval: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved - to issue', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'danger' },
  issued: { label: 'Issued', tone: 'success' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
/** Until the store issues it, a challan can be put right (22 Oct 2026): changed while waiting or rejected, withdrawn until issued. */
const EDITABLE = ['pending_approval', 'rejected'];
const WITHDRAWABLE = ['pending_approval', 'rejected', 'approved'];
const TYPE: Record<string, string> = { material: 'Material', replacement: 'Replacement', installation: 'Installation' };

export function JobParts({ complaintId, installationChallanId, challans, faulty, catalogue, canEdit, canIssue, fmt, actionsElsewhere = false }: {
  /** Whose job: a complaint's, or an installation's material (R3, 22 Oct 2026) - one of the two. */
  complaintId?: string; installationChallanId?: string;
  challans: ChallanVM[]; faulty: FaultyVM[]; catalogue: FindableProduct[];
  canEdit: boolean; canIssue: boolean; fmt: (iso: string) => string;
  /** Layout A (9 Oct 2026): "Raise challan" and "Log faulty part" live in the page's actions rail. */
  actionsElsewhere?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [raising, setRaising] = useState(false);
  const [logging, setLogging] = useState(false);
  const [editing, setEditing] = useState<ChallanVM | null>(null);
  const [withdrawing, setWithdrawing] = useState<ChallanVM | null>(null);
  /** "Need more" on an issued challan: a new challan, approved like any other (22 Oct 2026). */
  const [moreFor, setMoreFor] = useState<string | null>(null);
  // What the technician marked unused, waiting to be taken back - shown at the top for the office.
  const comingBack = challans.flatMap((c) => c.lines.filter((l) => l.qtyReturnPending > 0).map((l) => ({ c, l })));
  const run = (fn: () => Promise<{ error?: string }>) => start(async () => {
    setError(null);
    const r = await fn();
    if (r.error) setError(r.error);
    router.refresh();
  });

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Parts (challans) - not shown to the customer</h2>
        {canEdit && !actionsElsewhere && <Button size="sm" icon="plus" onClick={() => setRaising(true)}>Raise challan</Button>}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      {comingBack.length > 0 && (
        <div role="status" className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-semibold text-warning">Marked unused - take them back</p>
          <ul className="mt-1.5 grid gap-1.5">
            {comingBack.map(({ c, l }) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2">
                <span>{l.productName}: <strong className="tabular-nums">{l.qtyReturnPending}</strong> unused</span>
                <span className="font-mono text-xs text-muted-foreground">{c.gdnNos[0] ?? c.challanNo}</span>
                {(canEdit || canIssue) && <ReceiveBack lineId={l.id} qty={l.qtyReturnPending} serial={l.serial} units={l.units} unnamed={unnamed(l)} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="mt-3 flex flex-col divide-y divide-border">
        {challans.length === 0 && <li className="py-1 text-sm text-muted-foreground">{installationChallanId
          ? 'No material challans. Cable, clamps and anything else not on the order go out on one.'
          : 'No challans. The technician raises one on site when parts are needed.'}</li>}
        {challans.map((c) => (
          // The trail's challan chip lands here (#challan-id).
          <li key={c.id} id={`challan-${c.id}`} className="scroll-mt-24 rounded-lg py-2.5 target:bg-brand/10 target:ring-2 target:ring-brand/40">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono font-semibold">{c.challanNo}</span>
              <Badge tone={STATUS[c.status]?.tone ?? 'neutral'}>{STATUS[c.status]?.label ?? c.status}</Badge>
              <span className="text-muted-foreground">{TYPE[c.type] ?? c.type}</span>
              {c.gdnNos.map((g) => <span key={g} className="font-mono text-xs text-brand">{g}</span>)}
              {(c.cancelledGdnNos ?? []).map((g) => <span key={g} className="font-mono text-xs text-muted-foreground line-through" title="Cancelled by the store">{g}</span>)}
            </p>
            <p className="text-xs text-muted-foreground">{c.createdByName ?? '-'} · {fmt(c.createdAt)}{c.note ? ` · ${c.note}` : ''}</p>
            {c.rejectionReason && (c.status === 'withdrawn'
              ? <p className="text-xs text-muted-foreground">Withdrawn: {c.rejectionReason}</p>
              : <p className="text-xs text-danger">Rejected: {c.rejectionReason}</p>)}
            <ul className="mt-1 text-sm">
              {c.lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 py-0.5">
                  <span><ProductLink id={l.productId}>{l.productName}</ProductLink> × {l.qty}</span>
                  {/* The serial numbers on the line - reserved when raised, or out on the GDN (22 Oct 2026). */}
                  {(l.units ?? []).length > 0 && (
                    <span className="flex flex-wrap items-center gap-1">
                      {l.units!.map((u) => <SerialLink key={u.id} serialNo={u.serialNo} unitId={u.id} />)}
                      {l.qtyIssued === 0 && <Badge tone="info">reserved</Badge>}
                    </span>
                  )}
                  {l.serial && !(l.units ?? []).length && l.qtyIssued === 0 && ['pending_approval', 'approved'].includes(c.status) && (
                    <span className="text-xs text-muted-foreground">serial: the store picks it</span>
                  )}
                  {/* What really left the store (live test 2): issued · returned · used. */}
                  {l.qtyIssued > 0 && <span className="text-xs text-muted-foreground tabular-nums">{l.qtyIssued} issued · {l.qtyReturned} returned · <strong className="text-foreground">{l.qtyIssued - l.qtyReturned} used</strong></span>}
                  {l.qtyReturnPending > 0 && (
                    <span className="text-xs text-warning">{l.qtyReturnPending} marked unused - take them back above</span>
                  )}
                  {(canEdit || canIssue) && c.status === 'issued' && l.qtyIssued - l.qtyReturned - l.qtyReturnPending > 0 && (
                    <ReturnUnused max={l.qtyIssued - l.qtyReturned - l.qtyReturnPending} store={!l.serial} busy={pending} onReturn={(n) => run(() => returnUnusedPartsAction(l.id, n, undefined, !!l.serial))} />
                  )}
                  {canIssue && c.status === 'issued' && l.serial && l.productId && (l.units ?? []).length > 0 && (
                    <SwapSerial lineId={l.id} productId={l.productId} productName={l.productName} units={l.units ?? []} />
                  )}
                  {/* Out with no serial on record - counted by quantity when the GDN was made (29 Oct 2026). */}
                  {c.status === 'issued' && l.serial && unnamed(l) > 0 && (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="warning">{unnamed(l)} serial{unnamed(l) === 1 ? '' : 's'} not named</Badge>
                      {canIssue && l.productId && <AddSerial lineId={l.id} productId={l.productId} productName={l.productName} missing={unnamed(l)} />}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {c.status === 'pending_approval' && <p className="mt-1 text-xs text-muted-foreground">Approvers see it in My Desk → Waiting on me.</p>}
            {canEdit && c.type !== 'handback' && WITHDRAWABLE.includes(c.status) && (
              <div className="mt-1 flex flex-wrap gap-3">
                {EDITABLE.includes(c.status) && (
                  <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setEditing(c)}>
                    {c.status === 'rejected' ? 'Change and send again' : 'Change'}
                  </button>
                )}
                <button type="button" className="text-xs font-medium text-danger hover:underline" onClick={() => setWithdrawing(c)}>Withdraw</button>
              </div>
            )}
            {c.status === 'issued' && canIssue && c.gdnNos[0] && (
              <div className="mt-1"><GdnFix challanId={c.id} gdnNo={c.gdnNos[0]} lines={c.lines} /></div>
            )}
            {c.status === 'issued' && canEdit && c.type !== 'handback' && (
              <button type="button" className="mt-1 text-xs font-medium text-brand hover:underline" onClick={() => { setMoreFor(c.challanNo); setRaising(true); }}>Need more - raise for approval</button>
            )}
            {c.status === 'approved' && canIssue && (
              <div className="mt-1.5"><IssueParts challanId={c.id} hasSerial={c.lines.some((l) => l.serial)} label="Issue parts (create GDN)" /></div>
            )}
          </li>
        ))}
      </ul>

      {!installationChallanId && <>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <h3 className="text-xs font-semibold">Faulty parts taken out</h3>
        {canEdit && !actionsElsewhere && <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setLogging(true)}>Log faulty part</button>}
      </div>
      <ul className="mt-1 text-sm">
        {faulty.length === 0 && <li className="text-xs text-muted-foreground">None logged.</li>}
        {faulty.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-2 py-0.5">
            <span>{f.description}{f.productName ? ` (${f.productName})` : ''}{f.serialNo ? ` · S/N ${f.serialNo}` : ''}</span>
            {f.receivedAt
              ? <><Badge tone="success">At the store</Badge>{f.caseNo && <Link href={`/services/replacements?q=${encodeURIComponent(f.caseNo)}${f.caseId ? `&open=${f.caseId}` : ''}`} className="font-mono text-xs text-brand hover:underline">{f.caseNo}</Link>}</>
              : canIssue && <ReceiveWithSerial busy={pending} onReceive={(serial) => run(() => receiveFaultyPartAction(f.id, serial))} />}
          </li>
        ))}
      </ul>
      </>}
      <p className="mt-2 text-xs text-muted-foreground">The store&apos;s queue: <Link href="/goods-dispatch/job-parts" className="text-brand hover:underline">Parts counter</Link></p>

      {raising && <RaiseChallan catalogue={catalogue} busy={pending} onClose={() => { setRaising(false); setMoreFor(null); }}
        installation={!!installationChallanId} noteHint={moreFor ? `More for ${moreFor}` : undefined}
        onSave={(input) => {
          setRaising(false); setMoreFor(null);
          run(() => (installationChallanId ? installRaiseChallanAction(installationChallanId, input) : raiseJobChallanAction(complaintId ?? '', input)));
        }} />}
      {editing && <RaiseChallan catalogue={catalogue} busy={pending} onClose={() => setEditing(null)}
        installation={!!installationChallanId}
        initial={{ challanNo: editing.challanNo, type: editing.type, note: editing.note, lines: editing.lines.filter((l) => l.productId).map((l) => ({ productId: l.productId as string, name: l.productName, qty: l.qty, units: l.qtyIssued === 0 ? l.units ?? [] : [] })) }}
        onSave={(input) => {
          const id = editing.id;
          setEditing(null);
          run(() => (installationChallanId ? installEditChallanAction(installationChallanId, id, input) : editJobChallanAction(complaintId ?? '', id, input)));
        }} />}
      {withdrawing && <WithdrawChallan challanNo={withdrawing.challanNo} approved={withdrawing.status === 'approved'} busy={pending} onClose={() => setWithdrawing(null)}
        onConfirm={(reason) => {
          const id = withdrawing.id;
          setWithdrawing(null);
          run(() => (installationChallanId ? installWithdrawChallanAction(installationChallanId, id, reason) : withdrawJobChallanAction(complaintId ?? '', id, reason)));
        }} />}
      {logging && complaintId && <LogFaulty catalogue={catalogue} busy={pending} onClose={() => setLogging(false)}
        onSave={(input) => { setLogging(false); run(() => logFaultyPartAction(complaintId, input)); }} />}
    </section>
  );
}

/**
 * Plain parts: straight back into stock - the store, or the office (Vcare, 22
 * Oct 2026). Serial parts: "coming back", and whoever receives ticks the serials.
 */
function ReturnUnused({ max, store, busy, onReturn }: { max: number; store: boolean; busy: boolean; onReturn: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(1);
  if (!open) return <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setOpen(true)}>{store ? 'Return unused to stock' : 'Unused - send back to store'}</button>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <input aria-label="Quantity returned" type="number" min={1} max={max} value={n} onChange={(e) => setN(Number(e.target.value))} className="h-7 w-16 rounded border border-border bg-card px-1.5 text-xs" />
      <Button size="sm" loading={busy} onClick={() => { setOpen(false); onReturn(n); }}>{store ? 'Return to stock' : 'Send back'}</Button>
      <button type="button" className="text-xs text-muted-foreground" onClick={() => setOpen(false)}>Cancel</button>
    </span>
  );
}

type Unit = { id: string; serialNo: string };

export function RaiseChallan({ catalogue, busy, onClose, onSave, installation = false, initial, noteHint }: {
  catalogue: FindableProduct[]; busy: boolean; onClose: () => void;
  /** An installation's challan: material only - a replacement is a complaint's job (R3). */
  installation?: boolean;
  /** Changing a challan already raised (22 Oct 2026): its lines, note and type to start from. */
  initial?: { challanNo: string; type: string; note: string | null; lines: { productId: string; name: string; qty: number; units?: Unit[] }[] };
  /** A note to start from - "More for JCH-…" when more is needed on an issued challan. */
  noteHint?: string;
  onSave: (input: { type: string; lines: { productId: string; qty: number; unitIds: string[] }[]; note: string | null }) => void;
}) {
  const [type, setType] = useState(initial?.type ?? 'material');
  const [pick, setPick] = useState('');
  const [qty, setQty] = useState(1);
  /**
   * Serial numbers (22 Oct 2026): the office names the units of a serial
   * product on the line - reserved at once, and with every serial line named
   * the GDN goes out on approval by itself. None named: the store picks.
   */
  const [pickUnits, setPickUnits] = useState<Unit[]>([]);
  const [lines, setLines] = useState<{ productId: string; qty: number; units: Unit[] }[]>(initial?.lines.map((l) => ({ productId: l.productId, qty: l.qty, units: l.units ?? [] })) ?? []);
  const [note, setNote] = useState(initial?.note ?? noteHint ?? '');
  // A line already on the challan keeps its name even if the catalogue here no longer lists it.
  const name = (id: string) => catalogue.find((p) => p.id === id)?.name ?? initial?.lines.find((l) => l.productId === id)?.name ?? id;
  const isSerial = (id: string) => !!catalogue.find((p) => p.id === id)?.serial;
  /**
   * A serial line's quantity changed in the list (25 Oct 2026, Vcare): 2 of a
   * product are 2 serials, so its serials open to pick the rest. Lowering the
   * quantity keeps the first serials it still needs.
   */
  const [serialsOf, setSerialsOf] = useState<string | null>(null);
  const setLineQty = (id: string, n: number) => {
    setLines(lines.map((l) => (l.productId === id ? { ...l, qty: n, units: n > 0 && l.units.length > n ? l.units.slice(0, n) : l.units } : l)));
    if (isSerial(id) && n > 0) setSerialsOf(id);
  };
  const setLineUnits = (id: string, units: Unit[]) => setLines(lines.map((l) => (l.productId === id ? { ...l, units } : l)));
  const unitsOk = (l: { qty: number; units: Unit[] }) => l.units.length === 0 || l.units.length === l.qty;
  const valid = lines.length > 0 && lines.every((l) => l.qty > 0 && unitsOk(l));
  const choose = (id: string) => { setPick(id); setPickUnits([]); };
  return (
    <Modal title={initial ? `Change challan ${initial.challanNo}` : 'Raise challan'} icon="truck" size="lg" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={() => onSave({ type, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitIds: l.units.map((u) => u.id) })), note: note.trim() || null })}>{initial ? 'Send for approval again' : 'Send for approval'}</Button></>}>
      {initial && <p className="mb-3 text-xs text-muted-foreground">The approver sees the changed challan as a new request. Nothing has left the store yet, so no stock moves.</p>}
      <div className="grid gap-3">
        <Field label="Type" htmlFor="jc-type">
          <select id="jc-type" value={type} onChange={(e) => setType(e.target.value)} className="field-input">
            <option value="material">Material - parts to complete the job</option>
            {!installation && <option value="replacement">Replacement - swap the customer&apos;s unit</option>}
            <option value="installation">Installation - new equipment</option>
          </select>
        </Field>
        <ProductFinder products={catalogue} pickedId={pick} onPick={choose}
          onPickUnit={(u) => { if (isSerial(u.productId)) { setPickUnits([{ id: u.unitId, serialNo: u.serialNo }]); setQty(1); } }} />
        <div className="flex items-end gap-2">
          <Field label="Quantity" htmlFor="jc-qty"><input id="jc-qty" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} className="field-input w-24" /></Field>
          <Button disabled={!pick || !(qty > 0) || (pickUnits.length > 0 && pickUnits.length !== qty)}
            onClick={() => { setLines([...lines.filter((l) => l.productId !== pick), { productId: pick, qty, units: pickUnits }]); setPick(''); setQty(1); setPickUnits([]); }}>Add line</Button>
        </div>
        {pick && isSerial(pick) && (
          <div className="grid gap-1 text-sm">
            <span>Serial numbers <span className="text-xs text-muted-foreground">- pick {qty} to reserve them and send the GDN out on approval, or none and the store picks</span></span>
            <ShelfUnits productId={pick} need={qty} value={pickUnits} onChange={setPickUnits} />
          </div>
        )}
        {lines.length > 0 && (
          <ul className="rounded-lg border border-border text-sm">
            {lines.map((l) => (
              <li key={l.productId} className="grid gap-1 border-b border-border px-3 py-1.5 last:border-0">
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate">{name(l.productId)}</span>
                  {/* The quantity can be changed right here - mostly what "change the challan" means. */}
                  <input type="number" min={1} aria-label={`Quantity of ${name(l.productId)}`} value={l.qty}
                    onChange={(e) => setLineQty(l.productId, Number(e.target.value))} className="field-input h-8 w-20" />
                  <button type="button" className="text-xs text-danger" onClick={() => setLines(lines.filter((x) => x.productId !== l.productId))}>Remove</button>
                </span>
                {serialsOf !== l.productId && (l.units.length > 0 || isSerial(l.productId)) && (
                  <span className="flex flex-wrap items-center gap-1">
                    {l.units.map((u) => <span key={u.id} className="rounded border border-warning/40 bg-warning/10 px-1.5 font-mono text-xs text-warning">{u.serialNo}</span>)}
                    {isSerial(l.productId) && (
                      <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setSerialsOf(l.productId)}>{l.units.length ? 'change serials' : 'pick serials'}</button>
                    )}
                    {l.units.length > 0 && <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setLineUnits(l.productId, [])}>clear</button>}
                  </span>
                )}
                {serialsOf === l.productId && (
                  <div className="grid gap-1">
                    <span className="text-xs text-muted-foreground">Pick {l.qty} serial{l.qty === 1 ? '' : 's'}, or none and the store picks.</span>
                    <ShelfUnits productId={l.productId} need={l.qty} value={l.units} onChange={(u) => setLineUnits(l.productId, u)} />
                    <button type="button" className="justify-self-start text-xs font-medium text-brand hover:underline" onClick={() => setSerialsOf(null)}>Done</button>
                  </div>
                )}
                {!unitsOk(l) && <span className="text-xs text-danger">{l.units.length} serial{l.units.length === 1 ? '' : 's'} for {l.qty} - match the quantity, or clear them.</span>}
              </li>
            ))}
          </ul>
        )}
        <Field label="Note" htmlFor="jc-note"><textarea id="jc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="field-input" /></Field>
      </div>
    </Modal>
  );
}

/** Take back a challan nothing was issued on (22 Oct 2026). The reason is optional and kept on the job. */
function WithdrawChallan({ challanNo, approved, busy, onClose, onConfirm }: {
  challanNo: string; approved: boolean; busy: boolean; onClose: () => void; onConfirm: (reason: string | null) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={`Withdraw challan ${challanNo}`} icon="x" onClose={onClose}
      footer={<><Button onClick={onClose}>Keep it</Button><Button variant="danger" loading={busy} onClick={() => onConfirm(reason.trim() || null)}>Withdraw challan</Button></>}>
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          {approved
            ? 'It is approved but the store has not issued it, so nothing has left the store. It leaves the store\'s queue and stays on the job, crossed out.'
            : 'It leaves the approvers\' list and stays on the job, crossed out. Nothing has left the store.'}
        </p>
        <Field label="Why (optional)" htmlFor="jc-why"><textarea id="jc-why" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="field-input" /></Field>
      </div>
    </Modal>
  );
}

export function LogFaulty({ catalogue, busy, onClose, onSave }: {
  catalogue: FindableProduct[]; busy: boolean; onClose: () => void;
  onSave: (input: { productId: string | null; description: string; serialNo: string | null }) => void;
}) {
  const [pick, setPick] = useState('');
  const [what, setWhat] = useState('');
  const [serial, setSerial] = useState('');
  return (
    <Modal title="Log faulty part" icon="alert-circle" size="lg" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!what.trim()} onClick={() => onSave({ productId: pick || null, description: what.trim(), serialNo: serial.trim() || null })}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="What is it" required htmlFor="fp-what"><input id="fp-what" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Burnt LED driver" className="field-input" /></Field>
        <Field label="Serial number" htmlFor="fp-serial"><input id="fp-serial" value={serial} onChange={(e) => setSerial(e.target.value)} className="field-input" /></Field>
        <p className="text-xs text-muted-foreground">Optional: pick the product it is.</p>
        <ProductFinder products={catalogue} pickedId={pick} onPick={setPick} />
      </div>
    </Modal>
  );
}
