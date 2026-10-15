'use client';

import { SupplierLink } from '@/components/document/SupplierLink';
import { sayIfHeld } from '@/lib/held-message';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge, Card, Field, SectionCard, SummaryRow } from '@/components/ui/Layout';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { QuickFilter, matches } from '@/components/ui/QuickFilter';
import {
  AGE_BUCKET_LABEL, BILL_STATUS_LABEL, ageBucket, allocateOldestFirst,
  type AgeBucket, type BillStatus,
} from '@/lib/purchase';
import { paySupplierAction, reversePaymentAction } from '../bills/actions';

/**
 * The payables ledger - what is owed, to whom, and how late.
 *
 * THE AGEING TABLE IS THE POINT OF THIS SCREEN.
 *
 * A single "you owe ₹4,20,000" number is almost useless: owing four lakh due
 * next month and owing four lakh that was due in April are completely different
 * situations, and only one of them is a problem. Splitting by age is what turns
 * the figure into something a person can act on.
 */

interface BalanceVM {
  partyId: string;
  supplierName: string;
  billCount: number;
  billedPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  oldestDueDate: string | null;
}

interface OpenBillVM {
  id: string;
  billNo: string;
  supplierBillNo: string;
  partyId: string;
  supplierName: string;
  dueDate: string;
  grandTotalPaise: number;
  outstandingPaise: number;
  status: BillStatus;
}

interface PaymentVM {
  id: string;
  paymentNo: string;
  partyId?: string | null;
  supplierName: string;
  amountPaise: number;
  paidAt: string;
  method: string;
  reference: string | null;
  status: string;
  allocatedPaise: number;
}

const rupees = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' });

const BUCKETS: AgeBucket[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];

export function PayablesClient({
  balances, bills, payments, canPay, payFor: initialPayFor = null,
}: {
  balances: BalanceVM[];
  bills: OpenBillVM[];
  payments: PaymentVM[];
  canPay: boolean;
  /** G-27: a bill's "Pay this supplier" lands here with that supplier's form open. */
  payFor?: string | null;
}) {
  const router = useRouter();
  const [payFor, setPayFor] = useState<string | null>(canPay ? initialPayFor : null);
  // G-07: narrow the supplier list - by name, and to who is owed or late.
  const [q, setQ] = useState('');
  const [owe, setOwe] = useState('owed');
  const todayIso = new Date().toISOString().slice(0, 10);
  const shownBalances = balances.filter((b) => matches(q, b.supplierName)
    && (owe === 'all' || (owe === 'owed' && b.outstandingPaise > 0)
      || (owe === 'late' && b.outstandingPaise > 0 && !!b.oldestDueDate && b.oldestDueDate.slice(0, 10) < todayIso)));

  const now = new Date();

  const ageing = useMemo(() => {
    const map = new Map<AgeBucket, number>(BUCKETS.map((b) => [b, 0]));
    for (const b of bills) {
      const bucket = ageBucket(new Date(b.dueDate), now);
      map.set(bucket, (map.get(bucket) ?? 0) + b.outstandingPaise);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills]);

  const totalOwed = balances.reduce((n, b) => n + b.outstandingPaise, 0);
  const overdue = BUCKETS.slice(1).reduce((n, b) => n + (ageing.get(b) ?? 0), 0);
  const advances = payments
    .filter((p) => p.status === 'paid')
    .reduce((n, p) => n + Math.max(0, p.amountPaise - p.allocatedPaise), 0);

  const cards: KpiCard[] = [
    {
      key: 'owed', label: 'Total payable', count: rupees(totalOwed),
      subLabel: `${balances.filter((b) => b.outstandingPaise > 0).length} suppliers`,
      icon: 'credit-card', tone: totalOwed > 0 ? 'warning' : 'success',
    },
    {
      key: 'overdue', label: 'Past due', count: rupees(overdue),
      subLabel: overdue > 0 ? 'already late' : 'nothing late',
      icon: 'alert-triangle', tone: overdue > 0 ? 'danger' : 'success',
    },
    {
      key: 'due', label: 'Not yet due', count: rupees(ageing.get('current') ?? 0),
      subLabel: 'within terms', icon: 'clock',
    },
    {
      key: 'advance', label: 'Paid on account', count: rupees(advances),
      subLabel: advances > 0 ? 'not against any bill' : 'none', icon: 'file-text',
      tone: advances > 0 ? 'info' : 'default',
    },
  ];

  const balanceCols: Column<BalanceVM>[] = [
    {
      key: 'name', header: 'Supplier', sortValue: (b) => b.supplierName,
      render: (b) => <SupplierLink id={b.partyId} className="font-medium">{b.supplierName}</SupplierLink>,
    },
    {
      key: 'bills', header: 'Bills', align: 'end', sortValue: (b) => b.billCount,
      render: (b) => <span className="tabular-nums text-muted-foreground">{b.billCount}</span>,
    },
    {
      key: 'billed', header: 'Billed', align: 'end', sortValue: (b) => b.billedPaise,
      render: (b) => <span className="tabular-nums">{rupees(b.billedPaise)}</span>,
    },
    {
      key: 'paid', header: 'Paid', align: 'end', sortValue: (b) => b.paidPaise,
      render: (b) => <span className="tabular-nums text-muted-foreground">{rupees(b.paidPaise)}</span>,
    },
    {
      key: 'owed', header: 'Outstanding', align: 'end', sortValue: (b) => b.outstandingPaise,
      render: (b) => (
        b.outstandingPaise > 0
          ? <span className="tabular-nums font-semibold">{rupees(b.outstandingPaise)}</span>
          : <span className="text-xs text-muted-foreground">Settled</span>
      ),
    },
    {
      key: 'oldest', header: 'Oldest due', sortValue: (b) => (b.oldestDueDate ? new Date(b.oldestDueDate).getTime() : 0),
      render: (b) => {
        if (!b.oldestDueDate) return <span className="text-muted-foreground">-</span>;
        const bucket = ageBucket(new Date(b.oldestDueDate), now);
        return (
          <span className="flex flex-col">
            <span className="text-xs">{fmtDate(b.oldestDueDate)}</span>
            {bucket !== 'current' && (
              <span className="text-xs text-danger">{AGE_BUCKET_LABEL[bucket]}</span>
            )}
          </span>
        );
      },
    },
    ...(canPay ? [{
      key: 'pay', header: '', align: 'end' as const,
      render: (b: BalanceVM) => (
        b.outstandingPaise > 0 ? (
          <Button size="sm" variant="primary" onClick={() => setPayFor(b.partyId)}>
            Pay
          </Button>
        ) : null
      ),
    } as Column<BalanceVM>] : []),
  ];

  const supplierBills = payFor ? bills.filter((b) => b.partyId === payFor) : [];
  const supplierName = balances.find((b) => b.partyId === payFor)?.supplierName ?? '';

  return (
    <>
      <PageHeader
        badge="AP"
        title="Payables"
        subtitle={`${rupees(totalOwed)} owed · ${rupees(overdue)} past due`}
        actions={
          <Link href="/purchase/bills">
            <Button icon="receipt">Purchase bills</Button>
          </Link>
        }
      />

      {overdue > 0 && (
        <Card className="mb-3 flex items-start gap-2.5 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="flex-1 text-xs leading-relaxed">
            <strong>{rupees(overdue)} is already past its due date.</strong>{' '}
            Suppliers who are not paid on time tighten credit terms first and stop supplying
            second - and a business that loses its credit line is a business paying cash in
            advance for everything.
          </p>
        </Card>
      )}

      <div className="mb-3">
        <KpiStrip cards={cards} activeKey={null} onSelect={() => undefined} columns={4} />
      </div>

      <SectionCard title="How old the debt is" icon="clock" className="mb-4" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                {BUCKETS.map((b) => (
                  <th key={b} className="px-3 py-2 text-right font-semibold">
                    {AGE_BUCKET_LABEL[b]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {BUCKETS.map((b) => {
                  const amount = ageing.get(b) ?? 0;
                  const bad = b !== 'current' && amount > 0;
                  return (
                    <td
                      key={b}
                      className={`px-3 py-3 text-right tabular-nums ${
                        bad ? 'font-semibold text-danger' : ''
                      }`}
                    >
                      {amount > 0 ? rupees(amount) : <span className="text-muted-foreground">-</span>}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t border-border bg-muted/20 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
          One total tells you nothing on its own - four lakh due next month and four lakh due
          in April are entirely different situations, and only one is a problem. Drafts are
          excluded throughout: a bill nobody has posted is somebody typing, not a debt.
        </p>
      </SectionCard>

      <SectionCard title="By supplier" icon="users" className="mb-4" bodyClassName="p-0"
        action={<QuickFilter search={q} onSearch={setQ} placeholder="Supplier name" shown={shownBalances.length} total={balances.length}
          choice={{ label: 'Show', value: owe, onChange: setOwe, options: [
            { value: 'owed', label: 'Owed something' }, { value: 'late', label: 'Past due' }, { value: 'all', label: 'All suppliers' },
          ] }} />}>
        <DataGrid
          exportAs={{ title: 'Payables by supplier' }}
          rows={shownBalances}
          columns={balanceCols}
          rowKey={(b) => b.partyId}
          emptyIcon="credit-card"
          emptyMessage="Nothing owed to anybody"
          emptyHint="Post a purchase bill and it will appear here."
        />
      </SectionCard>

      {payments.length > 0 && (
        <SectionCard title="Recent payments" icon="credit-card" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Payment</th>
                  <th className="px-3 py-2 font-semibold">Supplier</th>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Method</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  <th className="px-3 py-2 text-right font-semibold">On account</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const onAccount = Math.max(0, p.amountPaise - p.allocatedPaise);
                  return (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium"><Link href={`/purchase/payments/${p.id}`} className="font-mono text-brand hover:underline">{p.paymentNo}</Link></td>
                      <td className="px-3 py-2"><SupplierLink id={p.partyId}>{p.supplierName}</SupplierLink></td>
                      <td className="px-3 py-2 text-xs">{fmtDate(p.paidAt)}</td>
                      <td className="px-3 py-2 text-xs capitalize">{p.method}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.status === 'reversed' ? (
                          <span className="text-muted-foreground line-through">
                            {rupees(p.amountPaise)}
                          </span>
                        ) : rupees(p.amountPaise)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {onAccount > 0 && p.status === 'paid'
                          ? <span className="tabular-nums text-warning">{rupees(onAccount)}</span>
                          : <span className="text-muted-foreground">-</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.status === 'reversed'
                          ? <Badge tone="neutral">Reversed</Badge>
                          : canPay && (
                            <ReverseButton
                              paymentId={p.id}
                              paymentNo={p.paymentNo}
                              onDone={() => router.refresh()}
                            />
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {payFor && (
        <PayModal
          partyId={payFor}
          supplierName={supplierName}
          bills={supplierBills}
          onClose={() => setPayFor(null)}
          onSaved={() => { setPayFor(null); router.refresh(); }}
        />
      )}
    </>
  );
}

function ReverseButton({
  paymentId, paymentNo, onDone,
}: { paymentId: string; paymentNo: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Reverse</Button>
      {open && (
        <Modal
          title={`Reverse ${paymentNo}`}
          subtitle="For a bounced cheque or a failed transfer"
          icon="alert-triangle"
          tone="danger"
          size="sm"
          onClose={() => setOpen(false)}
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button
                variant="danger"
                disabled={!reason.trim() || busy}
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await reversePaymentAction(paymentId, reason);
                  setBusy(false);
                  if (r.error) setError(r.error);
                  else { sayIfHeld(r); setOpen(false); onDone(); }
                }}
              >
                Reverse it
              </Button>
            </div>
          }
        >
          {error && <p className="mb-2 text-xs text-danger">{error}</p>}
          <Field label="Why" hint="Goes on the record. The payment is kept, not deleted.">
            <input
              className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Cheque bounced"
            />
          </Field>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            The bills this was paying will open again by themselves. The payment stays on the
            record as an attempt that failed - which is exactly what you will need when the
            supplier rings.
          </p>
        </Modal>
      )}
    </>
  );
}

function PayModal({
  partyId, supplierName, bills, onClose, onSaved,
}: {
  partyId: string;
  supplierName: string;
  bills: OpenBillVM[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const owed = bills.reduce((n, b) => n + b.outstandingPaise, 0);

  const [amount, setAmount] = useState((owed / 100).toFixed(2));
  const [method, setMethod] = useState<'cash' | 'bank' | 'upi' | 'cheque' | 'adjustment'>('bank');
  const [paidAt, setPaidAt] = useState(today);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountPaise = Math.round((Number(amount.replace(/,/g, '')) || 0) * 100);

  /**
   * What this payment will clear, previewed before it is sent.
   *
   * Same function the server uses. The server's answer is the one that gets
   * stored - the client is never trusted with money - but somebody about to
   * send four lakh to a supplier should be able to see which bills it closes
   * before they press the button, not after.
   */
  const plan = useMemo(() => allocateOldestFirst(
    bills.map((b) => ({
      id: b.id,
      grandTotalPaise: b.grandTotalPaise,
      paidPaise: b.grandTotalPaise - b.outstandingPaise,
    })),
    amountPaise,
  ), [bills, amountPaise]);

  return (
    <Modal
      title={`Pay ${supplierName}`}
      subtitle={`${rupees(owed)} outstanding across ${bills.length} bill${bills.length === 1 ? '' : 's'}`}
      icon="credit-card"
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            disabled={amountPaise <= 0 || busy}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await paySupplierAction({
                partyId,
                amountPaise,
                method,
                paidAt,
                reference: reference.trim() || null,
                note: null,
              });
              setBusy(false);
              if (r.error) setError(r.error);
              else { sayIfHeld(r); onSaved(); }
            }}
          >
            Record payment
          </Button>
        </div>
      }
    >
      {error && (
        <Card className="mb-3 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <p className="text-xs leading-relaxed text-danger">{error}</p>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount ₹">
          <input
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm tabular-nums"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
          />
        </Field>

        <Field label="Method">
          <select
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={method}
            onChange={(e) => setMethod(e.target.value as typeof method)}
          >
            <option value="bank">Bank transfer</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
            <option value="cash">Cash</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </Field>

        <Field label="Date">
          <input
            type="date"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
          />
        </Field>

        <Field label="Reference" hint="UTR, cheque number - optional">
          <input
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
      </div>

      <SectionCard title="What this clears" icon="receipt" className="mt-4" bodyClassName="p-0">
        <table className="w-full text-sm">
          <tbody>
            {bills.map((b) => {
              const alloc = plan.allocations.find((a) => a.billId === b.id);
              return (
                <tr key={b.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <span className="font-medium">{b.supplierBillNo}</span>
                    <span className="ms-2 text-xs text-muted-foreground">
                      due {fmtDate(b.dueDate)}
                    </span>
                    {/* Which of these is late is the whole basis for deciding
                        what to pay first. It was being passed to this screen
                        and never shown - an unused-import warning was the only
                        sign of it. */}
                    {b.status === 'overdue' && (
                      <Badge tone="danger" className="ms-2">
                        {BILL_STATUS_LABEL.overdue}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {rupees(b.outstandingPaise)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {alloc
                      ? (
                        <span className="tabular-nums font-medium text-success">
                          − {rupees(alloc.amountPaise)}
                        </span>
                      )
                      : <span className="text-xs text-muted-foreground">-</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SectionCard>

      <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <SummaryRow label="Paying" value={rupees(amountPaise)} />
        <SummaryRow
          label="Against bills"
          value={rupees(amountPaise - plan.unallocatedPaise)}
        />
        {plan.unallocatedPaise > 0 && (
          <SummaryRow label="On account" value={rupees(plan.unallocatedPaise)} />
        )}
      </div>

      {plan.unallocatedPaise > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {rupees(plan.unallocatedPaise)} is more than the open bills come to. It will be
          recorded as an advance against this supplier - not lost, just not against a bill
          yet. It will clear the next bill you post for them.
        </p>
      )}
    </Modal>
  );
}
