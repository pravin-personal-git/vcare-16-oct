'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Field } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { SerialLink } from '@/components/document/SerialLink';
import {
  addDocSerialAction, changeDocSerialAction, confirmDocSerialAction, docSerialCandidatesAction, docSerialsAction,
} from '@/app/actions/serials';
import type { DocSerialLine, SerialDocKind } from '@/server/serial-links';

/**
 * The serials a sale, order or return moved (29 Oct 2026) - each one opens its
 * Product History. A serial Atlas picked by itself says so until somebody
 * checks it; a part that went with no serial can have one named; a wrong one
 * can be changed. Shows nothing when the document moved no serial product.
 */
export function DocSerials({ kind, id, canEdit }: { kind: SerialDocKind; id: string; canEdit: boolean }) {
  const router = useRouter();
  const [lines, setLines] = useState<DocSerialLine[] | null>(null);
  const [dialog, setDialog] = useState<null | { productId: string; productName: string; fromUnitId?: string; fromSerial?: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = () => docSerialsAction(kind, id).then((r) => ('error' in r ? setError(r.error) : setLines(r.lines)));
  useEffect(() => { load(); }, [kind, id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lines?.length) return error ? <p role="alert" className="text-xs text-danger">{error}</p> : null;
  const done = () => { setDialog(null); load(); router.refresh(); };
  const confirm = (unitId: string) => start(async () => {
    const r = await confirmDocSerialAction(kind, id, unitId);
    if ('error' in r) setError(r.error); else done();
  });

  return (
    <section aria-label="Serial numbers" className="grid gap-2 rounded-lg border border-border p-3 text-sm">
      <h3 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">Serial numbers</h3>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <ul className="grid gap-2">
        {lines.map((l) => (
          <li key={l.productId} className="grid gap-1">
            <span>{l.productName} <span className="text-muted-foreground tabular-nums">× {l.qty}</span></span>
            <span className="flex flex-wrap items-center gap-1.5">
              {l.units.map((u) => (
                <span key={u.id} className="inline-flex items-center gap-1">
                  <SerialLink serialNo={u.serialNo} unitId={u.id} />
                  {u.guessed && <Badge tone="warning">picked by Atlas</Badge>}
                  {canEdit && u.guessed && <button type="button" disabled={pending} className="text-xs font-medium text-brand hover:underline" onClick={() => confirm(u.id)}>Confirm</button>}
                  {canEdit && <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setDialog({ productId: l.productId, productName: l.productName, fromUnitId: u.id, fromSerial: u.serialNo })}>Change</button>}
                </span>
              ))}
              {l.unnamed > 0 && <Badge tone="warning">{l.unnamed} serial{l.unnamed === 1 ? '' : 's'} not named</Badge>}
              {canEdit && l.unnamed > 0 && <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setDialog({ productId: l.productId, productName: l.productName })}>Add serial</button>}
            </span>
          </li>
        ))}
      </ul>
      {dialog && <PickSerial kind={kind} id={id} {...dialog} onClose={() => setDialog(null)} onDone={done} />}
    </section>
  );
}

function PickSerial({ kind, id, productId, productName, fromUnitId, fromSerial, onClose, onDone }: {
  kind: SerialDocKind; id: string; productId: string; productName: string; fromUnitId?: string; fromSerial?: string; onClose: () => void; onDone: () => void;
}) {
  const [q, setQ] = useState('');
  const [units, setUnits] = useState<{ id: string; serialNo: string; where: string }[] | null>(null);
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    let gone = false;
    const t = setTimeout(() => docSerialCandidatesAction(kind, id, productId, q).then((r) => {
      if (gone) return;
      if ('error' in r) setError(r.error); else setUnits(r.units.filter((u) => u.id !== fromUnitId));
    }), 250);
    return () => { gone = true; clearTimeout(t); };
  }, [kind, id, productId, q, fromUnitId]);
  const save = () => start(async () => {
    setError(null);
    const r = fromUnitId ? await changeDocSerialAction(kind, id, fromUnitId, pick, reason) : await addDocSerialAction(kind, id, productId, pick, reason);
    if ('error' in r) setError(r.error); else onDone();
  });
  return (
    <Modal title={fromSerial ? `Change ${fromSerial} - ${productName}` : `Add serial - ${productName}`} icon="refresh" onClose={onClose}
      footer={<><Button onClick={onClose}>Back</Button><Button variant="primary" loading={pending} disabled={!pick || !reason.trim()} onClick={save}>{fromSerial ? 'Change serial' : 'Add serial'}</Button></>}>
      <div className="grid gap-3">
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Field label="Serial number" htmlFor="ds-q"><input id="ds-q" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type or scan…" className="field-input font-mono" /></Field>
        <div className="grid max-h-56 gap-1 overflow-y-auto rounded border border-border p-2">
          {!units && <p className="text-xs text-muted-foreground">Loading…</p>}
          {units?.length === 0 && <p className="text-xs text-muted-foreground">No serial of this product matches.</p>}
          {units?.map((u) => (
            <label key={u.id} className="flex items-center gap-2 text-xs">
              <input type="radio" name="ds-unit" checked={pick === u.id} onChange={() => setPick(u.id)} />
              <span className="font-mono">{u.serialNo}</span><span className="text-muted-foreground">{u.where}</span>
            </label>
          ))}
        </div>
        <Field label="Why" htmlFor="ds-why"><input id="ds-why" value={reason} onChange={(e) => setReason(e.target.value)} className="field-input" /></Field>
        <p className="text-xs text-muted-foreground">Stock count, amount and tax do not change - only which unit it was. The bill, Product History and the warranty follow.</p>
      </div>
    </Modal>
  );
}
