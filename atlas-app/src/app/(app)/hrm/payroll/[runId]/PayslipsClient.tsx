'use client';

import { EmployeeLink } from '@/components/document/EmployeeLink';
import { sayIfHeld } from '@/lib/held-message';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Icon } from '@/components/ui/Icon';
import { QuickFilter, matches } from '@/components/ui/QuickFilter';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import { processPayrollRunAction, markPayrollRunPaidAction, revertPayrollRunAction } from './actions';

export interface PayrollRunVM {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  locked: boolean;
  employeeCount: number;
  grossPaise: number;
  netPaise: number;
  /** Set when this run was taken back to draft after being processed. */
  revertedAt: string | null;
  revertReason: string | null;
}

export interface PayslipDetailVM {
  id: string;
  userId: string;
  employeeName: string;
  employeeCode: string;
  workingDays: number;
  paidDays: string;
  lopDays: string;
  grossPaise: number;
  totalDeductionsPaise: number;
  netPaise: number;
  lines: { kind: string; code: string; label: string; amountPaise: number }[];
}

const STATUS_TONE: Record<string, 'warning' | 'info' | 'success'> = {
  draft: 'warning', processed: 'info', paid: 'success',
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function PayslipsClient({
  run, payslips, canProcess,
}: {
  run: PayrollRunVM;
  payslips: PayslipDetailVM[];
  canProcess: boolean;
}) {
  const router = useRouter();
  const [confirmingProcess, setConfirmingProcess] = useState(false);
  const [confirmingPay, setConfirmingPay] = useState(false);
  const [payMethod, setPayMethod] = useState('bank');
  const [reverting, setReverting] = useState(false);
  const [revertReason, setRevertReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  // G-07: find one person's payslip in a run of fifty; spot loss-of-pay.
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('all');
  const shownSlips = payslips.filter((p) => matches(q, p.employeeName, p.employeeCode)
    && (only === 'all' || (only === 'lop' && Number(p.lopDays) > 0) || (only === 'deductions' && p.totalDeductionsPaise > 0)));
  const [pending, startTransition] = useTransition();

  const process = () => {
    setActionError(null);
    startTransition(async () => {
      const res = await processPayrollRunAction(run.id);
      if (res.error) { setActionError(res.error); return; }
      sayIfHeld(res);
      setConfirmingProcess(false);
      router.refresh();
    });
  };

  const markPaid = () => {
    setActionError(null);
    startTransition(async () => {
      const res = await markPayrollRunPaidAction(run.id, payMethod);
      if (res.error) { setActionError(res.error); return; }
      sayIfHeld(res);
      setConfirmingPay(false);
      router.refresh();
    });
  };

  const revert = () => {
    setActionError(null);
    startTransition(async () => {
      const res = await revertPayrollRunAction(run.id, revertReason);
      if (res.error) { setActionError(res.error); return; }
      sayIfHeld(res);
      setReverting(false);
      setRevertReason('');
      router.refresh();
    });
  };

  const kpis: KpiCard[] = [
    { key: 'employees', label: 'Employees', count: run.employeeCount, icon: 'users' },
    { key: 'gross', label: 'Gross', count: formatCurrencyCompact(run.grossPaise), icon: 'receipt', tone: 'info' },
    {
      key: 'deductions', label: 'Deductions',
      count: formatCurrencyCompact(run.grossPaise - run.netPaise), icon: 'file-text', tone: 'warning',
    },
    { key: 'net', label: 'Net Payable', count: formatCurrencyCompact(run.netPaise), icon: 'check-circle', tone: 'success' },
  ];

  const columns: Column<PayslipDetailVM>[] = [
    {
      key: 'employee', header: 'Employee',
      render: (p) => (
        <div>
          <div className="font-medium"><EmployeeLink id={p.userId}>{p.employeeName}</EmployeeLink></div>
          <div className="text-xs text-muted-foreground">{p.employeeCode}</div>
        </div>
      ),
      sortValue: (p) => p.employeeName,
    },
    {
      key: 'days', header: 'Paid / Working Days', align: 'end',
      render: (p) => (
        <span className="font-mono text-xs">
          {p.paidDays} / {p.workingDays}
          {Number(p.lopDays) > 0 && <span className="ms-1 text-danger">(-{p.lopDays} LOP)</span>}
        </span>
      ),
      sortValue: (p) => Number(p.lopDays),
      optional: true,
    },
    { key: 'gross', header: 'Gross', align: 'end', render: (p) => <span className="font-mono text-xs">{formatCurrency(p.grossPaise)}</span>, sortValue: (p) => p.grossPaise },
    { key: 'deductions', header: 'Deductions', align: 'end', render: (p) => <span className="font-mono text-xs text-danger">-{formatCurrency(p.totalDeductionsPaise)}</span>, sortValue: (p) => p.totalDeductionsPaise },
    { key: 'net', header: 'Net Pay', align: 'end', render: (p) => <span className="font-mono text-xs font-medium">{formatCurrency(p.netPaise)}</span>, sortValue: (p) => p.netPaise },
  ];

  return (
    <div>
      <Link href="/hrm/payroll" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <Icon name="arrow-left" className="h-3.5 w-3.5" />
        All payroll runs
      </Link>

      <PageHeader
        badge="₹"
        title={run.label}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{fmtDate(run.periodStart)} - {fmtDate(run.periodEnd)}</span>
            <span className="text-muted-foreground">·</span>
            <Badge tone={STATUS_TONE[run.status] ?? 'neutral'}>{run.status}</Badge>
            {run.locked && <Badge tone="neutral" icon="lock">locked</Badge>}
          </span>
        }
        actions={canProcess && (
          <>
            {run.status === 'draft' && (
              <Button variant="primary" icon="lock" onClick={() => setConfirmingProcess(true)}>Process payroll</Button>
            )}
            {run.status === 'processed' && (
              <Button variant="primary" icon="check-circle" onClick={() => setConfirmingPay(true)}>Mark as paid</Button>
            )}
            {(run.status === 'processed' || run.status === 'paid') && (
              <Button icon="rotate-ccw" onClick={() => setReverting(true)}>Take back to draft</Button>
            )}
          </>
        )}
      />

      {actionError && (
        <Card className="mb-3 flex items-start gap-2.5 border-danger/40 bg-danger/5 px-3 py-2.5">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="text-sm text-danger">{actionError}</p>
        </Card>
      )}

      {run.status === 'draft' && (
        <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-sm leading-relaxed">
            Still a draft - can be regenerated from the Dashboard as attendance and leave records
            change. Processing posts it to the general ledger and locks these numbers for good.
          </p>
        </Card>
      )}

      {run.revertedAt && (
        <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
          <Icon name="rotate-ccw" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-sm leading-relaxed">
            This run was taken back to draft on {fmtDate(run.revertedAt)}
            {run.revertReason ? <> - {run.revertReason}</> : null}. The earlier ledger entries were
            reversed, not deleted, and the loan EMI it had collected was given back.
          </p>
        </Card>
      )}

      <KpiStrip cards={kpis} activeKey={null} onSelect={() => {}} columns={4} />

      <div className="my-3">
        <QuickFilter search={q} onSearch={setQ} placeholder="Employee name or code" shown={shownSlips.length} total={payslips.length}
          choice={{ label: 'Show', value: only, onChange: setOnly, options: [
            { value: 'all', label: 'Everyone' }, { value: 'lop', label: 'With loss of pay' }, { value: 'deductions', label: 'With deductions' },
          ] }} />
      </div>

      <DataGrid
        exportAs={{ title: 'Payslips' }}
        rows={shownSlips}
        columns={columns}
        rowKey={(p) => p.id}
        emptyIcon="file-text"
        emptyMessage="No payslips in this run."
        pageSizes={[10, 25, 50, 100]}
        actions={[
          { label: 'View payslip', icon: 'file-text', onSelect: (p) => router.push(`/hrm/payroll/${run.id}/payslip/${p.id}`) },
        ]}
      />

      {reverting && (
        <Modal
          open
          title={`Take ${run.label} back to draft?`}
          subtitle="For correcting a month that was already processed"
          icon="rotate-ccw"
          size="md"
          onClose={() => setReverting(false)}
          footer={
            <div className="flex w-full items-center justify-end gap-2">
              <Button onClick={() => setReverting(false)} disabled={pending}>Cancel</Button>
              <Button variant="danger" icon="rotate-ccw" disabled={!revertReason.trim() || pending} loading={pending} onClick={revert}>
                Take back to draft
              </Button>
            </div>
          }
        >
          <div className="grid gap-3">
            <p className="text-sm leading-relaxed">
              This run goes back to <strong>draft</strong> so you can fix the figures and generate it again.
            </p>
            <ul className="grid gap-1.5 text-sm text-muted-foreground">
              <li>· The ledger entries are <strong>reversed, not deleted</strong> - dated today, so the original posting stays on the record.</li>
              <li>· The <strong>loan EMI this run collected is given back</strong>, so the rebuilt run collects it once, not twice. A loan it had closed reopens.</li>
              <li>· The payslips stay on screen until you generate the run again.</li>
              <li>· If this month is already closed in the books, reopen it before processing again.</li>
            </ul>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Why (kept on the record)
              <input
                type="text" value={revertReason} onChange={(e) => setRevertReason(e.target.value)}
                placeholder="Deepak's attendance was wrong for 3 days"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
          </div>
        </Modal>
      )}

      {confirmingProcess && (
        <ConfirmDialog
          title={`Process ${run.label}?`}
          message={
            <>
              Posts {formatCurrency(run.grossPaise)} of wages, every statutory deduction and any
              loan recovery to the general ledger, and locks these {payslips.length} payslip
              {payslips.length === 1 ? '' : 's'} for good - this run can no longer be regenerated
              from the Dashboard afterward.
            </>
          }
          confirmLabel="Process"
          busy={pending}
          onConfirm={process}
          onClose={() => setConfirmingProcess(false)}
        />
      )}

      {confirmingPay && (
        <ConfirmDialog
          title={`Mark ${run.label} as paid?`}
          message={
            <div className="grid gap-3">
              <p>
                Clears {formatCurrency(run.netPaise)} of net pay owed against cash or bank - only
                do this once the money has actually left the account.
              </p>
              <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                Paid from
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="bank">Bank transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="cash">Cash</option>
                </select>
              </label>
            </div>
          }
          confirmLabel="Mark as paid"
          busy={pending}
          onConfirm={markPaid}
          onClose={() => setConfirmingPay(false)}
        />
      )}
    </div>
  );
}
