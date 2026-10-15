'use client';
import { EmployeeLink } from '@/components/document/EmployeeLink';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { ServerExportButton } from '@/components/ui/ServerExportButton';
import { useListParams } from '@/components/ui/useListParams';
import { useUrlDateRange } from '@/components/ui/DateRangeSelect';

import { useState, useTransition } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge, Field, PageHeader, type BadgeTone } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, toPaise, toRupees } from '@/lib/format';
import { buildLoanSchedule } from '@/lib/loan-schedule';
import {
  createLoanAction, recordLoanRepaymentAction,
  setAdvanceRecoveryAction, recordAdvanceRepaymentAction,
} from './actions';

interface LoanRowVM {
  id: string;
  userId: string;
  userName: string;
  principalPaise: number;
  emiPaise: number;
  tenureMonths: number;
  startPeriod: string;
  reason: string | null;
  status: string;
  repaidPaise: number;
  createdAt: string;
  kind: 'loan' | 'advance';
  loanNo: string | null;
  paidCount: number;
  outstandingPaise: number;
}

interface Props {
  /** One server-side page (F1b): searched, filtered and sorted on the server. */
  loans: LoanRowVM[];
  paging: ServerPaging;
  /** Loans before filters. */
  total: number;
  statuses: { value: string; label: string; n: number }[];
  employees: { id: string; fullName: string }[];
  canManage: boolean;
  views: FilterBarViews;
  /** This branch's rule for taking plain advances out of salary. */
  recovery: { enabled: boolean; maxPaise: number };
  /** Older advances with no schedule - what is still owed, and by whom. */
  plainAdvances: { userId: string; fullName: string; outstandingPaise: number }[];
}

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

const STATUS_TONE: Record<string, BadgeTone> = { active: 'info', closed: 'success', written_off: 'danger' };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function LoansClient({
  loans, employees, canManage, views, paging, total, statuses, recovery, plainAdvances,
}: Props) {
  // `null` = closed. Otherwise which of the two is being raised: the form is
  // the same, only the defaults and the words change (9 Oct 2026).
  const [adding, setAdding] = useState<'loan' | 'advance' | null>(null);
  const [repaying, setRepaying] = useState<LoanRowVM | null>(null);
  const [scheduling, setScheduling] = useState<LoanRowVM | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useListParams();
  // The date filter (9 Oct 2026): when the loan or advance was given.
  const range = useUrlDateRange();

  const report = (res: { error?: string; message?: string }, okMessage: string) => {
    setError(res.error ?? null);
    // A loan held for approval says so instead of "Loan disbursed."
    setNotice(res.error ? null : res.message ?? okMessage);
  };

  // Search and status run on the server (server/loans-list) - F1b server paging.
  const status = list.get('status');

  const columns: Column<LoanRowVM>[] = [
    {
      key: 'kind', header: 'Type', width: '150px',
      render: (r: LoanRowVM) => (
        <span className="grid gap-0.5">
          <Badge tone={r.kind === 'advance' ? 'warning' : 'info'}>
            {r.kind === 'advance' ? 'Salary advance' : 'Loan'}
          </Badge>
          {r.loanNo && <span className="font-mono text-micro text-muted-foreground">{r.loanNo}</span>}
        </span>
      ),
      sortValue: (r: LoanRowVM) => `${r.kind}${r.loanNo ?? ''}`,
    },
    {
      key: 'employee', header: 'Employee',
      sortValue: (l) => l.userName,
      render: (l) => <span className="font-medium"><EmployeeLink id={l.userId}>{l.userName}</EmployeeLink></span>,
    },
    {
      key: 'principal', header: 'Principal', align: 'end', width: '120px',
      sortValue: (l) => l.principalPaise,
      render: (l) => formatCurrency(l.principalPaise),
    },
    {
      key: 'emi', header: 'EMI × Tenure', width: '150px',
      sortValue: (l) => l.emiPaise,
      render: (l) => <span className="text-muted-foreground">{formatCurrency(l.emiPaise)} × {l.tenureMonths}</span>,
    },
    {
      key: 'instalments', header: 'Instalments', width: '110px',
      render: (r: LoanRowVM) => (
        <span className="font-mono text-xs">{r.paidCount} / {r.tenureMonths}</span>
      ),
      sortValue: (r: LoanRowVM) => r.paidCount,
    },
    {
      key: 'outstanding', header: 'Outstanding', align: 'end', width: '130px',
      // The column this screen exists for, so it sorts on the real number.
      sortValue: (l) => l.principalPaise - l.repaidPaise,
      render: (l) => <span className="font-medium">{formatCurrency(l.principalPaise - l.repaidPaise)}</span>,
    },
    {
      key: 'status', header: 'Status', width: '120px',
      sortValue: (l) => l.status,
      render: (l) => <Badge tone={STATUS_TONE[l.status] ?? 'neutral'}>{l.status.replace('_', ' ')}</Badge>,
    },
    {
      key: 'started', header: 'Started', width: '120px', optional: true,
      sortValue: (l) => l.startPeriod,
      render: (l) => <span className="text-muted-foreground">{fmtDate(l.startPeriod)}</span>,
    },
    {
      key: 'reason', header: 'Reason', optional: true,
      sortValue: (l) => l.reason ?? '',
      render: (l) => <span className="text-muted-foreground">{l.reason ?? '-'}</span>,
    },
    {
      key: 'actions', header: '', width: '140px', align: 'end',
      render: (l) => (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setScheduling(l)} className="text-xs font-medium text-brand hover:underline">
            Schedule
          </button>
          {canManage && l.status === 'active' && (
            <button type="button" onClick={() => setRepaying(l)} className="text-xs font-medium text-brand hover:underline">
              Repay
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        badge="LN"
        title="Loans & Salary Advances"
        subtitle="Loans and salary advances - both come back through the payslip"
        actions={canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon="plus" disabled={employees.length === 0} onClick={() => setAdding('advance')}>
              Salary advance
            </Button>
            <Button size="sm" variant="primary" icon="plus" disabled={employees.length === 0} onClick={() => setAdding('loan')}>
              New loan
            </Button>
          </div>
        )}
      />

      {error && (
        <div className="mb-3 flex gap-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && (
        <div className="mb-3 flex gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-on-tint-success">
          <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* F1b / D17: search, status filter and a per-user saved layout. The
          question this screen gets opened for is "what is still owed", which
          nobody could answer without reading every row. */}
      <FilterBar
        searchPlaceholder="Employee, reason, status…"
        shown={paging.total}
        total={total}
        tools={<ServerExportButton screen="loans" />}
        dates={{ defaultPreset: 'all', label: 'Given', activeLabel: range.label }}
        clearKeys={['status']}
        views={views}
        extra={
          <select
            aria-label="Status" value={status ?? ''}
            onChange={(e) => list.set({ status: e.target.value || null })}
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand"
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>{s.label} ({s.n})</option>
            ))}
          </select>
        }
      />

      <DataGrid
        rows={loans}
        server={paging}
        columns={columns}
        rowKey={(l) => l.id}
        emptyIcon="receipt"
        emptyMessage={total === 0 ? 'No loans yet' : 'Nothing matches those filters'}
        emptyHint={total === 0
          ? 'Nothing has been advanced against payroll for this branch.'
          : 'Clear the filters to see every loan.'}
        pageSummary={(pageRows) => (
          <span>
            Outstanding on this page:{' '}
            <strong>{formatCurrency(pageRows.reduce((n, l) => n + (l.principalPaise - l.repaidPaise), 0))}</strong>
          </span>
        )}
        mobileCard={(l) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">{l.userName}</p>
              <p className="text-xs text-muted-foreground">
                {formatCurrency(l.emiPaise)} × {l.tenureMonths} · {formatCurrency(l.principalPaise)} advanced
              </p>
            </div>
            <div className="shrink-0 text-end">
              <Badge tone={STATUS_TONE[l.status] ?? 'neutral'}>{l.status.replace('_', ' ')}</Badge>
              <p className="mt-1 text-xs font-medium">{formatCurrency(l.principalPaise - l.repaidPaise)} left</p>
            </div>
          </div>
        )}
      />

      <AdvanceRecoveryCard canManage={canManage} recovery={recovery} plainAdvances={plainAdvances} />


      {adding !== null && (
        <AddLoanModal
          employees={employees}
          kind={adding}
          onClose={() => setAdding(null)}
          onSaved={(res) => { report(res, adding === 'advance' ? 'Advance paid out.' : 'Loan disbursed.'); if (!res.error) setAdding(null); }}
        />
      )}
      {repaying && (
        <RepayModal
          loan={repaying}
          onClose={() => setRepaying(null)}
          onSaved={(res) => { report(res, 'Repayment recorded.'); if (!res.error) setRepaying(null); }}
        />
      )}
      {scheduling && (
        <ScheduleModal loan={scheduling} onClose={() => setScheduling(null)} />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------

function AddLoanModal({
  employees, kind, onClose, onSaved,
}: {
  employees: { id: string; fullName: string }[];
  kind: 'loan' | 'advance';
  onClose: () => void;
  onSaved: (res: { error?: string; message?: string }) => void;
}) {
  const isAdvance = kind === 'advance';
  const [userId, setUserId] = useState(employees[0]?.id ?? '');
  const [principal, setPrincipal] = useState('');
  const [emi, setEmi] = useState('');
  // An advance is almost always taken back out of the next salary in one
  // go, so it opens on one month; a loan asks.
  const [tenure, setTenure] = useState(isAdvance ? '1' : '');
  const [startPeriod, setStartPeriod] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('bank');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * The EMI is arithmetic, not a decision: amount / months, rounded up so the
   * last instalment is the short one rather than leaving a few rupees behind.
   * Typed over if somebody wants a different figure.
   */
  const suggestEmi = (amount: string, months: string) => {
    const a = Number(amount);
    const m = Number(months);
    if (!a || !m || m < 1) return;
    setEmi(String(Math.ceil(a / m)));
  };

  const save = () => {
    const principalPaise = toPaise(Number(principal));
    const emiPaise = toPaise(Number(emi));
    const tenureMonths = Number(tenure);
    if (!userId || !principalPaise || !emiPaise || !tenureMonths) {
      setError('Fill in the employee, the amount, the months and what comes out each month.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createLoanAction({
        userId, principalPaise, emiPaise, tenureMonths, startPeriod, method,
        reason: reason.trim() || null, kind,
      });
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title={isAdvance ? 'Salary advance' : 'New loan'}
      subtitle={isAdvance
        ? 'Paid out now, taken back from the salary'
        : 'Paid out now, collected by EMI on each payslip'}
      icon="receipt"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>
            {isAdvance ? 'Pay out' : 'Disburse'}
          </Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="grid gap-3">
        <Field label="Employee" htmlFor="ln-user">
          <select id="ln-user" value={userId} onChange={(e) => setUserId(e.target.value)} className={input}>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={isAdvance ? 'Amount (₹)' : 'Principal (₹)'} htmlFor="ln-principal">
            <input id="ln-principal" type="number" min={1} value={principal}
              onChange={(e) => { setPrincipal(e.target.value); suggestEmi(e.target.value, tenure); }}
              className={input} />
          </Field>
          <Field label="Taken back over (months)" htmlFor="ln-tenure"
            hint={isAdvance ? 'One month = the whole amount from the next salary.' : undefined}>
            <input id="ln-tenure" type="number" min={1} max={120} value={tenure}
              onChange={(e) => { setTenure(e.target.value); suggestEmi(principal, e.target.value); }}
              className={input} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Deducted each month (₹)" htmlFor="ln-emi" hint="Filled in for you - change it if you want.">
            <input id="ln-emi" type="number" min={1} value={emi} onChange={(e) => setEmi(e.target.value)} className={input} />
          </Field>
          <Field label="First deduction" htmlFor="ln-start" hint="The payroll month it starts coming out of.">
            <input id="ln-start" type="date" value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)} className={input} />
          </Field>
        </div>
        <Field label={isAdvance ? 'Paid out by' : 'Disbursed via'} htmlFor="ln-method">
          <select id="ln-method" value={method} onChange={(e) => setMethod(e.target.value)} className={input}>
            <option value="bank">Bank</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
          </select>
        </Field>
        <Field label="Reason" htmlFor="ln-reason" hint="Optional.">
          <input id="ln-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={input} />
        </Field>
      </div>
    </Modal>
  );
}

function RepayModal({
  loan, onClose, onSaved,
}: {
  loan: LoanRowVM;
  onClose: () => void;
  onSaved: (res: { error?: string; message?: string }) => void;
}) {
  const outstandingPaise = loan.principalPaise - loan.repaidPaise;
  const defaultAmount = Math.min(loan.emiPaise, outstandingPaise);
  const [amount, setAmount] = useState(String(toRupees(defaultAmount)));
  const [method, setMethod] = useState('bank');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    const amountPaise = toPaise(Number(amount));
    if (!amountPaise || amountPaise <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await recordLoanRepaymentAction(loan.id, { amountPaise, method });
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title={`Repayment - ${loan.userName}`}
      subtitle={`${formatCurrency(outstandingPaise)} outstanding`}
      icon="receipt"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>Record</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="grid gap-3">
        <Field label="Amount (₹)" htmlFor="rp-amount" hint={<button type="button" className="font-medium text-brand hover:underline" onClick={() => setAmount(String(toRupees(outstandingPaise)))}>Settle in full ({formatCurrency(outstandingPaise)})</button>}>
          <input id="rp-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className={input} />
        </Field>
        <Field label="Received via" htmlFor="rp-method">
          <select id="rp-method" value={method} onChange={(e) => setMethod(e.target.value)} className={input}>
            <option value="bank">Bank</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

function ScheduleModal({ loan, onClose }: { loan: LoanRowVM; onClose: () => void }) {
  const rows = buildLoanSchedule({ ...loan, startPeriod: new Date(loan.startPeriod) }, loan.repaidPaise, new Date());

  return (
    <Modal title={`EMI schedule - ${loan.userName}`} icon="calendar" size="sm" onClose={onClose}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
            <th className="py-1.5 font-medium">#</th>
            <th className="py-1.5 font-medium">Period</th>
            <th className="py-1.5 font-medium">Amount</th>
            <th className="py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.index}>
              <td className="py-1.5 text-muted-foreground">{r.index}</td>
              <td className="py-1.5">{fmtDate(r.period.toISOString())}</td>
              <td className="py-1.5">{formatCurrency(r.duePaise)}</td>
              <td className="py-1.5">
                <Badge tone={r.status === 'paid' ? 'success' : r.status === 'due' ? 'warning' : 'neutral'}>{r.status}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

/**
 * HOW PLAIN ADVANCES COME BACK (moved here 9 Oct 2026).
 *
 * A loan or a scheduled advance collects itself through the payslip. What this
 * covers is the money handed over BEFORE advances had a schedule - balances
 * that sat on Staff Advances with nothing to collect them.
 *
 * Two controls, because there are two ways back: take it out of the salary
 * (off until somebody chooses it - it changes what people are paid), or record
 * the cash when they hand it over.
 */
export function AdvanceRecoveryCard({ canManage, recovery, plainAdvances }: {
  canManage: boolean;
  recovery: { enabled: boolean; maxPaise: number };
  plainAdvances: { userId: string; fullName: string; outstandingPaise: number }[];
}) {
  const [enabled, setEnabled] = useState(recovery.enabled);
  const [maxRupees, setMaxRupees] = useState(recovery.maxPaise ? String(recovery.maxPaise / 100) : '');
  const [repayFor, setRepayFor] = useState<{ userId: string; fullName: string; outstandingPaise: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const owedPaise = plainAdvances.reduce((n, r) => n + r.outstandingPaise, 0);
  const dirty = enabled !== recovery.enabled
    || Math.round((Number(maxRupees) || 0) * 100) !== recovery.maxPaise;

  const save = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await setAdvanceRecoveryAction(enabled, Number(maxRupees) || 0);
      setMsg(res.error ?? res.message ?? 'Saved.');
    });
  };

  return (
    <div className="mt-4 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox" checked={enabled} disabled={!canManage}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Take older advances out of salary
        </label>

        {enabled && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            At most per month ₹
            <input
              type="number" min="0" step="1" value={maxRupees} disabled={!canManage}
              onChange={(e) => setMaxRupees(e.target.value)}
              placeholder="0 = whatever is owed"
              className="h-8 w-36 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
            />
          </label>
        )}

        {canManage && dirty && (
          <Button size="sm" variant="primary" icon="check" loading={pending} onClick={save}>Save</Button>
        )}
        {msg && <span role="status" className="text-xs text-muted-foreground">{msg}</span>}
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
        Only for advances with <strong>no schedule</strong> - money handed over before advances were raised here.
        A loan or an advance in the list above already collects itself every month.
        {enabled
          ? ' Each payroll run takes it off as an "Advance recovery" line, never more than the pay left after everything else.'
          : ' Switched off, nothing is taken and the balance just sits there.'}
      </p>

      {plainAdvances.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs font-medium">
            {plainAdvances.length} {plainAdvances.length === 1 ? 'person owes' : 'people owe'}{' '}
            {formatCurrency(owedPaise)} with no schedule behind it
          </p>
          <div className="mt-2 grid gap-1.5">
            {plainAdvances.map((r) => (
              <div key={r.userId} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{r.fullName}</span>
                <span className="font-mono">{formatCurrency(r.outstandingPaise)}</span>
                {canManage && (
                  <Button size="sm" onClick={() => setRepayFor(r)}>Cash repaid</Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {repayFor && (
        <CashRepaymentModal
          person={repayFor}
          onClose={() => setRepayFor(null)}
          onSaved={(res) => { setMsg(res.error ?? res.message ?? 'Saved.'); if (!res.error) setRepayFor(null); }}
        />
      )}
    </div>
  );
}

function CashRepaymentModal({ person, onClose, onSaved }: {
  person: { userId: string; fullName: string; outstandingPaise: number };
  onClose: () => void;
  onSaved: (res: { error?: string; message?: string }) => void;
}) {
  const [amount, setAmount] = useState(String(person.outstandingPaise / 100));
  const [method, setMethod] = useState('cash');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    const rupees = Number(amount);
    if (!rupees || rupees <= 0) { setError('Enter an amount greater than zero.'); return; }
    setError(null);
    startTransition(async () => {
      const res = await recordAdvanceRepaymentAction(person.userId, rupees, method);
      if (res.error) setError(res.error);
      else onSaved(res);
    });
  };

  return (
    <Modal
      title={`${person.fullName} handed money back`}
      subtitle={`${formatCurrency(person.outstandingPaise)} outstanding with no schedule`}
      icon="credit-card"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>Record it</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="grid gap-3">
        <Field label="Amount (₹)" htmlFor="ar-amount">
          <input id="ar-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className={input} />
        </Field>
        <Field label="Received by" htmlFor="ar-method">
          <select id="ar-method" value={method} onChange={(e) => setMethod(e.target.value)} className={input}>
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}
