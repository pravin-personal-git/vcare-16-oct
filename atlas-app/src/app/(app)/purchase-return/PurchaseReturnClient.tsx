'use client';

import { useListParams, useUrlState } from '@/components/ui/useListParams';
import { sayIfHeld } from '@/lib/held-message';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { DateRangeSelect, useUrlDateRange } from '@/components/ui/DateRangeSelect';
import { inRange } from '@/lib/date-ranges';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Toolbar, ToolbarIcon } from '@/components/ui/Toolbar';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import type { BillForReturn } from '@/server/purchase-returns';
import { DocSerials } from '@/components/stock/DocSerials';
import {
  loadReceivedBills, loadBillDetail, createReturnAction,
  dispatchReturnAction, cancelReturnAction, issueDebitNoteAction, cancelDebitNoteAction,
} from './actions';

export interface ReturnRowVM {
  id: string;
  returnNo: string;
  supplierName: string;
  returnedAt: string;
  lifecycle: string;
  reason: string;
  billId: string;
  bill: { billNo: string; supplierBillNo: string };
  totalPaise: number;
  debitNotes: { id: string; debitNoteNo: string; lifecycle: string; grandTotalPaise: number }[];
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

const STATUS_TONE: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  draft: 'warning', dispatched: 'success', cancelled: 'neutral',
};

export function PurchaseReturnClient({
  rows, canEdit, canIssueDebitNote, canSerials = false,
}: {
  rows: ReturnRowVM[];
  canEdit: boolean;
  canIssueDebitNote: boolean;
  /** Stock: Edit - name or change the serials that went to the supplier. */
  canSerials?: boolean;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  // Kept in the address (F1b): survives refresh and Back.
  const [search, setSearch] = useUrlState('q');
  const [createOpen, setCreateOpen] = useState(false);
  const [reviewing, setReviewing] = useState<ReturnRowVM | null>(null);

  // The date filter (9 Oct 2026): ?range= &from= &to=, default all time.
  // Everything below - tiles, chips, the grid - works on these rows.
  const range = useUrlDateRange();
  const list = useListParams();
  // G-27: ?open=<id> (from the document trail) opens that return.
  useEffect(() => {
    const o = list.get('open');
    const r = o ? rows.find((x) => x.id === o) : undefined;
    if (r) setReviewing(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rangeOn = range.from !== null || range.to !== null;
  const dated = useMemo(() => rows.filter((r) => inRange(r.returnedAt, range)), [rows, range]);

  const cards = useMemo(() => ({
    total: dated.length,
    draft: dated.filter((r) => r.lifecycle === 'draft').length,
    dispatched: dated.filter((r) => r.lifecycle === 'dispatched').length,
    debited: dated.filter((r) => r.debitNotes.some((d) => d.lifecycle === 'issued')).length,
    totalValuePaise: dated.reduce((n, r) => n + r.totalPaise, 0),
  }), [dated]);

  const kpis: KpiCard[] = [
    { key: 'all', label: 'Total Returns', count: cards.total, icon: 'rotate-ccw' },
    { key: 'draft', label: 'Draft', count: cards.draft, icon: 'file-text', tone: 'warning' },
    { key: 'dispatched', label: 'Dispatched', count: cards.dispatched, icon: 'truck', tone: 'success' },
    { key: 'debited', label: 'Debit Note Issued', count: cards.debited, icon: 'receipt', tone: 'brand' },
    { key: 'value', label: 'Total Value', count: formatCurrencyCompact(cards.totalValuePaise), icon: 'credit-card', tone: 'info' },
  ];

  const visible = useMemo(() => {
    if (filter === 'draft') return dated.filter((r) => r.lifecycle === 'draft');
    if (filter === 'dispatched') return dated.filter((r) => r.lifecycle === 'dispatched');
    if (filter === 'debited') return dated.filter((r) => r.debitNotes.some((d) => d.lifecycle === 'issued'));
    return dated;
  }, [dated, filter]);

  const columns: Column<ReturnRowVM>[] = [
    { key: 'returnNo', header: 'Return No.', width: '10rem',
      render: (r) => <button type="button" onClick={() => setReviewing(r)} className="font-mono text-xs font-medium text-brand hover:underline">{r.returnNo}</button>,
      sortValue: (r) => r.returnNo },
    { key: 'supplier', header: 'Supplier', render: (r) => r.supplierName, sortValue: (r) => r.supplierName },
    { key: 'bill', header: 'Against Bill', render: (r) => <span className="text-xs">{r.bill.billNo}</span>, sortValue: (r) => r.bill.billNo, optional: true },
    { key: 'date', header: 'Date', render: (r) => <span className="text-xs">{fmtDate(r.returnedAt)}</span>, sortValue: (r) => r.returnedAt },
    { key: 'value', header: 'Value', align: 'end', render: (r) => <span className="font-mono text-xs">{formatCurrency(r.totalPaise)}</span>, sortValue: (r) => r.totalPaise },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={STATUS_TONE[r.lifecycle] ?? 'neutral'}>{r.lifecycle}</Badge>, sortValue: (r) => r.lifecycle },
    {
      key: 'debitNote', header: 'Debit Note',
      render: (r) => {
        const issued = r.debitNotes.find((d) => d.lifecycle === 'issued');
        return issued ? <span className="font-mono text-xs text-brand">{issued.debitNoteNo}</span> : <span className="text-xs text-muted-foreground">-</span>;
      },
      sortValue: (r) => r.debitNotes.find((d) => d.lifecycle === 'issued')?.debitNoteNo ?? '',
      optional: true,
    },
  ];

  return (
    <div>
      <PageHeader
        badge="PR"
        title="Purchase Return"
        subtitle={`${rows.length} returns`}
        actions={
          canEdit ? (
            <Button variant="primary" icon="rotate-ccw" onClick={() => setCreateOpen(true)}>
              Create Purchase Return
            </Button>
          ) : undefined
        }
      />

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Return no., supplier, bill…"
        count={`Total (${visible.length})`}
        filters={<DateRangeSelect label="Returned" />}
        end={
          <>
            <ToolbarIcon icon="refresh" label="Refresh" onClick={() => window.location.reload()} />
            <ToolbarIcon
              icon="x-circle" label="Clear filters"
              active={filter !== null || search !== '' || rangeOn}
              onClick={() => { setFilter(null); setSearch(''); list.set({ range: null, from: null, to: null }); }}
            />
          </>
        }
      />

      <KpiStrip cards={kpis} activeKey={filter} onSelect={setFilter} columns={5} />

      <DataGrid
        exportAs={{ title: 'Purchase returns' }}
        rows={visible}
        columns={columns}
        rowKey={(r) => r.id}
        search={search}
        emptyIcon="rotate-ccw"
        emptyMessage={filter ? 'No returns match this card.' : 'No purchase returns found.'}
        emptyHint="Create one against a received bill to send goods back to a supplier."
        pageSizes={[10, 25, 50, 100]}
        pageSummary={(pageRows) => (
          <span className="text-muted-foreground">
            Count: <strong className="text-foreground">{pageRows.length}</strong>
          </span>
        )}
        actions={[
          { label: 'View / manage', icon: 'file-text', iconTone: 'brand', onSelect: (r) => setReviewing(r) },
        ]}
      />

      {createOpen && (
        <CreateReturnDialog onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); window.location.reload(); }} />
      )}

      {reviewing && (
        <ManageDialog
          row={reviewing}
          canEdit={canEdit}
          canIssueDebitNote={canIssueDebitNote}
          canSerials={canSerials}
          onClose={() => setReviewing(null)}
          onChanged={() => window.location.reload()}
        />
      )}
    </div>
  );
}

function CreateReturnDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [bills, setBills] = useState<{ id: string; billNo: string; supplierBillNo: string; supplierName: string; billDate: string }[]>([]);
  const [billId, setBillId] = useState('');
  const [detail, setDetail] = useState<BillForReturn | null>(null);
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [dispatchNow, setDispatchNow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    void loadReceivedBills().then((b) => {
      setBills(b.map((x) => ({ ...x, billDate: x.billDate.toISOString() })));
      if (b.length > 0) setBillId(b[0].id);
    });
  }, []);

  useEffect(() => {
    if (!billId) { setDetail(null); return; }
    void loadBillDetail(billId).then((d) => { setDetail(d); setQtyByLine({}); });
  }, [billId]);

  const lines = (detail?.lines ?? [])
    .map((l) => {
      const qty = Number(qtyByLine[l.billItemId] || 0);
      return { billItemId: l.billItemId, qty };
    })
    .filter((l) => l.qty > 0);

  const ready = lines.length > 0 && reason.trim() !== '';

  const save = () => {
    startTransition(async () => {
      const res = await createReturnAction({ billId, lines, reason, dispatchNow, notes: null });
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <Modal
      open
      title="Create Purchase Return"
      subtitle="Send goods back to a supplier against a received bill"
      icon="rotate-ccw"
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={dispatchNow} onChange={(e) => setDispatchNow(e.target.checked)} />
            Dispatch immediately - stock leaves now
          </label>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon="check" disabled={!ready || pending} loading={pending} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="whitespace-pre-line">{error}</span>
          </p>
        )}

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Purchase bill
          <select value={billId} onChange={(e) => setBillId(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
            {bills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.billNo} - {b.supplierName} (their #{b.supplierBillNo})
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Reason
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Damaged on arrival, wrong item, over-ordered…"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>

        {detail && (
          <div className="rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="p-2 text-start">Product</th>
                  <th className="p-2 text-end">Received</th>
                  <th className="p-2 text-end">Already returned</th>
                  <th className="p-2 text-end">Return qty</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map((l) => {
                  const left = l.qty - l.returnedQty;
                  return (
                    <tr key={l.billItemId} className="border-b border-border last:border-0">
                      <td className="p-2">{l.productName}</td>
                      <td className="p-2 text-end font-mono text-xs">{l.qty}</td>
                      <td className="p-2 text-end font-mono text-xs">{l.returnedQty}</td>
                      <td className="p-2 text-end">
                        <input
                          type="number" min={0} max={left}
                          disabled={left <= 0}
                          value={qtyByLine[l.billItemId] ?? ''}
                          onChange={(e) => setQtyByLine((m) => ({ ...m, [l.billItemId]: e.target.value }))}
                          className="w-20 rounded border border-border bg-background px-2 py-1 text-end text-xs disabled:opacity-40"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ManageDialog({
  row, canEdit, canIssueDebitNote, canSerials = false, onClose, onChanged,
}: {
  row: ReturnRowVM;
  canEdit: boolean;
  canIssueDebitNote: boolean;
  /** Stock: Edit - name or change the serials that went to the supplier. */
  canSerials?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const issuedNote = row.debitNotes.find((d) => d.lifecycle === 'issued');

  const dispatch = () => {
    startTransition(async () => {
      const res = await dispatchReturnAction(row.id);
      if (res.error) { setError(res.error); return; }
      onChanged();
    });
  };
  const cancelReturn = () => {
    startTransition(async () => {
      const res = await cancelReturnAction(row.id, reason);
      if (res.error) { setError(res.error); return; }
      onChanged();
    });
  };
  const issueNote = () => {
    startTransition(async () => {
      const res = await issueDebitNoteAction(row.id, reason || row.reason);
      if (res.error) { setError(res.error); return; }
      sayIfHeld(res);
      onChanged();
    });
  };
  const cancelNote = () => {
    if (!issuedNote) return;
    startTransition(async () => {
      const res = await cancelDebitNoteAction(issuedNote.id, reason);
      if (res.error) { setError(res.error); return; }
      onChanged();
    });
  };

  return (
    <Modal
      open
      title={row.returnNo}
      subtitle={`${row.supplierName} · ${formatCurrency(row.totalPaise)}`}
      icon="rotate-ccw"
      size="sm"
      onClose={onClose}
    >
      <div className="grid gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <dl className="grid gap-1 text-xs text-muted-foreground">
          <div className="flex justify-between"><dt>Status</dt><dd className="font-medium text-foreground">{row.lifecycle}</dd></div>
          <div className="flex justify-between"><dt>Reason</dt><dd className="font-medium text-foreground">{row.reason}</dd></div>
          <div className="flex justify-between"><dt>Debit note</dt><dd className="font-medium text-foreground">{issuedNote?.debitNoteNo ?? 'Not issued'}</dd></div>
        </dl>

        {/* Which serials went to the supplier - their warranty claim is answered by these (29 Oct 2026). */}
        <DocSerials kind="purchase_return" id={row.id} canEdit={canSerials} />

        {(row.lifecycle !== 'cancelled') && (
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Reason (for cancel / debit note)
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </label>
        )}

        <div className="flex flex-wrap gap-2">
          {canEdit && row.lifecycle === 'draft' && (
            <Button icon="truck" disabled={pending} loading={pending} onClick={dispatch}>Dispatch</Button>
          )}
          {canEdit && row.lifecycle !== 'cancelled' && !issuedNote && (
            <Button icon="x-circle" disabled={!reason.trim() || pending} loading={pending} onClick={cancelReturn}>Cancel return</Button>
          )}
          {canIssueDebitNote && row.lifecycle === 'dispatched' && !issuedNote && (
            <Button variant="primary" icon="receipt" disabled={pending} loading={pending} onClick={issueNote}>Issue debit note</Button>
          )}
          {canIssueDebitNote && issuedNote && (
            <Button icon="rotate-ccw" disabled={!reason.trim() || pending} loading={pending} onClick={cancelNote}>Cancel debit note</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
