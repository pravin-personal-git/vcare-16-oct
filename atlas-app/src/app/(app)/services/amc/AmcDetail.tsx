'use client';

import { ProductLink } from '@/components/document/ProductLink';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, type BadgeTone } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { AMC_STATUS_LABEL, COVERAGE_TERMS_LABEL } from '@/lib/amc-status';
import { describeAllowance } from '@/lib/amc-offer';
import { loadAmcContractDetailAction } from './actions';

/**
 * Everything known about one contract.
 *
 * Built because the list could tell you a contract existed and nothing else -
 * you could not see what it covered, what had been done under it, what it had
 * renewed from, or whether the fee had been billed. Those are the questions a
 * renewal conversation turns on.
 *
 * Reads through `loadAmcContractDetailAction`, which had been written and left
 * unused - along with `getAmcContractDetail` behind it. This is the screen that
 * was missing, not new server work.
 */

type Detail = Awaited<ReturnType<typeof loadAmcContractDetailAction>>;

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: 'neutral', active: 'success', expired: 'warning', cancelled: 'neutral',
};

const VISIT_TONE: Record<string, BadgeTone> = {
  scheduled: 'info', completed: 'success', cancelled: 'neutral',
};

const fmt = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 border-b border-border/40 pb-2 last:border-b-0">
      <dt className="text-micro uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

export function AmcDetail({
  contractId, onClose, onChanged,
}: {
  contractId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<Detail>(null);
  const [loading, setLoading] = useState(true);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setLoading(true);
    startTransition(async () => {
      setDetail(await loadAmcContractDetailAction(contractId));
      setLoading(false);
    });
    // onChanged is a refresh hook from the parent and is not a dependency of
    // the load itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  return (
    <Modal
      title={detail?.contractNo ?? 'Contract'}
      subtitle={detail ? detail.customerName : undefined}
      icon="receipt"
      size="lg"
      onClose={() => { onClose(); onChanged?.(); }}
      footer={
        <div className="flex items-center justify-end">
          <Button variant="ghost" onClick={() => { onClose(); onChanged?.(); }}>Close</Button>
        </div>
      }
    >
      {loading || !detail ? (
        <EmptyState
          icon="clock"
          title={loading ? 'Loading…' : 'Contract not found'}
          hint={loading ? '' : 'It may have been deleted, or it belongs to another store.'}
        />
      ) : (
        <div className="space-y-5">
          {/* ---- headline state */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[detail.status] ?? 'neutral'}>
              {AMC_STATUS_LABEL[detail.status] ?? detail.status}
            </Badge>
            {detail.isOverdue && detail.status === 'active' && (
              <Badge tone="danger" icon="alert-triangle">
                Lapsed {Math.abs(detail.daysToExpiry)} days ago
              </Badge>
            )}
            {detail.isDue && <Badge tone="warning" icon="clock">{detail.daysToExpiry} days left</Badge>}
            {detail.billing === 'awaiting_invoice' && (
              <Badge tone="danger" icon="receipt">Fee not invoiced</Badge>
            )}
            {detail.billing === 'no_fee' && (
              <Badge tone="neutral">Included in the sale</Badge>
            )}
          </div>

          {/* ---- the visit allowance, the thing that was decorative until now */}
          <section className={`rounded-lg border px-3 py-2.5 ${
            detail.allowance.exceededBy > 0
              ? 'border-danger/30 bg-danger/[0.06]'
              : detail.allowance.exhausted
                ? 'border-warning/30 bg-warning/[0.06]'
                : 'border-border bg-muted/20'
          }`}>
            <p className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
              <Icon name="truck" className="h-3.5 w-3.5" />
              Visits
            </p>
            <p className="mt-1 text-sm font-medium">{describeAllowance(detail.allowance)}</p>
            {detail.allowance.exceededBy > 0 && (
              <p className="mt-1 text-xs text-danger">
                More work has been done than this contract covers. Further visits
                are chargeable, or the contract needs repricing at renewal.
              </p>
            )}
            {!detail.allowance.unlimited && !detail.allowance.exhausted && detail.allowance.remaining === 1 && (
              <p className="mt-1 text-xs text-warning">
                One visit left. Worth mentioning to the customer before the next call.
              </p>
            )}
          </section>

          {/* ---- the facts */}
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <Row label="Customer">
              <Link href={`/customers/${detail.customerId}?via=amc:${contractId}`} className="hover:text-brand">
                {detail.customerName}
              </Link>
              {detail.customerPhone && (
                <span className="block font-mono text-xs text-muted-foreground">{detail.customerPhone}</span>
              )}
            </Row>
            <Row label="Site">{detail.siteLabel ?? <span className="text-muted-foreground">Not stated</span>}</Row>
            <Row label="Period">{fmt(detail.startDate)} to {fmt(detail.endDate)}</Row
            >
            <Row label="Value">
              <span className="font-mono tabular-nums">{formatCurrency(detail.amountPaise)}</span>
            </Row>
            <Row label="What it covers">
              {COVERAGE_TERMS_LABEL[detail.coverageTerms] ?? detail.coverageTerms}
            </Row>
            <Row label="Visits included">
              {detail.visitsIncluded === null ? 'Unlimited' : detail.visitsIncluded}
            </Row>
            <Row label="GST rate">
              {detail.taxRatePct === null
                ? (detail.amountPaise > 0
                  ? <span className="text-warning">Not entered - edit the contract before invoicing</span>
                  : <span className="text-muted-foreground">No fee to tax</span>)
                : <span className="font-mono tabular-nums">{detail.taxRatePct}%</span>}
              {detail.sacCode && (
                <span className="block font-mono text-xs text-muted-foreground">SAC {detail.sacCode}</span>
              )}
            </Row>
            <Row label="Reminder">{detail.reminderDays} days before it ends</Row>
            <Row label="Their old reference">
              {detail.legacyRef ?? <span className="text-muted-foreground">None</span>}
            </Row>
          </dl>

          {/* ---- covered equipment */}
          <section>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
              Equipment covered
            </p>
            {detail.items.length === 0 ? (
              <p className="flex items-start gap-1.5 rounded border border-info/25 bg-info/[0.05] px-2.5 py-1.5 text-xs">
                <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                <span>
                  Nothing listed, so this contract covers the <strong>whole site</strong> -
                  including equipment nobody has matched to the catalogue yet.
                </span>
              </p>
            ) : (
              <ul className="divide-y divide-border rounded border border-border">
                {detail.items.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                    <ProductLink id={i.productId} className="truncate">{i.productName}</ProductLink>
                    <span className="shrink-0 text-muted-foreground">
                      {i.qty > 1 && <>x{i.qty}</>}
                      {i.serialNo && <span className="ms-2 font-mono">{i.serialNo}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- the work actually done */}
          <section>
            <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
              Work done under this contract
            </p>
            {detail.visits.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No visits recorded against it yet. A visit counts once it is
                marked completed, not when it is booked.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded border border-border">
                {detail.visits.map((v) => (
                  <li key={v.id} className="px-2.5 py-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/services/complaints/${v.complaintId}`}
                        className="font-mono font-semibold text-brand hover:underline"
                      >
                        {v.complaintNo}
                      </Link>
                      <Badge tone={VISIT_TONE[v.status] ?? 'neutral'}>{v.status}</Badge>
                      <span className="text-muted-foreground">
                        {v.technicianName} · {fmt(v.completedAt ?? v.scheduledAt)}
                      </span>
                    </div>
                    {v.outcomeNote && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{v.outcomeNote}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---- paper trail */}
          <section className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <Row label="Sold on">
              {detail.originInvoiceId ? (
                <Link href={`/invoices/${detail.originInvoiceId}`} className="font-mono text-xs text-brand hover:underline">
                  {detail.originInvoiceNo}
                </Link>
              ) : <span className="text-muted-foreground">Entered by hand</span>}
            </Row>
            <Row label="Fee invoiced on">
              {detail.invoiceId ? (
                <Link href={`/invoices/${detail.invoiceId}`} className="font-mono text-xs text-brand hover:underline">
                  {detail.invoiceNo}
                </Link>
              ) : detail.billing === 'no_fee'
                ? <span className="text-muted-foreground">No fee</span>
                : <span className="text-danger">Not yet</span>}
            </Row>
            <Row label="Renewed from">
              {detail.renewedFromNo
                ? <span className="font-mono text-xs">{detail.renewedFromNo}</span>
                : <span className="text-muted-foreground">First term</span>}
            </Row>
            <Row label="Renewed into">
              {detail.renewedToNo
                ? <span className="font-mono text-xs">{detail.renewedToNo}</span>
                : <span className="text-muted-foreground">Not yet renewed</span>}
            </Row>
          </section>

          {detail.coverageNote && (
            <section>
              <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                Terms as agreed
              </p>
              <p className="rounded border border-border bg-muted/20 px-2.5 py-2 text-xs">
                {detail.coverageNote}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Snapshotted when this contract was signed - editing the product
                since cannot have changed it.
              </p>
            </section>
          )}

          {detail.notes && (
            <section>
              <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
              <p className="text-xs">{detail.notes}</p>
            </section>
          )}

          {detail.status === 'cancelled' && (
            <p className="flex items-start gap-1.5 rounded border border-danger/25 bg-danger/[0.05] px-2.5 py-2 text-xs">
              <Icon name="ban" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
              <span>
                Cancelled {detail.cancelledAt ? fmt(detail.cancelledAt) : ''}
                {detail.cancelReason ? ` - ${detail.cancelReason}` : ''}
              </span>
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
