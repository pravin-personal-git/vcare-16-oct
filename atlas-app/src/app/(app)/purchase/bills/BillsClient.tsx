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
  AGE_BUCKET_LABEL, BILL_STATUS_LABEL, ageBucket,
  type BillStatus,
} from '@/lib/purchase';
import { NewBillModal } from './NewBillModal';

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


const rupees = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' });


const STATUS_TONE: Record<BillStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  unpaid: 'info',
  part_paid: 'warning',
  paid: 'success',
  overdue: 'danger',
  cancelled: 'neutral',
};


export function BillsClient({
  rangeLabel, bills, canEdit, canPay, paging, total, totals, supplierNames, card, supplier, unbilled = [], awaited = 0,
}: {
  /** Goods receipts not yet billed (28 Oct 2026) - the loop the bill form closes. */
  unbilled?: { id: string; grnNo: string; supplierName: string; receivedDate: string; valuePaise: number }[];
  /** Posted bills whose goods are still to come. */
  awaited?: number;
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
  const [toast, setToast] = useState<string | null>(null);

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

      {(unbilled.length > 0 || awaited > 0) && (
        <Card className="mb-3 border-info/30 bg-info/[0.05] px-3 py-2.5">
          {awaited > 0 && (
            <p className="text-xs"><Icon name="clock" className="me-1 inline h-3.5 w-3.5" /><strong>{awaited} bill{awaited === 1 ? '' : 's'} with goods still to come.</strong> Open the bill and press Receive goods when they arrive.</p>
          )}
          {unbilled.length > 0 && (
            <div className="mt-1 text-xs">
              <Icon name="package" className="me-1 inline h-3.5 w-3.5" /><strong>{unbilled.length} goods receipt{unbilled.length === 1 ? '' : 's'} not billed yet</strong> - stock is in, nothing owed. Enter the supplier&apos;s bill and pick the receipt under &ldquo;Against&rdquo;:{' '}
              {unbilled.slice(0, 6).map((g, k) => (
                <span key={g.id}>{k ? ', ' : ''}<Link href={`/goods-receipt?open=${g.id}`} className="font-mono text-brand hover:underline">{g.grnNo}</Link> {g.supplierName} {rupees(g.valuePaise)}</span>
              ))}
              {unbilled.length > 6 ? ` and ${unbilled.length - 6} more` : ''}
            </div>
          )}
        </Card>
      )}

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
          onClose={() => setShowNew(false)}
          onSaved={(msg) => { setShowNew(false); setToast(msg); setTimeout(() => setToast(null), 5000); router.refresh(); }}
        />
      )}
      {toast && <div role="status" className="fixed bottom-5 start-1/2 z-[60] -translate-x-1/2 rounded bg-foreground px-4 py-3 text-sm text-background shadow-raised">{toast}</div>}
    </>
  );
}
