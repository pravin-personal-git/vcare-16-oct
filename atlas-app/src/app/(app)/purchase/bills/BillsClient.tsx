'use client';

import { SupplierLink } from '@/components/document/SupplierLink';
import { useMemo, useState } from 'react';
import { useDebouncedSearch, useListParams } from '@/components/ui/useListParams';
import { DateRangeSelect } from '@/components/ui/DateRangeSelect';
import { ServerExportButton } from '@/components/ui/ServerExportButton';
import type { BillTotals } from '@/server/bills-list';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge, Card, Field, SectionCard, SummaryRow } from '@/components/ui/Layout';
import { Toolbar, FilterSelect } from '@/components/ui/Toolbar';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import {
  AGE_BUCKET_LABEL, BILL_STATUS_LABEL, ageBucket, computeBillTotals,
  type BillStatus,
} from '@/lib/purchase';
import { createBillAction } from './actions';

/**
 * Supplier bills.
 *
 * WHY THE SUPPLIER'S OWN BILL NUMBER IS A REQUIRED FIELD.
 *
 * Ours (`PB-…`) is a filing convenience. Theirs is what goes on the GST return,
 * what they quote when chasing payment, and what an auditor matches against.
 * It is also the only way to catch the same bill being entered twice - which is
 * the commonest way a payables ledger goes wrong, costs real money, and looks
 * exactly like an ordinary purchase on screen.
 */

interface BillVM {
  id: string;
  /** An approval request is open on it (posting is held). */
  awaitingApproval?: boolean;
  billNo: string;
  supplierBillNo: string;
  partyId: string;
  supplierName: string;
  billDate: string;
  dueDate: string;
  lifecycle: string;
  grandTotalPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  status: BillStatus;
  lineCount: number;
}

interface SupplierVM { id: string; name: string; gstin: string | null; isSupplier: boolean }
interface ProductVM {
  id: string; name: string; code: string;
  hsnCode: string | null; kind: string; unit: string;
}

interface LineDraft {
  productId: string | null;
  productName: string;
  productCode: string | null;
  hsnCode: string | null;
  qty: string;
  unitCost: string;
  discountPct: string;
  taxRatePct: string;
}

const rupees = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' });

/** Rupees typed by a human into integer paise. Never floats near money. */
function toPaise(v: string): number {
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

const STATUS_TONE: Record<BillStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  unpaid: 'info',
  part_paid: 'warning',
  paid: 'success',
  overdue: 'danger',
  cancelled: 'neutral',
};

const blankLine = (): LineDraft => ({
  productId: null, productName: '', productCode: null, hsnCode: null,
  qty: '1', unitCost: '', discountPct: '0', taxRatePct: '18',
});

export function BillsClient({
  rangeLabel, bills, suppliers, products, canEdit, canPay, paging, total, totals, supplierNames, card, supplier,
}: {
  /** "All time", "This month"... - the active date filter (9 Oct 2026). */
  rangeLabel: string;
  /** One server-side page (F1b): searched, filtered and sorted on the server. */
  bills: BillVM[];
  paging: ServerPaging;
  /** Bills in the period, before filters. */
  total: number;
  /** Counted over every bill in the period. */
  totals: BillTotals;
  supplierNames: string[];
  card: string | null;
  supplier: string;
  suppliers: SupplierVM[];
  products: ProductVM[];
  canEdit: boolean;
  canPay: boolean;
}) {
  const router = useRouter();
  // Every filter lives in the address and runs on the server (F1b server paging).
  const list = useListParams();
  const { value: search, setValue: setSearch } = useDebouncedSearch('q');
  // The cards are the status filter (4 Oct 2026).
  const cardKey = card;
  const setCardKey = (k: string | null) => list.set({ card: k });
  const setSupplier = (v: string) => list.set({ supplier: v || null });
  const [showNew, setShowNew] = useState(false);

  const now = new Date();

  // Totals come from the server, over every bill in the period.

  const cards: KpiCard[] = [
    {
      key: 'owed', label: 'Owed to suppliers', count: rupees(totals.owed),
      subLabel: `across ${totals.count} bill${totals.count === 1 ? '' : 's'}`,
      icon: 'credit-card', tone: totals.owed > 0 ? 'warning' : 'success',
    },
    {
      key: 'overdue', label: 'Overdue', count: rupees(totals.overdue),
      subLabel: totals.overdue > 0 ? 'past the due date' : 'nothing late',
      icon: 'alert-triangle', tone: totals.overdue > 0 ? 'danger' : 'success',
    },
    {
      key: 'purchased', label: 'Purchased', count: rupees(totals.purchased),
      subLabel: rangeLabel, icon: 'receipt',
    },
    {
      key: 'drafts', label: 'Drafts', count: totals.drafts,
      subLabel: totals.drafts > 0 ? 'not posted - no stock, no payable' : 'none waiting',
      icon: 'file-text', tone: totals.drafts > 0 ? 'warning' : 'default',
    },
  ];

  const columns: Column<BillVM>[] = [
    {
      key: 'billNo', header: 'Bill', sortValue: (b) => b.billNo,
      render: (b) => (
        <Link href={`/purchase/bills/${b.id}`} className="flex flex-col">
          <span className="font-medium text-brand hover:underline">{b.supplierBillNo}</span>
          <span className="text-xs text-muted-foreground">{b.billNo}</span>
        </Link>
      ),
    },
    {
      key: 'supplier', header: 'Supplier', sortValue: (b) => b.supplierName,
      render: (b) => <SupplierLink id={b.partyId} className="font-medium">{b.supplierName}</SupplierLink>,
    },
    {
      key: 'date', header: 'Date', sortValue: (b) => new Date(b.billDate).getTime(),
      render: (b) => <span className="text-xs">{fmtDate(b.billDate)}</span>,
    },
    {
      key: 'due', header: 'Due', sortValue: (b) => new Date(b.dueDate).getTime(),
      render: (b) => {
        const bucket = ageBucket(new Date(b.dueDate), now);
        const late = b.status === 'overdue';
        return (
          <span className="flex flex-col">
            <span className={`text-xs ${late ? 'font-medium text-danger' : ''}`}>
              {fmtDate(b.dueDate)}
            </span>
            {late && (
              <span className="text-xs text-danger">{AGE_BUCKET_LABEL[bucket]}</span>
            )}
          </span>
        );
      },
    },
    {
      key: 'total', header: 'Total', align: 'end', sortValue: (b) => b.grandTotalPaise,
      render: (b) => <span className="tabular-nums">{rupees(b.grandTotalPaise)}</span>,
    },
    {
      key: 'owed', header: 'Outstanding', align: 'end', sortValue: (b) => b.outstandingPaise,
      render: (b) => (
        b.outstandingPaise > 0
          ? <span className="tabular-nums font-medium">{rupees(b.outstandingPaise)}</span>
          : <span className="text-xs text-muted-foreground">Settled</span>
      ),
    },
    {
      key: 'status', header: 'Status', sortValue: (b) => b.status,
      render: (b) => (b.awaitingApproval ? <Badge tone="warning">Awaiting approval</Badge> : <Badge tone={STATUS_TONE[b.status]}>{BILL_STATUS_LABEL[b.status]}</Badge>),
    },
  ];

  return (
    <>
      <PageHeader
        badge="PB"
        title="Purchase Bills"
        subtitle={`${rangeLabel} · ${rupees(totals.purchased)} purchased · ${rupees(totals.owed)} still owed`}
      />

      {totals.drafts > 0 && (
        <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="flex-1 text-xs leading-relaxed">
            <strong>{totals.drafts} bill{totals.drafts === 1 ? '' : 's'} still in draft.</strong>{' '}
            A draft has not put stock on the shelf and is not counted in what you owe. If the
            goods have arrived, post it - otherwise your stock figures and your payables are
            both short by that much.
          </p>
        </Card>
      )}

      <Toolbar
        primary={
          canEdit ? (
            <Button variant="primary" icon="plus" onClick={() => setShowNew(true)}>
              New bill
            </Button>
          ) : undefined
        }
        filters={
          <>
            {/* The standard date filter, replacing the 30 / 90 days / This
                year chips (9 Oct 2026). Old ?days= links still work. */}
            <DateRangeSelect label="Bill date" />
            <FilterSelect id="bill-supplier" label="Supplier" value={supplier} onChange={setSupplier}
              options={supplierNames.map((v) => ({ value: v, label: v }))} />
          </>
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search supplier, bill number…"
        end={
          <div className="flex items-center gap-2">
            <ServerExportButton screen="bills" />
            {canPay && (
              <Link href="/purchase/payables">
                <Button icon="credit-card">Payables</Button>
              </Link>
            )}
          </div>
        }
      />

      <div className="mb-3">
        <KpiStrip cards={cards} activeKey={cardKey} onSelect={(k) => setCardKey(k === 'purchased' ? null : k)} columns={4} />
      </div>

      <DataGrid
        rows={bills}
        server={paging}
        columns={columns}
        rowKey={(b) => b.id}
        emptyIcon="receipt"
        emptyMessage={total === 0 ? 'No purchase bills yet' : 'No bills match this filter'}
        emptyHint={
          total === 0
            ? 'Enter your first supplier bill to start tracking stock cost and what you owe.'
            : undefined
        }
      />

      {showNew && (
        <NewBillModal
          suppliers={suppliers}
          products={products}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); router.refresh(); }}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------- new bill

function NewBillModal({
  suppliers, products, onClose, onSaved,
}: {
  suppliers: SupplierVM[];
  products: ProductVM[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const [partyId, setPartyId] = useState('');
  const [supplierBillNo, setSupplierBillNo] = useState('');
  const [billDate, setBillDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [freight, setFreight] = useState('0');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The totals are computed HERE with the same function the server uses.
   *
   * Not for correctness - the server recomputes everything and its answer is
   * the one that gets stored, because the client is never trusted with money.
   * This is so the person typing sees the tax and the total change as they
   * type, which is how they notice they have entered 1000 instead of 100.
   */
  const preview = useMemo(() => computeBillTotals(
    lines.map((l) => ({
      qty: Number(l.qty) || 0,
      unitCostPaise: toPaise(l.unitCost),
      discountPct: Number(l.discountPct) || 0,
      taxRatePct: Number(l.taxRatePct) || 0,
    })),
    toPaise(freight),
    // A guess, purely for the preview. The server resolves the real tax mode
    // from the supplier's state and overrules this.
    'IGST',
  ), [lines, freight]);

  const setLine = (i: number, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };

  const pickProduct = (i: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) {
      setLine(i, { productId: null });
      return;
    }
    setLine(i, {
      productId: p.id,
      productName: p.name,
      productCode: p.code,
      hsnCode: p.hsnCode,
    });
  };

  const submit = async (post: boolean) => {
    setBusy(true);
    setError(null);

    const result = await createBillAction({
      partyId,
      supplierBillNo,
      billDate,
      dueDate,
      freightPaise: toPaise(freight),
      notes: notes.trim() || null,
      lines: lines
        .filter((l) => l.productName.trim() && Number(l.qty) > 0)
        .map((l) => ({
          productId: l.productId,
          productName: l.productName.trim(),
          productCode: l.productCode,
          hsnCode: l.hsnCode,
          qty: Number(l.qty),
          unitCostPaise: toPaise(l.unitCost),
          discountPct: Number(l.discountPct) || 0,
          taxRatePct: Number(l.taxRatePct) || 0,
        })),
      post,
    });

    setBusy(false);
    if (result.error) setError(result.error);
    else onSaved();
  };

  const ready = partyId && supplierBillNo.trim()
    && lines.some((l) => l.productName.trim() && Number(l.qty) > 0);

  return (
    <Modal
      title="New purchase bill"
      subtitle="What arrived, what it cost, and when it has to be paid"
      icon="receipt"
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">
            Total <strong className="tabular-nums">{rupees(preview.grandTotalPaise)}</strong>
            <span className="ms-2 text-xs text-muted-foreground">
              incl. {rupees(preview.igstPaise + preview.cgstPaise + preview.sgstPaise)} tax
            </span>
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={() => submit(false)} disabled={!ready || busy} loading={busy}>
              Save draft
            </Button>
            <Button
              variant="primary"
              onClick={() => submit(true)}
              disabled={!ready || busy}
              loading={busy}
            >
              Save &amp; post
            </Button>
          </div>
        </div>
      }
    >
      {error && (
        <Card className="mb-3 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <p className="text-xs leading-relaxed text-danger">{error}</p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Supplier">
          <select
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
          >
            <option value="">Choose a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.isSupplier ? '' : ' (customer)'}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Their bill number"
          hint="What the supplier calls it. Goes on the GST return."
        >
          <input
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={supplierBillNo}
            onChange={(e) => setSupplierBillNo(e.target.value)}
            placeholder="e.g. INV/2026/1184"
          />
        </Field>

        <Field label="Bill date">
          <input
            type="date"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={billDate}
            onChange={(e) => setBillDate(e.target.value)}
          />
        </Field>

        <Field label="Payment due">
          <input
            type="date"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </Field>
      </div>

      <SectionCard title="Items" icon="package" className="mt-4" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 font-semibold">Item</th>
                <th className="px-2 py-2 text-right font-semibold">Qty</th>
                <th className="px-2 py-2 text-right font-semibold">Unit cost ₹</th>
                <th className="px-2 py-2 text-right font-semibold">Disc %</th>
                <th className="px-2 py-2 text-right font-semibold">GST %</th>
                <th className="px-2 py-2 text-right font-semibold">Taxable</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5">
                    <select
                      className="mb-1 w-full rounded-md border border-border bg-card px-2 py-1 text-xs"
                      value={l.productId ?? ''}
                      onChange={(e) => pickProduct(i, e.target.value)}
                    >
                      <option value="">Not in catalogue -</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <input
                      className="w-full rounded-md border border-border bg-card px-2 py-1 text-xs"
                      value={l.productName}
                      onChange={(e) => setLine(i, { productName: e.target.value })}
                      placeholder="Description"
                    />
                  </td>
                  <NumCell value={l.qty} onChange={(v) => setLine(i, { qty: v })} />
                  <NumCell value={l.unitCost} onChange={(v) => setLine(i, { unitCost: v })} />
                  <NumCell value={l.discountPct} onChange={(v) => setLine(i, { discountPct: v })} />
                  <NumCell value={l.taxRatePct} onChange={(v) => setLine(i, { taxRatePct: v })} />
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {rupees(preview.lines[i]?.taxablePaise ?? 0)}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {lines.length > 1 && (
                      <button
                        type="button"
                        className="text-xs text-danger hover:underline"
                        onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border bg-muted/20 px-3 py-2">
          <Button
            size="sm"
            icon="plus"
            onClick={() => setLines((p) => [...p, blankLine()])}
          >
            Add line
          </Button>
        </div>
      </SectionCard>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field
          label="Freight / delivery ₹"
          hint="Spread across the lines by value, so unit costs stay true."
        >
          <input
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={freight}
            onChange={(e) => setFreight(e.target.value)}
            inputMode="decimal"
          />
        </Field>

        <Field label="Notes">
          <input
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
          />
        </Field>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <SummaryRow label="Subtotal" value={rupees(preview.subtotalPaise)} />
        {preview.itemDiscountPaise > 0 && (
          <SummaryRow label="Less discount" value={`− ${rupees(preview.itemDiscountPaise)}`} />
        )}
        {toPaise(freight) > 0 && <SummaryRow label="Freight" value={rupees(toPaise(freight))} />}
        <SummaryRow label="Taxable value" value={rupees(preview.taxableBasePaise)} />
        <SummaryRow
          label="GST"
          value={rupees(preview.igstPaise + preview.cgstPaise + preview.sgstPaise)}
        />
        <SummaryRow label="Total" value={rupees(preview.grandTotalPaise)} strong />
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          The split between IGST and CGST+SGST is decided by the supplier&apos;s state when this
          is saved. This preview assumes IGST; the total does not change either way.
        </p>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        <strong>Save &amp; post</strong> puts the stock on the shelf, records what each item cost
        including its share of freight, and adds the bill to what you owe.
        <strong> Save draft</strong> does none of that - use it if the goods have not arrived yet.
      </p>
    </Modal>
  );
}

function NumCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <td className="px-2 py-1.5">
      <input
        className="w-20 rounded-md border border-border bg-card px-2 py-1 text-right text-xs tabular-nums"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
      />
    </td>
  );
}

