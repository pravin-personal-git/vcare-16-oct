'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import Link from 'next/link';
import { sayIfHeld, toast } from '@/lib/held-message';
import { docMessage } from '@/lib/wa-message';
import { openWhatsApp } from '@/lib/wa-open';
import { ENDED_FULFILMENT, HISTORY_REASON_LABEL, canReopen } from '@/lib/history-rules';
import { WithFormOptions } from '@/components/document/WithFormOptions';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { useListParams } from '@/components/ui/useListParams';
import { statusTone } from '@/lib/status-tones';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { PageHeader, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { FilterChip, FilterSelect } from '@/components/ui/Toolbar';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Icon, type IconName } from '@/components/ui/Icon';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import {
  ALL_FULFILMENT, ALL_PAYMENT, PAYMENT_LABEL,
  FULFILMENT_FLOW,
  type FulfilmentStatus, type PaymentStatus,
} from '@/lib/sales-order-status';
import type { SalesOrderRow } from '@/server/sales-orders';
import { SalesOrderForm } from './SalesOrderForm';
import { ConvertQuotation, type ConvertibleQuotation } from './ConvertQuotation';
import { advanceOrder, closeOrder, reopenOrder, removeOrder, getOrderShareLink } from './actions';
import { ViewToggle } from '@/components/ui/ViewToggle';
import { AttachmentBadge } from '@/components/ui/Attachments';
import { countsAsRevenue } from '@/lib/revenue';
import { InstallationJobDialog } from './InstallationJobDialog';
import { DEFAULT_STAGES, nextStages, stageName, type OrderStageConfig } from '@/lib/order-stages';
import { ask } from '@/components/ui/ask';

const FULFILMENT_ICON: Record<FulfilmentStatus, IconName> = {
  booked: 'file-text',
  pending_approval: 'clock',
  confirmed: 'check-circle',
  packed: 'box',
  dispatched: 'truck',
  shipped: 'send',
  delivered: 'check-circle',
  damage_or_lost: 'alert-triangle',
  returned: 'rotate-ccw',
  refunded: 'credit-card',
  hold: 'pause',
  failed: 'x-circle',
  void: 'ban',
};


const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-';

export function SalesOrdersClient({
  rows, paging, counts, extra, money, cardKey, live, rangeLabel, olderLive, canExport, views,
  quotations, storeState, canCreate, canApprove, scopeIsAll, view, canRaiseJob = false,
  filterOptions, picked, stages = DEFAULT_STAGES,
}: {
  /** The branch's order stages (11 Oct 2026): Next step and names follow them. */
  stages?: OrderStageConfig;
  /** Complaint rights: may raise an installation job from an order (workflow slice 9). */
  canRaiseJob?: boolean;
  /** One page, filtered on the server (server/orders-list). */
  paging: ServerPaging;
  counts: { fulfilment: Record<FulfilmentStatus, number>; payment: Record<PaymentStatus, number> };
  extra: { nonInvoiced: number; live: number };
  money: { openValuePaise: number; dueValuePaise: number };
  cardKey: string | null;
  live: boolean;
  rangeLabel: string;
  olderLive: number;
  canExport: boolean;
  views: FilterBarViews;

  rows: SalesOrderRow[];
  quotations: ConvertibleQuotation[];
  storeState: string | null;
  canCreate: boolean;
  canApprove: boolean;
  scopeIsAll: boolean;
  /** Which list the server handed us - Active, or the closed ones. */
  view: 'active' | 'history';
  /** Salesperson, city and courier choices, from the orders in this date range. */
  filterOptions: { salespeople: string[]; cities: string[]; couriers: string[] };
  picked: { salesperson: string | null; city: string | null; courier: string | null };
}) {
  const list = useListParams();
  const router = useRouter();
  const filterKey = cardKey;
  const [formOpen, setFormOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  // G-34: an order opens on its own page, not in a pop-up over the list.
  const openOrder = (id: string) => router.push(`/sales/orders/${id}`);
  const [installFor, setInstallFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    { title: string; message: string; label: string; tone: 'brand' | 'danger'; run: () => void } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const nonInvoiced = extra.nonInvoiced;

  // The original shows one strip of 15. We show the same 15, plus the
  // Non-Invoiced filter from its toolbar, but grouped so it is visible that
  // fulfilment and payment are two different questions about the same order.
  // Ended orders (void, failed, refunded, returned) live in History now
  // (lib/history-rules), so in Active their cards could only read 0. History
  // shows only the cards that have something in them.
  const allCards: KpiCard[] = [
    ...ALL_FULFILMENT.filter((s) => view === 'history' || !(ENDED_FULFILMENT as readonly string[]).includes(s)).map((s) => ({
      key: `fulfilment:${s}`,
      label: stageName(stages, s),
      count: counts.fulfilment[s],
      icon: FULFILMENT_ICON[s],
      tone: (statusTone(s) === 'neutral' ? 'default' : statusTone(s)) as KpiCard['tone'],
    })),
    ...ALL_PAYMENT.filter((s) => s !== 'unpaid').map((s) => ({
      key: `payment:${s}`,
      label: PAYMENT_LABEL[s],
      count: counts.payment[s],
      icon: 'credit-card' as const,
      tone: (s === 'paid' ? 'success' : 'warning') as KpiCard['tone'],
    })),
    {
      key: 'invoice:non_invoiced',
      label: 'Non-Invoiced',
      count: nonInvoiced,
      icon: 'receipt' as const,
      tone: 'navy' as KpiCard['tone'],
    },
  ];
  const cards = view === 'history' ? allCards.filter((c) => Number(c.count) > 0 || c.key === filterKey) : allCards;

  const inProgress = extra.live;
  const openValue = money.openValuePaise;
  const dueValue = money.dueValuePaise;

  const columns: Column<SalesOrderRow>[] = [
    { key: 'orderNo', header: 'Order No', width: '11rem',
      render: (r) => (
        <div>
          <Link href={`/sales/orders/${r.id}`} className="font-mono text-xs font-medium text-brand hover:underline">{r.orderNo}</Link>
          {r.quotationNo && (
            <p className="font-mono text-xs text-muted-foreground">from {r.quotationId
              ? <Link href={`/quotation/${r.quotationId}`} className="hover:text-brand hover:underline">{r.quotationNo}</Link>
              : r.quotationNo}</p>
          )}
        </div>
      ),
      sortValue: (r) => r.orderNo },
    { key: 'customerName', header: 'Customer Name',
      render: (r) => (
        <div className="flex items-start gap-2"><div className="min-w-0">
          <p className="font-medium"><CustomerLink id={r.partyId}>{r.customerName}</CustomerLink></p>
          {r.organizationName && <p className="text-xs text-muted-foreground">{r.organizationName}</p>}
        </div><AttachmentBadge count={r.attachmentCount} /></div>
      ),
      sortValue: (r) => r.customerName },
    { key: 'itemCount', header: 'Items', align: 'end',
      render: (r) => r.itemCount, sortValue: (r) => r.itemCount },
    { key: 'grandTotal', header: 'Total', align: 'end',
      render: (r) => <span className="font-mono text-xs font-semibold">{formatCurrency(r.grandTotalPaise)}</span>,
      sortValue: (r) => r.grandTotalPaise },
    { key: 'due', header: 'Due', align: 'end',
      render: (r) => {
        const d = r.grandTotalPaise - r.amountPaidPaise;
        return <span className={`font-mono text-xs ${d > 0 ? 'text-danger' : 'text-muted-foreground'}`}>
          {formatCurrency(d)}
        </span>;
      },
      sortValue: (r) => r.grandTotalPaise - r.amountPaidPaise },
    { key: 'fulfilmentStatus', header: 'Fulfilment',
      render: (r) => (
        <span className="inline-flex flex-col items-start gap-0.5">
          <StatusBadge status={r.fulfilmentStatus} icon={FULFILMENT_ICON[r.fulfilmentStatus]} label={stageName(stages, r.fulfilmentStatus)} />
          {r.historyReason && <span className="text-micro text-muted-foreground">{HISTORY_REASON_LABEL[r.historyReason]}</span>}
        </span>
      ),
      sortValue: (r) => stageName(stages, r.fulfilmentStatus) },
    { key: 'paymentStatus', header: 'Payment',
      render: (r) => (
        <StatusBadge status={r.paymentStatus === 'unpaid' ? 'overdue' : r.paymentStatus} label={PAYMENT_LABEL[r.paymentStatus]} />
      ),
      sortValue: (r) => PAYMENT_LABEL[r.paymentStatus] },
    { key: 'orderDate', header: 'Ordered', render: (r) => fmtDate(r.orderDate),
      sortValue: (r) => r.orderDate.getTime() },
    { key: 'expectedDeliveryDate', header: 'Expected',
      render: (r) => {
        if (!r.expectedDeliveryDate) return '-';
        const late = new Date(r.expectedDeliveryDate) < new Date()
          && !['delivered', 'void', 'failed', 'refunded'].includes(r.fulfilmentStatus);
        return <span className={`text-xs ${late ? 'text-danger' : ''}`}>
          {fmtDate(r.expectedDeliveryDate)}
        </span>;
      },
      sortValue: (r) => r.expectedDeliveryDate?.getTime() ?? null },
    { key: 'awbNo', header: 'AWB', render: (r) => r.awbNo ?? '-',
      sortValue: (r) => r.awbNo, optional: true },
    { key: 'salespersonName', header: 'Salesperson', render: (r) => r.salespersonName ?? '-',
      sortValue: (r) => r.salespersonName, optional: true },
    { key: 'phone', header: 'Phone',
      render: (r) => <span className="font-mono text-xs">{r.phone}</span>,
      sortValue: (r) => r.phone, optional: true },
  ];

  const move = (r: SalesOrderRow, to: FulfilmentStatus, verb: string, tone: 'brand' | 'danger' = 'brand') =>
    setConfirm({
      title: `${verb} ${r.orderNo}?`,
      message: `${r.customerName} · ${formatCurrency(r.grandTotalPaise)}. This moves the order to ${stageName(stages, to)}.`,
      label: verb,
      tone,
      run: async () => {
        setBusy(true);
        const res = await advanceOrder(r.id, to);
        setBusy(false);
        setConfirm(null);
        if (res.error) await ask.error(res.error);
        else { sayIfHeld(res); window.location.reload(); }
      },
    });

  const forwardOf = (r: SalesOrderRow) => nextStages(r.fulfilmentStatus, stages).find((m) => FULFILMENT_FLOW.includes(m));
  const step = (r: SalesOrderRow) => {
    const moves = nextStages(r.fulfilmentStatus, stages);
    if (moves.length === 0) return void ask.tell({ title: 'This order is finished', message: 'It is closed, so there are no more steps to take.' });
    const next = moves[0];
    if (next === 'confirmed' && !canApprove) {
      return void ask.tell({
        icon: 'lock',
        title: 'Someone with approval rights is needed',
        message: 'Approving an order needs the approve permission. Open the order to see the steps you can take.',
      });
    }
    move(r, next, `Move to ${stageName(stages, next)}`);
  };

  /** Several orders at once (11 Oct 2026): each moves to its own next stage, through the same server rules. */
  const moveMany = async (ids: string[], clear: () => void) => {
    const picked = rows.filter((r) => ids.includes(r.id));
    const plan = picked.map((r) => ({ r, to: forwardOf(r) })).filter((x): x is { r: SalesOrderRow; to: FulfilmentStatus } => !!x.to && (x.to !== 'confirmed' || canApprove));
    if (!plan.length) return void ask.tell({ title: 'Nothing to move', message: 'These orders are closed, or their next step needs the approve permission.' });
    if (!(await ask.confirm({
      icon: 'arrow-right',
      title: `Move ${plan.length} order${plan.length === 1 ? '' : 's'} on?`,
      message: `Each one goes to its own next stage:\n\n${plan.map((x) => `${x.r.orderNo} → ${stageName(stages, x.to)}`).join('\n')}`,
      confirmLabel: plan.length === 1 ? 'Move it' : `Move all ${plan.length}`,
    }))) return;
    setBusy(true);
    const errors: string[] = [];
    for (const x of plan) {
      const res = await advanceOrder(x.r.id, x.to);
      if (res.error) errors.push(`${x.r.orderNo}: ${res.error}`);
    }
    setBusy(false);
    clear();
    if (errors.length) await ask.tell({ tone: 'warning', title: `${errors.length} could not move`, message: `The rest moved on.\n\n${errors.join('\n')}` });
    window.location.reload();
  };

  return (
    <div>
      <PageHeader
        badge="SO"
        title="Sales Orders"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{rows.length} total</span>
            <span className="text-border-strong">·</span>
            <span>{formatCurrencyCompact(openValue)} in progress</span>
            <span className="text-border-strong">·</span>
            <span className={dueValue > 0 ? 'font-medium text-danger' : ''}>
              {formatCurrencyCompact(dueValue)} outstanding
            </span>
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              icon="rotate-ccw"
              disabled={!canCreate}
              title={scopeIsAll ? 'Select a single store first' : undefined}
              onClick={() => setConvertOpen(true)}
            >
              Convert quotation
            </Button>
            <Button
              variant="primary"
              icon="plus"
              disabled={!canCreate}
              title={scopeIsAll ? 'Select a single store first' : undefined}
              onClick={() => setFormOpen(true)}
            >
              Order
            </Button>
          </>
        }
      />

      <FilterBar
        searchPlaceholder="Order no, quotation no, customer, company, phone, AWB…"
        dates={{ defaultPreset: 'all', label: 'Ordered', activeLabel: rangeLabel }}
        extra={
          <>
            <ViewToggle view={view} basePath="/sales/orders" />
            <FilterChip
              label="Inprogress" count={inProgress} icon="truck"
              active={live}
              onClick={() => list.set({ live: live ? null : '1' })}
            />
            <FilterSelect id="so-sp" label="Salesperson" value={picked.salesperson ?? ''}
              onChange={(v) => list.set({ salesperson: v || null })}
              options={filterOptions.salespeople.map((v) => ({ value: v, label: v }))} />
            <FilterSelect id="so-city" label="City" value={picked.city ?? ''}
              onChange={(v) => list.set({ city: v || null })}
              options={filterOptions.cities.map((v) => ({ value: v, label: v }))} />
            <FilterSelect id="so-courier" label="Courier" value={picked.courier ?? ''}
              onChange={(v) => list.set({ courier: v || null })}
              options={filterOptions.couriers.map((v) => ({ value: v, label: v }))} />
          </>
        }
        shown={paging.total}
        clearKeys={['card', 'live', 'salesperson', 'city', 'courier']}
        exportScreen={canExport ? 'orders' : null}
        views={views}
      />

      {olderLive > 0 && (
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <Icon name="alert-triangle" className="h-4 w-4 shrink-0 text-warning" />
          <span><strong>{olderLive.toLocaleString('en-IN')}</strong> order{olderLive === 1 ? ' still in progress is' : 's still in progress are'} dated before this range.</span>
          <button type="button" onClick={() => list.set({ range: 'all' })} className="font-medium text-brand hover:underline">Show all dates</button>
        </p>
      )}

      <KpiStrip cards={cards} activeKey={filterKey} onSelect={(k) => list.set({ card: k })} columns={8} />

      <DataGrid
        rows={rows}
        server={paging}
        columns={columns}
        rowKey={(r) => r.id}
        bulkActions={canCreate ? (ids, clear) => (
          <Button size="sm" variant="primary" icon="arrow-right" disabled={busy} onClick={() => moveMany(ids, clear)}>Move to next stage ({ids.length})</Button>
        ) : undefined}
        mobileCard={(r) => (
          <button type="button" onClick={() => openOrder(r.id)} className="block w-full text-start">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-brand">{r.orderNo}</span>
              <StatusBadge status={r.fulfilmentStatus} label={stageName(stages, r.fulfilmentStatus)} />
            </div>
            <p className="mt-1 truncate text-sm font-medium">{r.customerName}</p>
            <p className="flex justify-between text-xs text-muted-foreground">
              <span>{fmtDate(r.orderDate)} · {PAYMENT_LABEL[r.paymentStatus]}</span>
              <span className="font-mono tabular-nums">{formatCurrency(r.grandTotalPaise)}</span>
            </p>
          </button>
        )}
        emptyIcon="shopping-cart"
        emptyMessage={
          filterKey
            ? 'No orders match this card.'
            : view === 'history'
              ? 'No finished, ended or closed orders in this range.'
              : 'No open sales orders.'
        }
        emptyHint={
          filterKey
            ? 'Clear the card to see every order.'
            : view === 'history'
              ? 'Orders come here on their own once delivered, invoiced and fully paid, or when cancelled, failed, refunded or returned. Ones you close by hand come here too.'
              : 'Convert an accepted quotation, or raise an order directly for a walk-in customer.'
        }
        /* Inherits the shared sizes - this list holds every order now. */
        pageSummary={(pageRows) => (
          <>
            <span className="text-muted-foreground">
              Sales Count:{' '}
              <strong className="text-foreground">{pageRows.length}</strong>
            </span>
            <span className="text-muted-foreground">
              Page Total:{' '}
              <strong className="font-mono text-foreground">
                {formatCurrency(pageRows.reduce((n, r) => n + r.grandTotalPaise, 0))}
              </strong>
            </span>
            <span className="text-muted-foreground">
              Page Due:{' '}
              <strong className="font-mono text-danger">
                {formatCurrency(pageRows.reduce((n, r) => n + (r.grandTotalPaise - r.amountPaidPaise), 0))}
              </strong>
            </span>
          </>
        )}
        actions={[
          { label: 'Open / Print', icon: 'eye', onSelect: (r) => openOrder(r.id) },
          { label: 'Next step', icon: 'chevron-right', onSelect: step },
          ...(canRaiseJob && !scopeIsAll ? [{
            label: 'Create installation job', icon: 'map-pin' as const,
            enabled: (r: SalesOrderRow) => !['void', 'failed', 'returned', 'refunded'].includes(r.fulfilmentStatus),
            onSelect: (r: SalesOrderRow) => setInstallFor(r.id),
          }] : []),
          {
            label: 'Raise invoice',
            icon: 'receipt',
            separatorBefore: true,
            enabled: (r) => !r.isInvoiced && countsAsRevenue(r.fulfilmentStatus),
            onSelect: () => { window.location.href = '/invoices'; },
          },
          {
            label: 'Put on hold',
            icon: 'pause',
            separatorBefore: true,
            enabled: (r) => nextStages(r.fulfilmentStatus, stages).includes('hold'),
            onSelect: (r) => move(r, 'hold', 'Put on hold'),
          },
          {
            label: 'Send WhatsApp', icon: 'whatsapp', iconTone: 'success', separatorBefore: true,
            // The order's customer link and one wording (A1/A2) - no price (W2).
            onSelect: async (r) => {
              const err = await openWhatsApp(r.phone, async () => {
                const l = await getOrderShareLink(r.id);
                if (l.error || !l.url) return { error: l.error ?? 'Could not create a link.' };
                return docMessage({ kind: 'order', number: r.orderNo, customerName: r.customerName, status: stageName(stages, r.fulfilmentStatus) ?? r.fulfilmentStatus, url: l.url });
              });
              if (err) toast(err);
            },
          },
          {
            label: 'Download PDF', icon: 'printer',
            onSelect: (r) => openOrder(r.id),
          },
          {
            label: 'Cancel order',
            icon: 'ban',
            tone: 'danger',
            separatorBefore: true,
            enabled: (r) => nextStages(r.fulfilmentStatus, stages).includes('void'),
            onSelect: (r) => move(r, 'void', 'Cancel order', 'danger'),
          },
          {
            label: view === 'history' ? 'Reopen Order' : 'Close Order',
            icon: view === 'history' ? 'rotate-ccw' : 'lock',
            // Only one closed by hand can come back; the rest are here because
            // of what they are.
            enabled: (r) => view !== 'history' || canReopen(r.historyReason),
            onSelect: async (r) => {
              const res = view === 'history' ? await reopenOrder(r.id) : await closeOrder(r.id);
              if (res.error) await ask.error(res.error);
              else window.location.reload();
            },
          },
          {
            label: 'Delete Order', icon: 'trash', tone: 'danger', separatorBefore: true,
            // Only while it is still Booked, unpaid and uninvoiced. The server
            // checks all three; this just keeps the item from looking available.
            enabled: (r) => r.fulfilmentStatus === 'booked' && r.amountPaidPaise === 0 && !r.isInvoiced,
            onSelect: async (r) => {
              if (!(await ask.confirm({
                tone: 'danger', icon: 'trash',
                title: `Delete ${r.orderNo}?`,
                message: 'It is still booked, unpaid and not invoiced, so it can be removed. It cannot be brought back.',
                confirmLabel: 'Delete order', cancelLabel: 'Keep it',
              }))) return;
              const res = await removeOrder(r.id);
              if (res.error) await ask.error(res.error);
              else window.location.reload();
            },
          },
        ]}
      />

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground shadow-card">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <span>
          Fulfilment and payment are tracked separately - an order can be
          delivered and still part-paid, so each order is counted on both rows of
          cards. Payment status is worked out from money received, never chosen
          by hand. Invoicing (A069) is the next module.
        </span>
      </p>

      {installFor && <InstallationJobDialog salesOrderId={installFor} onClose={() => setInstallFor(null)} />}

      {convertOpen && (
        <ConvertQuotation quotations={quotations} onClose={() => setConvertOpen(false)} />
      )}

      {formOpen && (
        <WithFormOptions need={['catalogue']} onClose={() => setFormOpen(false)}>
          {(o) => (
            <SalesOrderForm parties={o.buyers} products={o.catalogue}
              storeState={storeState} onClose={() => setFormOpen(false)} />
          )}
        </WithFormOptions>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          tone={confirm.tone}
          busy={busy}
          onConfirm={confirm.run}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
