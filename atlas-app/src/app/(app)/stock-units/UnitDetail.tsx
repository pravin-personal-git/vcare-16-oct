'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { COVERAGE_LABEL } from '@/lib/amc-coverage';
import {
  UNIT_CONDITION_LABEL, UNIT_STATUS_LABEL, UNIT_STATUS_TONE, type UnitCondition, type UnitStatus,
} from '@/lib/stock-units';
import { fieldsForCategory, selectOptions, type StockFieldDef } from '@/lib/stock-fields';
import type { UnitDetail as Detail } from '@/server/stock-units';
import {
  loadUnitDetailAction, setConditionAction, setSerialAction, saveUnitFieldsAction,
  type UnitActionState,
} from './actions';
import { MoveUnitDialog, ErrorNote, field, label, type PartyOption } from './UnitDialogs';

const fmt = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-';

const COVER_TONE = { amc: 'success', warranty: 'info', chargeable: 'warning' } as const;

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">{k}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

export function UnitDetail({
  unitId, parties, fields, canEdit, onClose, onChanged,
}: {
  unitId: string;
  parties: PartyOption[];
  fields: StockFieldDef[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: (res: UnitActionState) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [serial, setSerial] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await loadUnitDetailAction(unitId);
    if (res.error || !res.detail) { setError(res.error ?? 'Not found.'); return; }
    setD(res.detail);
    setSerial(res.detail.serialNo ?? '');
    setValues(res.detail.customFields);
  }

  useEffect(() => { void load(); }, [unitId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(p: Promise<UnitActionState>) {
    setBusy(true);
    setError(null);
    const res = await p;
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onChanged(res);
    await load();
  }

  const applicable = d ? fieldsForCategory(fields, d.categoryId) : [];

  return (
    <Modal
      title={d ? (d.serialNo ?? 'Serial to follow') : 'Loading…'}
      subtitle={d ? `${d.productName} · ${d.productCode}` : undefined}
      icon="box"
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {canEdit && d && (
            <>
              <Button
                variant="outline" icon="refresh" disabled={busy}
                onClick={() => run(setConditionAction(d.id, d.condition === 'new' ? 'refurbished' : 'new', null))}
              >
                Mark {d.condition === 'new' ? 'refurbished' : 'new'}
              </Button>
              <Button variant="primary" icon="truck" onClick={() => setMoving(true)} disabled={busy || d.status === 'scrapped'}>
                Move
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      }
    >
      <ErrorNote text={error} />
      {!d ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5">
          {/* ---- the answer somebody looked it up for */}
          <section className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="me-auto">
              <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">Where it is</p>
              <p className="mt-0.5 flex items-center gap-2 text-sm font-medium">
                <Badge tone={UNIT_STATUS_TONE[d.status as UnitStatus] ?? 'neutral'}>
                  {UNIT_STATUS_LABEL[d.status as UnitStatus] ?? d.status}
                </Badge>
                {d.holderName && (d.holderId
                  ? <Link className="hover:text-brand" href={`/customers/${d.holderId}`}>{d.holderName}</Link>
                  : d.holderName)}
                <Badge tone={d.condition === 'refurbished' ? 'warning' : 'neutral'}>
                  {UNIT_CONDITION_LABEL[d.condition as UnitCondition] ?? d.condition}
                </Badge>
              </p>
            </div>
            {d.coverage && (
              <div className="max-w-md">
                <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">If it breaks today</p>
                <p className="mt-0.5 flex items-center gap-2 text-sm">
                  <Badge tone={COVER_TONE[d.coverage.kind]}>{COVERAGE_LABEL[d.coverage.kind]}</Badge>
                  {d.coverage.uncertain && <span className="text-xs text-warning">check</span>}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{d.coverage.reason}</p>
              </div>
            )}
          </section>

          {/* ---- facts */}
          <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
            <Row k="Customer warranty">
              {d.warrantyMonths === null ? <span className="text-muted-foreground">Product carries none</span>
                : d.warrantyStartsOn
                  ? <>{d.warrantyMonths} months, to {fmt(d.warrantyUntil)}</>
                  : <>{d.warrantyMonths} months, from the sale</>}
              <span className="block text-xs text-muted-foreground">
                Counted from the {d.warrantyBasis === 'install' ? 'installation' : 'invoice'} date
                {d.warrantyStartsOn ? ` - ${fmt(d.warrantyStartsOn)}` : ' - not sold yet'}
                {d.unitWarrantyMonths !== null ? ' · this unit has its own period' : ''}
              </span>
            </Row>
            <Row k="Sold on">
              {d.invoice ? <><Link className="font-mono hover:text-brand" href={`/invoices/${d.invoice.id}`}>{d.invoice.invoiceNo}</Link> <span className="text-muted-foreground">· {fmt(d.invoice.invoiceDate)}</span></> : <span className="text-muted-foreground">Not linked</span>}
            </Row>
            <Row k="Installed">
              {d.install ? <><Link className="font-mono hover:text-brand" href={`/services/installations/${d.install.id}`}>{d.install.challanNo}</Link> <span className="text-muted-foreground">· {fmt(d.install.completedAt ?? d.install.dispatchedAt)}</span></> : <span className="text-muted-foreground">No challan</span>}
            </Row>
            <Row k="Arrived">
              {fmt(d.receivedAt)}
              {d.supplier ? <span className="block text-xs text-muted-foreground"><Link className="font-mono hover:text-brand" href={`/goods-receipt/${d.supplier.grnId}`}>{d.supplier.grnNo}</Link> · {d.supplier.supplierName}</span>
                : <span className="block text-xs text-muted-foreground">Opening stock</span>}
            </Row>
            <Row k="Supplier invoice">{d.supplier?.supplierInvoiceNo ?? <span className="text-muted-foreground">Not recorded</span>}</Row>
            <Row k="Supplier warranty">
              {d.supplier?.warrantyUntil
                ? <>{d.supplier.warrantyMonths} months, to {fmt(d.supplier.warrantyUntil)}</>
                : <span className="text-muted-foreground">Not recorded</span>}
            </Row>
            <Row k="Cost">{d.unitCostPaise !== null ? formatCurrency(d.unitCostPaise) : <span className="text-muted-foreground">Unknown</span>}</Row>
            {d.legacyRef && <Row k="Old system reference"><span className="font-mono text-xs">{d.legacyRef}</span></Row>}
          </dl>

          {/* ---- serial */}
          {canEdit && (
            <section>
              <label className={label}>{d.serialNo ? 'Correct the serial' : 'Record its serial'}</label>
              <div className="flex gap-2">
                <input className={`${field} font-mono`} value={serial} onChange={(e) => setSerial(e.target.value)} />
                <Button variant="outline" disabled={busy || !serial.trim() || serial.trim() === d.serialNo}
                  onClick={() => run(setSerialAction(d.id, serial))}>Save</Button>
              </div>
            </section>
          )}

          {/* ---- this store's own fields */}
          {applicable.length > 0 && (
            <section>
              <p className={label}>Details</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {applicable.map((f) => {
                  const v = values[f.fieldKey];
                  const set = (x: unknown) => setValues((p) => ({ ...p, [f.fieldKey]: x }));
                  return (
                    <div key={f.fieldKey}>
                      <label className="mb-0.5 block text-xs text-muted-foreground">{f.label}{f.required ? ' *' : ''}</label>
                      {f.fieldType === 'boolean' ? (
                        <input type="checkbox" disabled={!canEdit} checked={v === true} onChange={(e) => set(e.target.checked)} />
                      ) : f.fieldType === 'select' ? (
                        <select disabled={!canEdit} className={field} value={String(v ?? '')} onChange={(e) => set(e.target.value)}>
                          <option value="">-</option>
                          {selectOptions(f).map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input
                          disabled={!canEdit} className={field} value={String(v ?? '')}
                          type={f.fieldType === 'date' ? 'date' : 'text'}
                          inputMode={f.fieldType === 'number' ? 'decimal' : undefined}
                          onChange={(e) => set(e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {canEdit && (
                <Button className="mt-2" size="sm" variant="outline" disabled={busy}
                  onClick={() => run(saveUnitFieldsAction(d.id, values))}>Save details</Button>
              )}
            </section>
          )}

          {/* ---- complaints */}
          {d.complaints.length > 0 && (
            <section>
              <p className={label}>Complaints on this product at this customer</p>
              <ul className="divide-y divide-border rounded border border-border text-xs">
                {d.complaints.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <Link className="font-mono hover:text-brand" href={`/services/complaints/${c.id}`}>{c.complaintNo}</Link>
                    <span className="truncate text-muted-foreground">{c.description}</span>
                    <span className="shrink-0">{c.status} · {fmt(c.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ---- history */}
          <section>
            <p className={label}>History</p>
            {d.events.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing recorded.</p>
            ) : (
              <ol className="space-y-1.5 text-xs">
                {d.events.map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <Icon name="clock" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="text-muted-foreground">{fmt(e.createdAt)}</span>{' '}
                      {e.eventType === 'received' && <>Arrived{e.refNo ? ` on ${e.refNo}` : ''}</>}
                      {e.eventType === 'migrated' && <>Brought over from the old system</>}
                      {e.eventType === 'status' && (
                        <>{UNIT_STATUS_LABEL[e.fromStatus as UnitStatus] ?? e.fromStatus} to {UNIT_STATUS_LABEL[e.toStatus as UnitStatus] ?? e.toStatus}</>
                      )}
                      {e.eventType === 'condition' && <>Marked {e.toCondition}</>}
                      {(e.eventType === 'serial' || e.eventType === 'fields') && <>{e.note}</>}
                      {e.partyName && <> · {e.partyName}</>}
                      {e.eventType === 'status' && e.refNo && <> · {e.refNo}</>}
                      {e.eventType !== 'serial' && e.eventType !== 'fields' && e.note && <span className="text-muted-foreground"> - {e.note}</span>}
                      {e.byName && <span className="text-muted-foreground"> · {e.byName}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}

      {moving && d && (
        <MoveUnitDialog
          unit={d}
          parties={parties}
          onClose={() => setMoving(false)}
          onDone={(res) => { setMoving(false); onChanged(res); void load(); }}
        />
      )}
    </Modal>
  );
}
