'use client';

import type { CustomerPrefill } from '@/server/customer-prefill';
import { CustomerLink } from '@/components/document/CustomerLink';
import { sayIfHeld, toast } from '@/lib/held-message';
import { HISTORY_REASON_LABEL, canReopen } from '@/lib/history-rules';
import { WithFormOptions } from '@/components/document/WithFormOptions';
import Link from 'next/link';
import { useState } from 'react';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { useListParams } from '@/components/ui/useListParams';
import { statusTone } from '@/lib/status-tones';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { FilterChip, FilterSelect } from '@/components/ui/Toolbar';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Icon, type IconName } from '@/components/ui/Icon';
import { AttachmentBadge } from '@/components/ui/Attachments';
import { ViewToggle } from '@/components/ui/ViewToggle';
import { docMessage } from '@/lib/wa-message';
import { openWhatsApp } from '@/lib/wa-open';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import { type QuotationStatus } from '@/lib/quotation-totals';
import type { QuotationRow } from '@/server/quotations';
import { QuotationForm } from './QuotationForm';
import { changeStatus, getShareLink, closeQuotation, reopenQuotation, removeQuotation } from './actions';
import { convertQuotation } from '../sales/orders/actions';
import { ask } from '@/components/ui/ask';


const STATUS_ICON: Record<QuotationStatus, IconName> = {
  draft: 'file-text',
  sent: 'send',
  accepted: 'check-circle',
  rejected: 'x-circle',
  converted: 'shopping-cart',
  expired: 'clock',
};

const STATUS_LABEL: Record<QuotationStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  rejected: 'Rejected',
  converted: 'Converted to Order',
  expired: 'Expired',
};

const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function QuotationClient({
  rows, paging, counts, bySource, card, source, rangeLabel, olderOpen, openValuePaise, canExport, views,
  storeState, categories, canAddProduct, canCreate, scopeIsAll, view, filterOptions, picked, forCustomer = null,
}: {
  /** From `?customer=<id>` (G-39): a new quotation already made out to this customer. */
  forCustomer?: CustomerPrefill | null;
  /** One page, filtered on the server (server/quotations-list); expiry already applied. */
  rows: QuotationRow[];
  paging: ServerPaging;
  counts: Record<QuotationStatus, number>;
  bySource: { lead: number; customer: number };
  card: QuotationStatus | null;
  source: 'lead' | 'customer' | null;
  rangeLabel: string;
  olderOpen: number;
  openValuePaise: number;
  canExport: boolean;
  views: FilterBarViews;
  storeState: string | null;
  categories: { id: string; name: string; codePrefix: string | null }[];
  canAddProduct: boolean;
  canCreate: boolean;
  scopeIsAll: boolean;
  /** Which list the server handed us - Active, or the closed ones. */
  view: 'active' | 'history';
  /** Salesperson and city choices, from the quotations in this date range. */
  filterOptions: { salespeople: string[]; cities: string[] };
  picked: { salesperson: string | null; city: string | null };
}) {
  const list = useListParams();
  const filter = card;
  // G-27: a lead's "Quotation" button lands here with ?lead=<id> - the new form opens for that lead.
  const forLead = list.get('lead');
  const [formOpen, setFormOpen] = useState(!!forLead || !!forCustomer);
  const [editId, setEditId] = useState<string | null>(null);
  const [convertTarget, setConvertTarget] =
    useState<{ id: string; no: string; total: number } | null>(null);
  const [converting, setConverting] = useState(false);

  const withStatus = rows;
  const count = (st: QuotationStatus) => counts[st] ?? 0;

  // Each list shows the cards that can have something in it. Converted and
  // rejected quotations live in History now (lib/history-rules), so in Active
  // those two cards could only ever read 0. History shows them, plus any other
  // status a hand-closed quotation was left in.
  const shown: QuotationStatus[] = view === 'history'
    ? (['converted', 'rejected', 'draft', 'sent', 'accepted', 'expired'] as QuotationStatus[])
      .filter((s) => s === 'converted' || s === 'rejected' || count(s) > 0)
    : ['draft', 'sent', 'accepted', 'expired'];
  const cards: KpiCard[] = shown.map((s) => ({
    key: s,
    label: STATUS_LABEL[s],
    count: count(s),
    icon: STATUS_ICON[s],
    tone: (statusTone(s) === 'neutral' ? 'default' : statusTone(s)) as KpiCard['tone'],
  }));

  const openValue = openValuePaise;

  // Column order follows the reference: who, then which document, then how to
  // reach them, then the money. Leading with the document number reads as
  // filing; leading with the customer reads as a list of people you are
  // selling to, which is what it is.
  const columns: Column<typeof withStatus[number]>[] = [
    { key: 'customerName', header: 'Customer Name',
      render: (r) => (
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium"><CustomerLink id={r.partyId}>{r.customerName}</CustomerLink></p>
            {r.organizationName && (
              <p className="truncate text-xs text-muted-foreground">{r.organizationName}</p>
            )}
          </div>
          <AttachmentBadge count={r.attachmentCount} />
        </div>
      ),
      sortValue: (r) => r.customerName },
    { key: 'quotationNo', header: 'Quotation No', width: '12rem',
      render: (r) => (
        <Link
          href={`/quotation/${r.id}`}
          className="font-mono text-xs font-semibold text-brand hover:underline"
        >
          {r.quotationNo}
        </Link>
      ),
      sortValue: (r) => r.quotationNo },
    { key: 'email', header: 'Email ID',
      render: (r) => r.email
        ? <span className="block max-w-[12rem] truncate text-xs">{r.email}</span>
        : <span className="text-muted-foreground">-</span>,
      sortValue: (r) => r.email ?? '' },
    { key: 'phone', header: 'Phone',
      render: (r) => <span className="font-mono text-xs">{r.phone}</span>,
      sortValue: (r) => r.phone },
    { key: 'city', header: 'City', render: (r) => r.city ?? '-',
      sortValue: (r) => r.city ?? '' },
    { key: 'state', header: 'State', render: (r) => r.state ?? '-',
      sortValue: (r) => r.state ?? '', optional: true },
    { key: 'source', header: 'From',
      render: (r) => (
        <Badge
          tone={r.source === 'lead' ? 'warning' : r.source === 'customer' ? 'brand' : 'neutral'}
          icon={r.source === 'lead' ? 'user-plus' : r.source === 'customer' ? 'users' : 'file-text'}
        >
          {r.source === 'lead' ? 'Lead' : r.source === 'customer' ? 'Customer' : 'Direct'}
        </Badge>
      ),
      sortValue: (r) => r.source },
    { key: 'itemCount', header: 'Items', align: 'end',
      render: (r) => r.itemCount, sortValue: (r) => r.itemCount },
    { key: 'grandTotal', header: 'Total', align: 'end',
      render: (r) => <span className="font-mono text-xs font-semibold">{formatCurrency(r.grandTotalPaise)}</span>,
      sortValue: (r) => r.grandTotalPaise },
    { key: 'quotationDate', header: 'Date', render: (r) => fmtDate(r.quotationDate),
      sortValue: (r) => r.quotationDate.getTime() },
    { key: 'validUntil', header: 'Valid Until',
      render: (r) => {
        const gone = new Date(r.validUntil) < new Date();
        return <span className={`text-xs ${gone ? 'text-danger' : ''}`}>{fmtDate(r.validUntil)}</span>;
      },
      sortValue: (r) => r.validUntil.getTime() },
    { key: 'status', header: 'Status',
      render: (r) => (
        <span className="inline-flex flex-col items-start gap-0.5">
          <StatusBadge status={r.status === 'converted' ? 'done' : r.status} label={STATUS_LABEL[r.status]} icon={STATUS_ICON[r.status]} />
          {r.historyReason && <span className="text-micro text-muted-foreground">{HISTORY_REASON_LABEL[r.historyReason]}</span>}
          {r.awaitingApproval && <Badge tone="warning">Awaiting approval</Badge>}
        </span>
      ),
      sortValue: (r) => STATUS_LABEL[r.status] },
    { key: 'salespersonName', header: 'Salesperson', render: (r) => r.salespersonName ?? '-',
      sortValue: (r) => r.salespersonName, optional: true },
  ];

  const move = async (id: string, status: QuotationStatus) => {
    const r = await changeStatus(id, status);
    if (r.error) await ask.error(r.error);
    else { sayIfHeld(r); window.location.reload(); }
  };

  /**
   * Send the quotation to the customer.
   *
   * Hands off to WhatsApp or the mail client rather than sending anything
   * itself. The reference does the same, and it is the right call for a
   * small business: messages go from the salesperson's own number and land in
   * their own sent folder, so the customer replies to a human rather than to
   * noreply@.
   */
  const share = async (r: QuotationRow, via: 'whatsapp' | 'email') => {
    if (via === 'whatsapp') {
      // One wording for every document (lib/wa-message, A1 11 Oct 2026).
      const err = await openWhatsApp(r.phone, async () => {
        const res = await getShareLink(r.id);
        if (res.error || !res.url) return { error: res.error ?? 'Could not create a link.' };
        return docMessage({
          kind: 'quotation', number: r.quotationNo, customerName: r.customerName,
          amountPaise: r.grandTotalPaise, validUntil: r.validUntil, url: res.url,
        });
      });
      if (err) toast(err);
      return;
    }

    const res = await getShareLink(r.id);
    if (res.error || !res.url) return toast(res.error ?? 'Could not create a link.');
    const money = formatCurrency(r.grandTotalPaise);
    if (!r.email) return toast(`${r.customerName} has no email address on file.`);
    const subject = `Quotation ${r.quotationNo}`;
    const body = `Dear ${r.customerName},\n\nPlease find our quotation ${r.quotationNo} for ${money}, valid until ${fmtDate(r.validUntil)}.\n\n${res.url}\n\nRegards`;
    window.location.href =
      `mailto:${r.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };


  return (
    <div>
      <PageHeader
        badge="QT"
        title="Quotation"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{paging.total.toLocaleString('en-IN')} in {rangeLabel}</span>
            <span className="text-border-strong">·</span>
            <span>{formatCurrencyCompact(openValue)} open value</span>
          </span>
        }
        actions={
          <Button
            variant="primary"
            icon="plus"
            disabled={!canCreate}
            title={scopeIsAll ? 'Select a single store first' : undefined}
            onClick={() => setFormOpen(true)}
          >
            Quotation
          </Button>
        }
      />

      <FilterBar
        searchPlaceholder="Quotation no, customer, company, phone, email, city…"
        dates={{ defaultPreset: 'all', label: 'Dated', activeLabel: rangeLabel }}
        extra={
          <>
            <ViewToggle view={view} basePath="/quotation" />
            <FilterChip
              label="Customers" count={bySource.customer} icon="users"
              active={source === 'customer'}
              onClick={() => list.set({ source: source === 'customer' ? null : 'customer' })}
            />
            <FilterChip
              label="Lead" count={bySource.lead} icon="user-plus"
              active={source === 'lead'}
              onClick={() => list.set({ source: source === 'lead' ? null : 'lead' })}
            />
            <FilterSelect id="qt-sp" label="Salesperson" value={picked.salesperson ?? ''}
              onChange={(v) => list.set({ salesperson: v || null })}
              options={filterOptions.salespeople.map((v) => ({ value: v, label: v }))} />
            <FilterSelect id="qt-city" label="City" value={picked.city ?? ''}
              onChange={(v) => list.set({ city: v || null })}
              options={filterOptions.cities.map((v) => ({ value: v, label: v }))} />
          </>
        }
        shown={paging.total}
        clearKeys={['card', 'source', 'salesperson', 'city']}
        exportScreen={canExport ? 'quotations' : null}
        views={views}
      />

      {olderOpen > 0 && (
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <Icon name="alert-triangle" className="h-4 w-4 shrink-0 text-warning" />
          <span><strong>{olderOpen.toLocaleString('en-IN')}</strong> draft or sent quotation{olderOpen === 1 ? ' is' : 's are'} dated before this range.</span>
          <button type="button" onClick={() => list.set({ range: 'all' })} className="font-medium text-brand hover:underline">Show all dates</button>
        </p>
      )}

      <KpiStrip cards={cards} activeKey={filter} onSelect={(k) => list.set({ card: k })} columns={6} />

      <DataGrid
        rows={withStatus} server={paging} columns={columns} rowKey={(r) => r.id}
        mobileCard={(r) => (
          <Link href={`/quotation/${r.id}`} className="block">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-brand">{r.quotationNo}</span>
              <StatusBadge status={r.status === 'converted' ? 'done' : r.status} label={STATUS_LABEL[r.status]} />
            </div>
            <p className="mt-1 truncate text-sm font-medium">{r.customerName}</p>
            <p className="flex justify-between text-xs text-muted-foreground">
              <span>{fmtDate(r.quotationDate)} · valid to {fmtDate(r.validUntil)}</span>
              <span className="font-mono tabular-nums">{formatCurrency(r.grandTotalPaise)}</span>
            </p>
          </Link>
        )}
        emptyIcon="file-text"
        emptyMessage={
          filter
            ? 'No quotations with this status.'
            : view === 'history'
              ? 'No converted, rejected or closed quotations in this range.'
              : 'No open quotations.'
        }
        emptyHint={
          filter
            ? 'Clear the card to see every quotation.'
            : view === 'history'
              ? 'Converted and rejected quotations come here on their own, and so does any you close by hand. Expired ones stay in Active until you close them.'
              : 'Raise one against a lead or an existing customer - line items, GST and totals are worked out for you.'
        }
        /* Inherits the shared sizes - this list holds every quotation now. */
        pageSummary={(pageRows) => (
          <>
            <span className="text-muted-foreground">
              Count: <strong className="text-foreground">{pageRows.length}</strong>
            </span>
            <span className="text-muted-foreground">
              Page Total:{' '}
              <strong className="font-mono text-foreground">
                {formatCurrency(pageRows.reduce((n, r) => n + r.grandTotalPaise, 0))}
              </strong>
            </span>
          </>
        )}
        actions={[
          { label: 'View Quotation', icon: 'eye', iconTone: 'brand',
            onSelect: (r) => { window.location.href = `/quotation/${r.id}`; } },
          {
            label: 'Edit Details', icon: 'pencil',
            enabled: (r) => r.status !== 'converted' && !r.closedAt,
            onSelect: (r) => setEditId(r.id),
          },
          {
            label: 'View Lead', icon: 'user-plus',
            enabled: (r) => !!r.leadId,
            onSelect: (r) => { window.location.href = `/crm/leads?open=${r.leadId}`; },
          },
          {
            label: 'View Customer', icon: 'users',
            enabled: (r) => !!r.partyId,
            onSelect: (r) => { window.location.href = `/customers?open=${r.partyId}`; },
          },

          {
            label: 'Send WhatsApp', icon: 'whatsapp', iconTone: 'success', separatorBefore: true,
            onSelect: (r) => share(r, 'whatsapp'),
          },
          { label: 'Send Email', icon: 'mail', iconTone: 'warning', onSelect: (r) => share(r, 'email') },
          {
            label: 'Download PDF', icon: 'printer',
            onSelect: (r) => window.open(`/quotation/${r.id}?print=1`, '_blank'),
          },
          {
            label: 'Copy share link', icon: 'copy',
            onSelect: async (r) => {
              const res = await getShareLink(r.id);
              if (res.error || !res.url) return toast(res.error ?? 'Could not create a link.');
              const copied = await navigator.clipboard.writeText(res.url).then(() => true, () => false);
              toast(copied ? `Link copied - anyone with it can view the quotation: ${res.url}` : res.url);
            },
          },

          {
            label: 'Mark as Sent', icon: 'send', separatorBefore: true,
            enabled: (r) => r.status === 'draft' && !r.closedAt,
            onSelect: (r) => move(r.id, 'sent'),
          },
          {
            label: 'Mark Accepted', icon: 'check-circle', iconTone: 'success',
            enabled: (r) => ['draft', 'sent', 'expired'].includes(r.status) && !r.closedAt,
            onSelect: (r) => move(r.id, 'accepted'),
          },
          {
            label: 'Mark Rejected', icon: 'x-circle', iconTone: 'danger',
            enabled: (r) => !['converted', 'rejected'].includes(r.status) && !r.closedAt,
            onSelect: (r) => move(r.id, 'rejected'),
          },
          {
            label: 'Convert to Order', icon: 'shopping-cart', iconTone: 'brand', separatorBefore: true,
            enabled: (r) => !['converted', 'rejected'].includes(r.status) && !r.closedAt,
            onSelect: (r) =>
              setConvertTarget({ id: r.id, no: r.quotationNo, total: r.grandTotalPaise }),
          },
          {
            label: view === 'history' ? 'Reopen Quotation' : 'Close Quotation',
            icon: view === 'history' ? 'rotate-ccw' : 'lock',
            // Only one closed by hand can come back. A converted or rejected
            // quotation is in History because of what it is.
            enabled: (r) => view !== 'history' || canReopen(r.historyReason),
            onSelect: async (r) => {
              const res = view === 'history' ? await reopenQuotation(r.id) : await closeQuotation(r.id);
              if (res.error) await ask.error(res.error);
              else window.location.reload();
            },
          },
          {
            label: 'Delete Quotation', icon: 'trash', tone: 'danger', separatorBefore: true,
            // Only a draft can go. The server checks this too - the disabled
            // item is a courtesy, the throw is the rule.
            enabled: (r) => r.status === 'draft',
            onSelect: async (r) => {
              if (!(await ask.confirm({
                tone: 'danger', icon: 'trash',
                title: `Delete draft ${r.quotationNo}?`,
                message: 'This draft was never sent, so it can be removed. It cannot be brought back.',
                confirmLabel: 'Delete draft', cancelLabel: 'Keep it',
              }))) return;
              const res = await removeQuotation(r.id);
              if (res.error) await ask.error(res.error);
              else window.location.reload();
            },
          },
        ]}
      />

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground shadow-card">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <span>
          Open a quotation to view, print or save it as PDF, and to send it on
          WhatsApp. Expiry is worked out live from the validity date. Converting
          to an order copies the lines across and locks the quotation. A
          server-rendered PDF (A061) is still to come.
        </span>
      </p>

      {convertTarget && (
        <ConfirmDialog
          title={`Convert ${convertTarget.no} to an order?`}
          confirmLabel="Create order"
          busy={converting}
          onClose={() => setConvertTarget(null)}
          onConfirm={async () => {
            setConverting(true);
            const res = await convertQuotation(convertTarget.id, {
              expectedDeliveryDate: null, requiresApproval: false,
            });
            setConverting(false);
            if (res.error) { await ask.error(res.error); setConvertTarget(null); return; }
            window.location.href = '/sales/orders';
          }}
          message={
            <>
              <p>
                Line items and prices worth{' '}
                <strong>{formatCurrency(convertTarget.total)}</strong> are copied
                across to a new sales order.
              </p>
              <p className="mt-2 text-muted-foreground">
                The quotation is then locked, so the numbers the customer agreed
                to cannot change afterwards.
              </p>
            </>
          }
        />
      )}

      {editId && (
        <WithFormOptions need={['catalogue']} onClose={() => setEditId(null)}>
          {(o) => (
            <QuotationForm
              parties={o.buyers} leads={o.leads} products={o.catalogue}
              storeState={storeState} categories={categories}
              canAddProduct={canAddProduct}
              editQuotationId={editId}
              onClose={() => setEditId(null)}
            />
          )}
        </WithFormOptions>
      )}

      {formOpen && (
        <WithFormOptions need={['catalogue']} onClose={() => setFormOpen(false)}>
          {(o) => (
            <QuotationForm
              parties={o.buyers} leads={o.leads} products={o.catalogue}
              storeState={storeState} categories={categories}
              canAddProduct={canAddProduct} onClose={() => { setFormOpen(false); if (forLead || forCustomer) list.set({ lead: null, customer: null }); }}
              forLeadId={forLead ?? undefined}
              forCustomer={forCustomer ?? undefined}
            />
          )}
        </WithFormOptions>
      )}
    </div>
  );
}
