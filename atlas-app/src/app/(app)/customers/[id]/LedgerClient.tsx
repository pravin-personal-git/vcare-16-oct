'use client';

import { DetailHeader } from '@/components/document/DetailHeader';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import { whatsappLink } from '@/lib/revenue';
import { waMoney } from '@/lib/wa-message';
import type { CustomerLedger } from '@/server/customer-ledger';
import { istDate } from '@/lib/date-ranges';

/**
 * A customer's account.
 *
 * Two columns of money, not one signed number. Debit and credit in separate
 * columns is how every accountant in India reads a ledger, and a single column
 * with minus signs is the thing that makes them ask for it in Excel instead.
 *
 * The running balance is on every row, because the question is rarely "what is
 * the total" - it is "when did it get to this".
 */

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

const inputDate = (d: Date | string | null) =>
  d ? istDate(new Date(d)) : '';

/** A customer's maintenance contracts, as they cross the server boundary. */
export interface CustomerAmcRow {
  id: string;
  contractNo: string;
  status: string;
  startDate: string;
  endDate: string;
  amountPaise: number;
  daysToExpiry: number;
  isDue: boolean;
  isOverdue: boolean;
  billing: 'no_fee' | 'awaiting_invoice' | 'invoiced';
  coveredProducts: string[];
  allowance: {
    used: number; included: number | null; remaining: number | null;
    exhausted: boolean; exceededBy: number; unlimited: boolean;
  };
}

export function LedgerClient({
  ledger, amcContracts = [], embedded = false,
}: {
  ledger: CustomerLedger;
  amcContracts?: CustomerAmcRow[];
  /** G-39: the Ledger tab of the customer page - no page header of its own. */
  embedded?: boolean;
}) {
  const {
    party, lines, openingPaise, closingPaise, totals, cancelled, oldestUnpaid,
    onAccountPaise, failedReceipts,
  } = ledger;
  const [from, setFrom] = useState(inputDate(ledger.from));
  const [to, setTo] = useState(inputDate(ledger.to));

  const apply = () => {
    // Keeps the tab and where the page was opened from (G-39).
    const q = new URLSearchParams(embedded ? window.location.search : '');
    q.delete('from'); q.delete('to');
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (embedded) q.set('tab', 'ledger');
    window.location.href = `/customers/${party.id}${q.toString() ? `?${q}` : ''}`;
  };

  const owes = closingPaise > 0;
  const inCredit = closingPaise < 0;

  const statementText = () => {
    const period = ledger.from && ledger.to
      ? ` for ${fmtDate(ledger.from)} to ${fmtDate(ledger.to)}`
      : '';
    return owes
      ? `Dear ${party.name},\n\nYour account statement${period}: ${waMoney(closingPaise)} is outstanding.\n\nRegards`
      : `Dear ${party.name},\n\nYour account${period} is fully settled. Thank you.\n\nRegards`;
  };

  return (
    <div>
      {embedded ? (
        <div className="mb-3 flex flex-wrap justify-end gap-2 print:hidden">
          <Button variant="outline" icon="printer" onClick={() => window.print()}>Statement PDF</Button>
          <Button variant="outline" icon="whatsapp" onClick={() => window.open(whatsappLink(party.phone, statementText()), '_blank')}>Send on WhatsApp</Button>
        </div>
      ) : (
      <DetailHeader
        icon="user"
        kind="Customer"
        number={party.company ?? party.name}
        status={owes ? { label: `${formatCurrency(closingPaise)} owed`, tone: 'warning' }
          : inCredit ? { label: `${formatCurrency(-closingPaise)} in credit`, tone: 'info' } : { label: 'Settled', tone: 'success' }}
        facts={[
          { label: 'Code', value: party.partyCode },
          { label: 'Phone', value: party.phone },
          { label: 'GSTIN', value: party.gstin },
          { label: 'City', value: party.city },
        ]}
        backHref="/customers"
        backLabel="Customers"
        actions={
          <>
            <Button variant="outline" icon="printer" onClick={() => window.print()}>
              Print statement
            </Button>
            <Button
              variant="outline" icon="whatsapp"
              onClick={() => window.open(whatsappLink(party.phone, statementText()), '_blank')}
            >
              WhatsApp
            </Button>
          </>
        }
      />
      )}

      {/* ---- headline ------------------------------------------------------ */}
      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Closing balance"
          value={formatCurrency(Math.abs(closingPaise))}
          note={owes ? 'they owe this' : inCredit ? 'in credit - paid ahead' : 'fully settled'}
          tone={owes ? 'warning' : inCredit ? 'info' : 'success'}
        />
        {/* Money on account replaces the opening balance when there is any.
            Both matter, but only one is a live decision: unapplied money is
            the single most common thing a customer telephones about, and it
            is what somebody needs to see before chasing them for a payment
            they have in fact already made. */}
        {onAccountPaise > 0 ? (
          <Tile
            label="On account"
            value={formatCurrency(onAccountPaise)}
            note="received, not yet applied"
            tone="info"
          />
        ) : (
          <Tile label="Opening" value={formatCurrency(openingPaise)} note="brought forward" />
        )}
        <Tile label="Invoiced" value={formatCurrencyCompact(totals.debitPaise)} note="in this period" />
        <Tile label="Received" value={formatCurrencyCompact(totals.creditPaise)} note="in this period" tone="success" />
      </div>

      {onAccountPaise > 0 && (
        <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2.5 print:hidden">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <p className="text-xs leading-relaxed">
            <strong className="text-info">{formatCurrency(onAccountPaise)} is sitting unapplied</strong>
            {' - '}
            already counted in the balance above, but not yet set against any invoice.
            Apply it before chasing this customer for money they have already sent.
          </p>
        </div>
      )}

      {failedReceipts.length > 0 && (
        <div className="mb-3 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2.5 print:hidden">
          <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-danger">
            <Icon name="alert-triangle" className="h-4 w-4 shrink-0" />
            {failedReceipts.length} payment{failedReceipts.length === 1 ? '' : 's'} did not clear
          </p>
          <ul className="space-y-1 ps-6 text-xs text-muted-foreground">
            {failedReceipts.map((r) => (
              <li key={r.receiptNo}>
                {/* Shown rather than hidden. It settles nothing, so it is not a
                    ledger line - but the customer believes they paid, and an
                    account that simply omits it cannot answer them. */}
                <Link href={`/receipts/${r.id}`} className="font-mono text-foreground hover:text-brand hover:underline">{r.receiptNo}</Link>
                {' · '}{formatCurrency(r.amountPaise)}
                {' · '}{fmtDate(r.at)}
                {r.reason && <> - {r.reason}</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {oldestUnpaid && (
        <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger/[0.06] px-3 py-2.5 print:hidden">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="text-xs leading-relaxed">
            <strong className="text-danger">
              <Link href={`/invoices/${oldestUnpaid.id}`} className="hover:underline">{oldestUnpaid.invoiceNo}</Link> is {oldestUnpaid.daysOverdue} day
              {oldestUnpaid.daysOverdue === 1 ? '' : 's'} overdue
            </strong>
            {' - '}
            {formatCurrency(oldestUnpaid.duePaise)} was due on {fmtDate(oldestUnpaid.dueDate)}.
            {party.creditLimitDays > 0 && ` Their terms are ${party.creditLimitDays} days.`}
          </p>
        </div>
      )}

      {/* ---- period -------------------------------------------------------- */}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-2 shadow-card print:hidden">
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">From</span>
          <input
            type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block text-muted-foreground">To</span>
          <input
            type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand"
          />
        </label>
        <Button variant="primary" icon="filter" onClick={apply}>Apply</Button>
        {(from || to) && (
          <Button
            variant="outline" icon="x"
            onClick={() => { window.location.href = `/customers/${party.id}`; }}
          >
            Whole history
          </Button>
        )}
        <p className="ms-auto max-w-md text-xs leading-relaxed text-muted-foreground">
          Anything before <strong>From</strong> is folded into the opening balance
          rather than hidden, so the statement still adds up.
        </p>
      </div>

      {/* ---- the ledger ---------------------------------------------------- */}
      <Card className="overflow-hidden">
        <div className="hidden border-b border-border px-4 py-3 print:block">
          <h2 className="text-base font-bold">Statement of account</h2>
          <p className="text-xs text-muted-foreground">
            {party.company ?? party.name} · {party.partyCode}
            {ledger.from && ledger.to && ` · ${fmtDate(ledger.from)} to ${fmtDate(ledger.to)}`}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/60 text-micro uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-start font-semibold">Date</th>
                <th className="px-3 py-2 text-start font-semibold">Particulars</th>
                <th className="px-3 py-2 text-start font-semibold">Reference</th>
                <th className="px-3 py-2 text-end font-semibold">Debit</th>
                <th className="px-3 py-2 text-end font-semibold">Credit</th>
                <th className="px-3 py-2 text-end font-semibold">Balance</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border">
              <tr className="bg-muted/30 text-xs">
                <td className="px-3 py-2 text-muted-foreground">
                  {ledger.from ? fmtDate(ledger.from) : '-'}
                </td>
                <td className="px-3 py-2 font-medium" colSpan={2}>Opening balance</td>
                <td />
                <td />
                <td className="px-3 py-2 text-end font-mono font-semibold tabular-nums">
                  {formatCurrency(openingPaise)}
                </td>
              </tr>

              {lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    Nothing in this period.
                  </td>
                </tr>
              ) : lines.map((l) => (
                <tr key={l.id} className="hover:bg-muted/40">
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{fmtDate(l.at)}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <Badge tone={l.kind === 'invoice' ? 'warning' : 'success'}>
                        {l.kind === 'invoice' ? 'Invoice' : 'Payment'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{l.description}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {l.receiptId || l.invoiceId ? (
                      <Link
                        href={l.receiptId ? `/receipts/${l.receiptId}` : `/invoices/${l.invoiceId}`}
                        className="font-mono text-xs font-medium text-brand hover:underline"
                      >
                        {l.ref}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs">{l.ref}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-end font-mono text-xs tabular-nums">
                    {l.debitPaise > 0 ? formatCurrency(l.debitPaise) : ''}
                  </td>
                  <td className="px-3 py-2 text-end font-mono text-xs tabular-nums text-success">
                    {l.creditPaise > 0 ? formatCurrency(l.creditPaise) : ''}
                  </td>
                  <td className="px-3 py-2 text-end font-mono text-xs font-semibold tabular-nums">
                    {formatCurrency(l.balancePaise)}
                  </td>
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr className="border-t-2 border-border-strong bg-muted/60 text-sm font-semibold">
                <td className="px-3 py-2.5" colSpan={3}>Totals for the period</td>
                <td className="px-3 py-2.5 text-end font-mono tabular-nums">
                  {formatCurrency(totals.debitPaise)}
                </td>
                <td className="px-3 py-2.5 text-end font-mono tabular-nums text-success">
                  {formatCurrency(totals.creditPaise)}
                </td>
                <td className="px-3 py-2.5 text-end font-mono tabular-nums">
                  {formatCurrency(closingPaise)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 ${
          owes ? 'bg-warning/10' : inCredit ? 'bg-info/10' : 'bg-success/10'
        }`}>
          <span className="text-sm font-semibold">
            {owes ? 'Amount due' : inCredit ? 'In credit' : 'Settled'}
          </span>
          <span className="font-mono text-xl font-bold tabular-nums">
            {formatCurrency(Math.abs(closingPaise))}
          </span>
        </div>
      </Card>

      {cancelled.length > 0 && (
        <Card className="mt-3 p-4 print:hidden">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Icon name="ban" className="h-4 w-4 text-muted-foreground" />
            Cancelled invoices
            <span className="ms-auto text-xs font-normal text-muted-foreground">
              not part of the balance
            </span>
          </h3>
          <ul className="divide-y divide-border text-xs">
            {cancelled.map((c) => (
              <li key={c.invoiceNo} className="flex items-center gap-3 py-1.5">
                <Link href={`/invoices/${c.id}`} className="font-mono hover:text-brand hover:underline">{c.invoiceNo}</Link>
                <span className="text-muted-foreground">cancelled {fmtDate(c.at)}</span>
                <span className="ms-auto font-mono tabular-nums text-muted-foreground line-through">
                  {formatCurrency(c.grandTotalPaise)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Shown because customers ask about them. A cancelled invoice never
            became a debt, so it is not a ledger line - but pretending it never
            existed makes the number sequence look like it has a hole.
          </p>
        </Card>
      )}

      {/*
        MAINTENANCE CONTRACTS on the customer's own record.

        "Does this customer pay us for cover, and how much of it have they
        used" is asked from the customer as often as from the AMC list -
        usually while they are on the phone. Hidden in print: a statement is
        about money owed, and contracts are not a ledger line.
      */}
      {amcContracts.length > 0 && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4 shadow-card print:hidden">
          <h2 className="mb-2 flex items-center gap-1.5 text-micro font-bold uppercase text-muted-foreground">
            <Icon name="refresh" className="h-3.5 w-3.5" />
            Maintenance contracts
          </h2>
          <ul className="divide-y divide-border text-xs">
            {amcContracts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Link
                  href={`/services/amc?q=${encodeURIComponent(c.contractNo)}&open=${c.id}`}
                  className="font-mono font-semibold text-brand hover:underline"
                >
                  {c.contractNo}
                </Link>
                <span className="text-muted-foreground">
                  {fmtDate(new Date(c.startDate))} - {fmtDate(new Date(c.endDate))}
                </span>
                <span className={
                  c.status !== 'active' ? 'text-muted-foreground'
                    : c.isOverdue ? 'font-medium text-danger'
                      : c.isDue ? 'font-medium text-warning' : 'text-success'
                }>
                  {c.status !== 'active'
                    ? c.status
                    : c.isOverdue
                      ? `lapsed ${Math.abs(c.daysToExpiry)}d ago`
                      : `${c.daysToExpiry}d left`}
                </span>
                <span className="text-muted-foreground">
                  {c.allowance.unlimited
                    ? `${c.allowance.used} visits, unlimited`
                    : `${c.allowance.used}/${c.allowance.included} visits`}
                  {c.allowance.exceededBy > 0 && (
                    <span className="text-danger"> ({c.allowance.exceededBy} over)</span>
                  )}
                </span>
                {c.billing === 'awaiting_invoice' && (
                  <span className="text-danger">fee not invoiced</span>
                )}
                <span className="ms-auto font-mono tabular-nums">
                  {formatCurrency(c.amountPaise)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground shadow-card print:hidden">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <span>
          Every line here is read from the invoice or payment that caused it -
          there is no stored ledger. Cancel an invoice and this corrects itself
          the moment you look. Draft invoices are not shown, because nobody has
          been asked to pay them.
        </span>
      </p>
    </div>
  );
}

function Tile({
  label, value, note, tone = 'default',
}: {
  label: string; value: string; note: string; tone?: string;
}) {
  const TONE: Record<string, string> = {
    default: 'border-border bg-card',
    success: 'border-success/25 bg-success/[0.05]',
    warning: 'border-warning/25 bg-warning/[0.07]',
    info: 'border-info/25 bg-info/[0.05]',
  };
  return (
    <div className={`rounded-lg border p-3 ${TONE[tone]}`}>
      <p className="text-micro font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
