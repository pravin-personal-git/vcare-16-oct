'use client';

import { useDebouncedSearch, useListParams } from '@/components/ui/useListParams';
import { DateRangeSelect } from '@/components/ui/DateRangeSelect';
import { useState, useTransition } from 'react';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { ServerExportButton } from '@/components/ui/ServerExportButton';
import type { TxnTotals } from '@/server/transactions-list';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Toolbar, ToolbarIcon } from '@/components/ui/Toolbar';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import type { TxnType } from '@/server/transactions';
import { CustomFieldInputs, useFieldSetup } from '@/components/custom-fields/CustomFieldInputs';
import { fieldsFor } from '@/lib/custom-fields';
import { DOOR_LABEL, type DuplicateGroup } from '@/lib/duplicate-expenses';
import {
  createTransactionAction, approveTransactionAction, rejectTransactionAction, reverseTransactionAction,
} from './actions';

/**
 * `5300 Salaries & Wages` is deliberately NOT here (8 Oct 2026).
 *
 * Payroll owns that account: processing a run posts Dr 5300 / Cr 2300 Staff
 * Payable, and "Mark paid" clears it. Offering it as a hand-typed category
 * let the same month's salary be debited to 5300 twice - once by payroll and
 * once by somebody recording the payment here - which understates profit by a
 * whole payroll and leaves Staff Payable never cleared. Same rule the other
 * module-owned accounts already follow: 5010 COGS, 5020/5030 parts and 5700
 * incentives have never been in this list.
 */
const EXPENSE_CATEGORIES = [
  { code: '5850', label: 'Vehicle & fuel', hint: 'Petrol, servicing, repairs' },
  { code: '5800', label: 'Staff welfare', hint: 'Chai, nashta, medicines' },
  { code: '5200', label: 'Rent & utilities', hint: 'Rent, electricity, water, internet' },
  { code: '5500', label: 'Repairs & upkeep', hint: 'AC, plumbing, furniture' },
  { code: '5400', label: 'Advertising', hint: 'Flex boards, online ads, printing' },
  { code: '5100', label: 'Freight & courier', hint: 'Transport, delivery, courier' },
  { code: '5600', label: 'Bank charges', hint: 'Charges, interest, card fees' },
  { code: '5900', label: 'Something else', hint: 'Anything not listed above' },
];
const INCOME_CATEGORIES = [{ code: '4900', label: 'Other Income' }];
const TRANSFER_ACCOUNTS = [
  { code: '1010', label: 'Cash' },
  { code: '1020', label: 'Bank' },
  { code: '1030', label: 'Petty Cash' },
];
/** Petty cash is a real account, not a wallet - spending from it credits 1030. */
const METHODS = [
  { key: 'cash', label: 'Cash' },
  { key: 'bank', label: 'Bank' },
  { key: 'upi', label: 'UPI' },
  { key: 'cheque', label: 'Cheque' },
  { key: 'petty_cash', label: 'Petty cash' },
];
const ACCOUNT_LABEL: Record<string, string> = Object.fromEntries(
  // 5300 is listed here but NOT in the categories above: a voucher recorded
  // against it before 8 Oct 2026 still has to read as something.
  [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, ...TRANSFER_ACCOUNTS, { code: '5300', label: 'Salaries & Wages' }]
    .map((a) => [a.code, a.label]),
);

export interface TxnRowVM {
  id: string;
  txnNo: string;
  txnType: string;
  txnDate: string;
  amountPaise: number;
  categoryAccountCode: string | null;
  method: string | null;
  fromAccountCode: string | null;
  toAccountCode: string | null;
  description: string | null;
  status: string;
  rejectedReason: string | null;
  reversalReason: string | null;
  paidToUserId: string | null;
  paidToName: string | null;
}

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

const TYPE_LABEL: Record<string, string> = { expense: 'Expense', income: 'Income', transfer: 'Transfer' };
const STATUS_TONE: Record<string, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning', approved: 'success', rejected: 'danger', reversed: 'neutral',
};

export function TransactionsClient({
  rows, canEdit, canApprove, paging, totals, filter, people, duplicates,
}: {
  /** One server-side page (F1b): searched, filtered and sorted on the server. */
  rows: TxnRowVM[];
  paging: ServerPaging;
  /** Counted over every transaction. */
  totals: TxnTotals;
  filter: string | null;
  canEdit: boolean;
  canApprove: boolean;
  /** For "Handed to" on a cash expense. */
  people: { id: string; fullName: string }[];
  /** Possible same-spend-twice entries, over the last 90 days. */
  duplicates: DuplicateGroup[];
}) {
  // Every filter lives in the address and runs on the server (F1b server paging).
  const list = useListParams();
  // The date filter (9 Oct 2026) - ?range= &from= &to=, read by the server list.
  const rangeOn = Boolean(list.get('range') || list.get('from') || list.get('to'));
  const { value: search, setValue: setSearch } = useDebouncedSearch('q');
  const setFilter = (k: string | null) => list.set({ card: k && k !== 'all' ? k : null });
  const [addKind, setAddKind] = useState<TxnType | null>(null);
  const [showDupes, setShowDupes] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reviewing, setReviewing] = useState<TxnRowVM | null>(null);

  // Totals come from the server, over every transaction.

  const kpis: KpiCard[] = [
    { key: 'all', label: 'All', count: totals.all, icon: 'file-text' },
    { key: 'pending', label: 'Pending', count: totals.pending, icon: 'clock', tone: 'warning' },
    { key: 'expense', label: 'Total Expense', count: formatCurrencyCompact(totals.expense), icon: 'trending-up', tone: 'danger' },
    { key: 'income', label: 'Total Income', count: formatCurrencyCompact(totals.income), icon: 'credit-card', tone: 'success' },
    { key: 'transfer', label: 'Total Transferred', count: formatCurrencyCompact(totals.transfer), icon: 'refresh', tone: 'info' },
  ];

  const describeAccounts = (r: TxnRowVM) => {
    if (r.txnType === 'transfer') {
      return `${ACCOUNT_LABEL[r.fromAccountCode ?? ''] ?? r.fromAccountCode} → ${ACCOUNT_LABEL[r.toAccountCode ?? ''] ?? r.toAccountCode}`;
    }
    return ACCOUNT_LABEL[r.categoryAccountCode ?? ''] ?? r.categoryAccountCode ?? '-';
  };

  const columns: Column<TxnRowVM>[] = [
    {
      key: 'txnNo', header: 'No.', width: '10rem',
      render: (r) => <span className="font-mono text-xs font-medium text-brand">{r.txnNo}</span>,
      sortValue: (r) => r.txnNo,
    },
    {
      key: 'type', header: 'Type',
      render: (r) => <Badge tone={r.txnType === 'expense' ? 'danger' : r.txnType === 'income' ? 'success' : 'info'}>{TYPE_LABEL[r.txnType]}</Badge>,
      sortValue: (r) => r.txnType,
    },
    { key: 'txnDate', header: 'Date', render: (r) => <span className="text-xs">{fmtDate(r.txnDate)}</span>, sortValue: (r) => r.txnDate },
    { key: 'category', header: 'Category / Accounts', render: (r) => <span className="text-xs">{describeAccounts(r)}</span>, sortValue: describeAccounts },
    {
      key: 'amount', header: 'Amount', align: 'end',
      render: (r) => <span className="font-mono text-xs">{formatCurrency(r.amountPaise)}</span>,
      sortValue: (r) => r.amountPaise,
    },
    { key: 'description', header: 'Description', render: (r) => <span className="text-xs text-muted-foreground">{r.description ?? '-'}</span>, sortValue: (r) => r.description, optional: true },
    {
      key: 'paidTo', header: 'Handed to', optional: true,
      render: (r) => <span className="text-xs">{r.paidToName ?? '-'}</span>,
      sortValue: (r) => r.paidToName ?? '',
    },
    {
      key: 'status', header: 'Status',
      render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>,
      sortValue: (r) => r.status,
    },
  ];

  return (
    <div>
      <PageHeader
        badge="OE"
        title="Office Expenses"
        subtitle={`${totals.all} entries · rent, bills, chai, petrol - everything the business spends`}
        actions={
          canEdit ? (
            /*
             * One button, not three (9 Oct 2026). Spending is a daily job;
             * recording a side income or moving cash to the bank happens once
             * or twice a month. Three equal buttons made the screen read as
             * an accountant's tool rather than "where the spending goes".
             */
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" icon="trending-up" onClick={() => setAddKind('expense')}>New expense</Button>
              <div className="relative">
                <Button icon="more-vertical" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>More</Button>
                {moreOpen && (
                  <div className="absolute end-0 z-50 mt-1 w-56 rounded-lg border border-border bg-card py-1 shadow-raised">
                    <button type="button" className="block w-full px-3 py-2 text-start text-sm hover:bg-muted"
                      onClick={() => { setMoreOpen(false); setAddKind('income'); }}>
                      Money came in
                      <span className="block text-xs text-muted-foreground">Scrap sold, something refunded - not a sale</span>
                    </button>
                    <button type="button" className="block w-full px-3 py-2 text-start text-sm hover:bg-muted"
                      onClick={() => { setMoreOpen(false); setAddKind('transfer'); }}>
                      Moved cash between accounts
                      <span className="block text-xs text-muted-foreground">Cash to bank, or into the petty cash float</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : undefined
        }
      />

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Transaction no., description…"
        count={`Total (${paging.total})`}
        filters={<DateRangeSelect label="Dated" />}
        end={
          <>
            <ServerExportButton screen="transactions" />
            <ToolbarIcon icon="refresh" label="Refresh" onClick={() => window.location.reload()} />
            <ToolbarIcon
              icon="x-circle" label="Clear filters"
              active={filter !== null || search !== '' || rangeOn}
              onClick={() => { setSearch(''); list.set({ card: null, q: null, range: null, from: null, to: null }); }}
            />
          </>
        }
      />

      <KpiStrip cards={kpis} activeKey={filter} onSelect={setFilter} columns={5} />

      {duplicates.length > 0 && (
        <div className="mt-3 rounded-xl border border-warning/40 bg-warning/[0.06] p-3">
          <button
            type="button" onClick={() => setShowDupes((v) => !v)}
            className="flex w-full items-start gap-2.5 text-start"
            aria-expanded={showDupes}
          >
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span className="flex-1">
              <span className="text-sm font-medium">
                {duplicates.length} possible duplicate{duplicates.length === 1 ? '' : 's'} in the last 90 days
              </span>
              <span className="block text-xs text-muted-foreground">
                The same amount entered more than once, close together - the same spend can reach the books
                through an expense voucher, a purchase bill and a reimbursement claim without any of them
                knowing about the others. Nothing has been hidden or changed; have a look and decide.
              </span>
            </span>
            <Icon name={showDupes ? 'chevron-up' : 'chevron-down'} className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          </button>

          {showDupes && (
            <div className="mt-3 grid gap-2">
              {duplicates.map((g) => (
                <div key={`${g.amountPaise}-${g.entries[0]?.id}`} className="rounded-lg border border-border bg-card p-2.5">
                  <p className="text-sm font-medium">{formatCurrency(g.amountPaise)}, {g.entries.length} times</p>
                  <p className="mb-1.5 text-xs text-muted-foreground">{g.reason}</p>
                  <ul className="grid gap-1 text-xs">
                    {g.entries.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-x-2">
                        <Badge tone={e.door === 'claim' ? 'warning' : e.door === 'bill' ? 'info' : 'neutral'}>
                          {DOOR_LABEL[e.door]}
                        </Badge>
                        <span className="font-mono">{e.ref}</span>
                        <span className="text-muted-foreground">{e.day}</span>
                        <span>{e.label}</span>
                        {e.person && <span className="text-muted-foreground">· {e.person}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <DataGrid
        rows={rows}
        server={paging}
        columns={columns}
        rowKey={(r) => r.id}
        emptyIcon="file-text"
        emptyMessage={filter ? 'No transactions match this card.' : 'No transactions found.'}
        emptyHint="Add an expense, income, or transfer to get started."
        /* Inherits the shared sizes - this ledger holds every transaction now. */
        pageSummary={(pageRows) => (
          <span className="text-muted-foreground">
            Count: <strong className="text-foreground">{pageRows.length}</strong>
          </span>
        )}
        actions={[
          {
            label: 'Approve', icon: 'check-circle', iconTone: 'success',
            enabled: (r) => canApprove && r.status === 'pending',
            onSelect: (r) => setReviewing(r),
          },
          {
            label: 'Reverse', icon: 'rotate-ccw',
            enabled: (r) => canEdit && r.status === 'approved',
            onSelect: (r) => setReviewing(r),
          },
        ]}
      />

      {addKind && (
        <TransactionDialog kind={addKind} people={people} onClose={() => setAddKind(null)} onDone={() => { setAddKind(null); window.location.reload(); }} />
      )}

      {reviewing && (
        <ReviewDialog row={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); window.location.reload(); }} />
      )}
    </div>
  );
}

/**
 * ONE FORM, WORDED FOR WHOEVER IS SPENDING THE MONEY (9 Oct 2026).
 *
 * The category used to be a dropdown of account names ("Other Operating
 * Expenses"), which is what an accountant calls it, not what the person
 * holding the receipt calls it. It is now a row of tiles that say what each
 * one is for, and the branch's own fields - a bill number, a vehicle, a meter
 * reading - sit underneath.
 *
 * A real `<form>`, so the custom fields can be read the way every other screen
 * reads them: by name off `FormData`, checked on the server against that
 * branch's own setup rather than trusted from here.
 */
function TransactionDialog({
  kind, people, onClose, onDone,
}: {
  kind: TxnType;
  people: { id: string; fullName: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const categories = kind === 'expense' ? EXPENSE_CATEGORIES : kind === 'income' ? INCOME_CATEGORIES : [];
  const [category, setCategory] = useState(categories[0]?.code ?? '');
  const [fromAccount, setFromAccount] = useState('1010');
  const [toAccount, setToAccount] = useState('1030');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('cash');
  const [paidTo, setPaidTo] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formId = 'txn-form';

  // The branch's own fields, only on an expense - a transfer between two of
  // your own accounts has nothing to describe.
  const { setup } = useFieldSetup('expense');
  const extraFields = kind === 'expense' ? fieldsFor(setup.custom) : [];

  const amountPaise = Math.round((Number(amount) || 0) * 100);
  const ready = amountPaise > 0 && date !== '' && (kind === 'transfer' ? fromAccount !== toAccount : category !== '');

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ready || pending) return;

    // Everything named `cf_…` goes to the server as it was typed; the server
    // decides whether it is valid for this branch.
    const data = new FormData(e.currentTarget);
    const custom: Record<string, string[]> = {};
    for (const [name, value] of data.entries()) {
      if (!name.startsWith('cf_') || typeof value !== 'string') continue;
      (custom[name] ??= []).push(value);
    }

    startTransition(async () => {
      const res = await createTransactionAction({
        txnType: kind,
        amountPaise,
        txnDate: date,
        categoryAccountCode: kind === 'transfer' ? null : category,
        method: kind === 'transfer' ? null : method,
        fromAccountCode: kind === 'transfer' ? fromAccount : null,
        toAccountCode: kind === 'transfer' ? toAccount : null,
        description: description.trim() || null,
        paidToUserId: kind === 'expense' ? paidTo || null : null,
        custom,
      });
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };

  const title = kind === 'expense' ? 'New expense'
    : kind === 'income' ? 'Money came in'
      : 'Move money between accounts';
  const subtitle = kind === 'expense' ? 'Goes into the books the moment it is approved'
    : kind === 'income' ? 'Not a sale - scrap sold, something refunded'
      : 'Not spending. The money is still yours, just somewhere else';

  const label = 'grid gap-1 text-xs font-medium text-muted-foreground';
  const control = 'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';

  return (
    <Modal
      open
      title={title}
      subtitle={subtitle}
      icon={kind === 'expense' ? 'trending-up' : kind === 'income' ? 'credit-card' : 'refresh'}
      size="md"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" icon="check" disabled={!ready || pending} loading={pending}>
            Save
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        {kind === 'transfer' ? (
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Out of
              <select value={fromAccount} onChange={(e) => setFromAccount(e.target.value)} className={control}>
                {TRANSFER_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
              </select>
            </label>
            <label className={label}>
              Into
              <select value={toAccount} onChange={(e) => setToAccount(e.target.value)} className={control}>
                {TRANSFER_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
              </select>
            </label>
          </div>
        ) : kind === 'income' ? (
          <label className={label}>
            What kind of money
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={control}>
              {categories.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </label>
        ) : (
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">What is this for?</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {EXPENSE_CATEGORIES.map((c) => (
                <button
                  key={c.code} type="button" onClick={() => setCategory(c.code)}
                  aria-pressed={category === c.code}
                  className={`rounded-lg border px-3 py-2 text-start transition ${
                    category === c.code
                      ? 'border-brand bg-brand/5'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <span className="block text-sm font-medium">{c.label}</span>
                  <span className="block text-xs text-muted-foreground">{c.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            How much (₹)
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={control} />
          </label>
          <label className={label}>
            When
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={control} />
          </label>
        </div>

        {kind !== 'transfer' && (
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              {kind === 'expense' ? 'Paid by' : 'Received into'}
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={control}>
                {METHODS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            {kind === 'expense' && (
              <label className={label}>
                Handed to (optional)
                <select value={paidTo} onChange={(e) => setPaidTo(e.target.value)} className={control}>
                  <option value="">- nobody in particular -</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
                </select>
              </label>
            )}
          </div>
        )}

        {kind === 'expense' && (
          <p className="-mt-1 text-xs text-muted-foreground">
            &ldquo;Handed to&rdquo; is only so you know where the money went - it shows on the fuel and welfare
            reports. It does <strong>not</strong> become an advance, and nothing is deducted from anyone&rsquo;s salary.
          </p>
        )}

        <label className={label}>
          Note (optional)
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className={control}
            placeholder={kind === 'expense' ? 'Pump bill, Bhilai road' : undefined} />
        </label>

        {extraFields.length > 0 && (
          <div className="border-t border-dashed border-border pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Your own fields
              <span className="ms-1 font-normal">· set up at Settings › Custom Fields › Office expenses</span>
            </p>
            <CustomFieldInputs configs={extraFields} />
          </div>
        )}
      </form>
    </Modal>
  );
}

function ReviewDialog({
  row, onClose, onDone,
}: {
  row: TxnRowVM;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isPending = row.status === 'pending';

  const approve = () => {
    startTransition(async () => {
      const res = await approveTransactionAction(row.id);
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };
  const reject = () => {
    startTransition(async () => {
      const res = await rejectTransactionAction(row.id, reason);
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };
  const reverse = () => {
    startTransition(async () => {
      const res = await reverseTransactionAction(row.id, reason);
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <Modal
      open
      title={row.txnNo}
      subtitle={`${formatCurrency(row.amountPaise)} · ${fmtDate(row.txnDate)}`}
      icon="file-text"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          {isPending ? (
            <>
              <Button icon="x-circle" disabled={!reason.trim() || pending} loading={pending} onClick={reject}>Reject</Button>
              <Button variant="primary" icon="check" disabled={pending} loading={pending} onClick={approve}>Approve</Button>
            </>
          ) : (
            <Button variant="primary" icon="rotate-ccw" disabled={!reason.trim() || pending} loading={pending} onClick={reverse}>
              Reverse
            </Button>
          )}
        </div>
      }
    >
      <div className="grid gap-3">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Reason {isPending && '(required to reject)'}
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
      </div>
    </Modal>
  );
}
