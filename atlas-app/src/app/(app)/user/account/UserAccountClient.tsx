'use client';

import { useEffect, useState } from 'react';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Toolbar } from '@/components/ui/Toolbar';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import type { StaffAccountCards, StaffAccountRow } from '@/server/staff-accounts';
import { loadTransactionsForUser } from './actions';

/**
 * STAFF ACCOUNT - what each employee owes the business, and what it owes them.
 *
 * A READ-ONLY screen, like Customer Account and Supplier Account beside it in
 * the menu (9 Oct 2026). It used to carry an "Add transaction" button, which
 * made it the one place where staff money could be recorded without a schedule
 * to collect it by - so advances handed over here were never taken back, and
 * office spending entered here turned into a debt against the person instead of
 * a cost to the business.
 *
 * Everything is now raised where it belongs and lands here:
 *   loan or salary advance  -> HRM > Loans & Salary Advances
 *   expense claim           -> HRM > Payroll > Claims
 *   office spending         -> Office Expenses
 *
 * Two money columns, never one signed number: a minus reads as "less than
 * expected", not as "the arrow points the other way".
 */

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

const KIND_LABEL: Record<string, string> = {
  advance_given: 'Advance given',
  advance_repaid: 'Advance repaid',
  expense_claimed: 'Expense claimed',
  expense_reimbursed: 'Expense reimbursed',
  incentive_paid: 'Incentive paid',
  advance_written_off: 'Advance written off',
};

export function UserAccountClient({
  rows, cards, initialSearch = '',
}: {
  /**
   * Seed for the search box, from `?q=`.
   *
   * The global search links here with the number it matched. Editable
   * afterwards like any other search - a starting point, not a lock.
   */
  initialSearch?: string;
  rows: StaffAccountRow[];
  cards: StaffAccountCards;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [historyFor, setHistoryFor] = useState<StaffAccountRow | null>(null);

  const kpis: KpiCard[] = [
    { key: 'all', label: 'People', count: cards.people, icon: 'users' },
    {
      key: 'owing', label: 'Staff owe the business', count: formatCurrencyCompact(cards.owedByStaffPaise),
      icon: 'trending-up', tone: 'warning', subLabel: 'loans and advances left',
    },
    {
      key: 'owed', label: 'Business owes staff', count: formatCurrencyCompact(cards.owedToStaffPaise),
      icon: 'credit-card', tone: 'danger', subLabel: 'claims not yet paid',
    },
    { key: 'loans', label: 'Running loans', count: cards.openLoans, icon: 'file-text', tone: 'info' },
    { key: 'advances', label: 'Running advances', count: cards.openAdvances, icon: 'clock', tone: 'info' },
  ];

  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (q && !`${r.fullName} ${r.userCode} ${r.openDocs.join(' ')}`.toLowerCase().includes(q)) return false;
    if (filter === 'owing') return r.owedByStaffPaise > 0;
    if (filter === 'owed') return r.owedToStaffPaise > 0;
    if (filter === 'loans') return r.loanLeftPaise > 0;
    if (filter === 'advances') return r.advanceLeftPaise > 0;
    return true;
  });

  const money = (paise: number) =>
    (paise > 0 ? <span className="font-mono text-xs">{formatCurrency(paise)}</span> : <span className="text-muted-foreground">-</span>);

  const columns: Column<StaffAccountRow>[] = [
    {
      key: 'name', header: 'Employee',
      render: (r) => (
        <span className="grid gap-0.5">
          <span className="font-medium">{r.fullName}</span>
          <span className="text-micro text-muted-foreground">
            {r.userCode}
            {r.openDocs.length > 0 && <> · <span className="font-mono">{r.openDocs.join(', ')}</span></>}
            {!r.isActive && <> · <Badge tone="neutral">left</Badge></>}
          </span>
        </span>
      ),
      sortValue: (r) => r.fullName,
    },
    {
      key: 'salary', header: 'Salary / month', align: 'end',
      render: (r) => (r.monthlySalaryPaise > 0
        ? <span className="font-mono text-xs">{formatCurrency(r.monthlySalaryPaise)}</span>
        : <span className="text-micro text-muted-foreground">not set up</span>),
      sortValue: (r) => r.monthlySalaryPaise,
    },
    {
      key: 'loanTaken', header: 'Loan taken', align: 'end',
      render: (r) => money(r.loanTakenPaise), sortValue: (r) => r.loanTakenPaise,
    },
    {
      key: 'emi', header: 'EMI', align: 'end',
      render: (r) => money(r.loanEmiPaise), sortValue: (r) => r.loanEmiPaise,
    },
    {
      key: 'instalments', header: 'Instalments',
      render: (r) => (r.loanTenureMonths > 0
        ? (
          <Badge tone={r.loanPaidCount >= r.loanTenureMonths ? 'success' : 'warning'}>
            {r.loanPaidCount} / {r.loanTenureMonths}
          </Badge>
        )
        : <span className="text-muted-foreground">-</span>),
      sortValue: (r) => (r.loanTenureMonths > 0 ? r.loanPaidCount / r.loanTenureMonths : -1),
    },
    {
      key: 'loanLeft', header: 'Loan left', align: 'end',
      render: (r) => money(r.loanLeftPaise), sortValue: (r) => r.loanLeftPaise,
    },
    {
      key: 'advGiven', header: 'Advance given', align: 'end', optional: true,
      render: (r) => money(r.advanceGivenPaise), sortValue: (r) => r.advanceGivenPaise,
    },
    {
      key: 'advLeft', header: 'Advance left', align: 'end',
      render: (r) => money(r.advanceLeftPaise), sortValue: (r) => r.advanceLeftPaise,
    },
    {
      key: 'owedBy', header: 'Staff owes', align: 'end',
      render: (r) => (r.owedByStaffPaise > 0
        ? <span className="font-mono text-xs font-semibold text-warning">{formatCurrency(r.owedByStaffPaise)}</span>
        : <span className="text-muted-foreground">-</span>),
      sortValue: (r) => r.owedByStaffPaise,
    },
    {
      key: 'owedTo', header: 'Business owes', align: 'end',
      render: (r) => (r.owedToStaffPaise > 0
        ? <span className="font-mono text-xs font-semibold text-danger">{formatCurrency(r.owedToStaffPaise)}</span>
        : <span className="text-muted-foreground">-</span>),
      sortValue: (r) => r.owedToStaffPaise,
    },
  ];

  return (
    <div>
      <PageHeader
        badge="SA"
        title="Staff Account"
        subtitle={`${rows.length} ${rows.length === 1 ? 'person' : 'people'} · what each one owes, and what is owed to them`}
      />

      <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-sm leading-relaxed text-muted-foreground">
          This screen only shows. Give a <strong>loan or a salary advance</strong> at HRM › Loans &amp; Salary
          Advances, record a <strong>claim</strong> at HRM › Payroll › Claims, and put the office&rsquo;s own spending -
          chai, petrol, rent - in <strong>Office Expenses</strong>, where it becomes a cost instead of a debt
          against somebody.
        </p>
      </div>

      <KpiStrip cards={kpis} activeKey={filter} onSelect={setFilter} columns={5} />

      <div className="my-3">
        <Toolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Name, code, or a loan number"
          count={`Showing ${shown.length} of ${rows.length}`}
        />
      </div>

      <DataGrid
        exportAs={{ title: 'Staff accounts' }}
        rows={shown}
        columns={columns}
        rowKey={(r) => r.userId}
        emptyIcon="users"
        emptyMessage="Nobody holds a role in this branch yet."
        pageSizes={[10, 25, 50, 100]}
        actions={[
          { label: 'History', icon: 'file-text', onSelect: (r) => setHistoryFor(r) },
        ]}
      />

      {historyFor && <HistoryDialog row={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

interface TxnVM {
  id: string;
  kind: string;
  amountPaise: number;
  txnDate: string;
  method: string;
  note: string | null;
  status: string;
  reversalReason: string | null;
}

/** Every movement behind one person's figures. Read-only, like the screen. */
function HistoryDialog({ row, onClose }: { row: StaffAccountRow; onClose: () => void }) {
  const [txns, setTxns] = useState<TxnVM[] | null>(null);

  useEffect(() => {
    void loadTransactionsForUser(row.userId).then((t) => setTxns(t as TxnVM[]));
  }, [row.userId]);

  return (
    <Modal
      open
      title={row.fullName}
      subtitle="Everything behind the figures"
      icon="file-text"
      size="lg"
      onClose={onClose}
      footer={<div className="flex w-full justify-end"><Button onClick={onClose}>Close</Button></div>}
    >
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">Owes the business</p>
          <p className="font-mono text-base font-semibold text-warning">{formatCurrency(row.owedByStaffPaise)}</p>
          <p className="text-micro text-muted-foreground">
            Loan {formatCurrency(row.loanLeftPaise)} · advance {formatCurrency(row.advanceLeftPaise)}
          </p>
        </div>
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">The business owes</p>
          <p className="font-mono text-base font-semibold text-danger">{formatCurrency(row.owedToStaffPaise)}</p>
          <p className="text-micro text-muted-foreground">Approved claims not paid yet</p>
        </div>
      </div>

      {txns === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : txns.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded against this person yet.</p>
      ) : (
        <div className="grid gap-2">
          {txns.map((t) => (
            <div key={t.id} className="rounded-lg border border-border px-3 py-2 text-sm">
              <p className={t.status === 'reversed' ? 'text-muted-foreground line-through' : 'font-medium'}>
                {KIND_LABEL[t.kind] ?? t.kind} - {formatCurrency(t.amountPaise)}
              </p>
              <p className="text-xs text-muted-foreground">
                {fmtDate(t.txnDate)} · {t.method}
                {t.note ? ` · ${t.note}` : ''}
                {t.status === 'reversed' && t.reversalReason ? ` · reversed: ${t.reversalReason}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
