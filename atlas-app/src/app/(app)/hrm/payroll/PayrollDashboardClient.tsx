'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { formatCurrencyCompact } from '@/lib/format';
import { generateCurrentPayrollRunAction } from './actions';

export interface PayrollRunRowVM {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  locked: boolean;
  employeeCount: number;
  grossPaise: number;
  netPaise: number;
}

const STATUS_TONE: Record<string, 'warning' | 'info' | 'success'> = {
  draft: 'warning', processed: 'info', paid: 'success',
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function PayrollDashboardClient({
  runs, currentPeriodLabel, canProcess,
}: {
  runs: PayrollRunRowVM[];
  currentPeriodLabel: string;
  canProcess: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const currentRun = runs.find((r) => r.label === currentPeriodLabel);
  const latest = runs[0] ?? null;

  const kpis: KpiCard[] = [
    { key: 'runs', label: 'Payroll Runs', count: runs.length, icon: 'file-text' },
    { key: 'employees', label: `${latest ? latest.label : 'Latest'} Employees`, count: latest?.employeeCount ?? 0, icon: 'users' },
    { key: 'gross', label: `${latest ? latest.label : 'Latest'} Gross`, count: latest ? formatCurrencyCompact(latest.grossPaise) : '₹ 0', icon: 'receipt', tone: 'info' },
    { key: 'net', label: `${latest ? latest.label : 'Latest'} Net`, count: latest ? formatCurrencyCompact(latest.netPaise) : '₹ 0', icon: 'check-circle', tone: 'success' },
  ];

  const generate = () => {
    setError(null);
    startTransition(async () => {
      const res = await generateCurrentPayrollRunAction();
      if (res.error) { setError(res.error); return; }
      if (res.runId) router.push(`/hrm/payroll/${res.runId}`);
    });
  };

  const columns: Column<PayrollRunRowVM>[] = [
    {
      key: 'period', header: 'Period',
      render: (r) => (
        <div>
          <div className="font-medium">{r.label}</div>
          <div className="text-xs text-muted-foreground">{fmtDate(r.periodStart)} - {fmtDate(r.periodEnd)}</div>
        </div>
      ),
      sortValue: (r) => r.periodStart,
    },
    {
      key: 'status', header: 'Status',
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
          {r.locked && <Badge tone="neutral" icon="lock">locked</Badge>}
        </div>
      ),
      sortValue: (r) => r.status,
    },
    { key: 'employees', header: 'Employees', align: 'end', render: (r) => r.employeeCount, sortValue: (r) => r.employeeCount },
    { key: 'gross', header: 'Gross', align: 'end', render: (r) => <span className="font-mono text-xs">{formatCurrencyCompact(r.grossPaise)}</span>, sortValue: (r) => r.grossPaise },
    { key: 'net', header: 'Net', align: 'end', render: (r) => <span className="font-mono text-xs font-medium">{formatCurrencyCompact(r.netPaise)}</span>, sortValue: (r) => r.netPaise },
  ];

  return (
    <div>
      <PageHeader
        badge="₹"
        title="Payroll Dashboard"
        subtitle={`${runs.length} payroll run${runs.length === 1 ? '' : 's'}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button icon="file-text" onClick={() => router.push('/hrm/payroll/contracts')}>Contracts</Button>
            {canProcess && (
              <Button variant="primary" icon="plus" loading={pending} disabled={pending} onClick={generate}>
                {currentRun ? `Regenerate ${currentPeriodLabel}` : `Generate ${currentPeriodLabel}`}
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <Card className="mb-3 flex items-start gap-2.5 border-danger/40 bg-danger/5 px-3 py-2.5">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="text-sm text-danger">{error}</p>
        </Card>
      )}

      {currentRun?.locked === false && currentRun.status === 'draft' && (
        <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-sm leading-relaxed">
            <strong>{currentPeriodLabel} is still a draft.</strong> Regenerating it recalculates
            every payslip from scratch, from the latest attendance and leave records.
          </p>
        </Card>
      )}

      <KpiStrip cards={kpis} activeKey={null} onSelect={() => {}} columns={4} />

      <DataGrid
        exportAs={{ title: 'Payroll runs' }}
        rows={runs}
        columns={columns}
        rowKey={(r) => r.id}
        emptyIcon="receipt"
        emptyMessage="No payroll runs yet."
        emptyHint={canProcess ? `Generate ${currentPeriodLabel} to get started.` : 'Ask an admin to run payroll for the first time.'}
        pageSizes={[10, 25, 50]}
        actions={[
          { label: 'View payslips', icon: 'file-text', onSelect: (r) => router.push(`/hrm/payroll/${r.id}`) },
        ]}
      />
    </div>
  );
}
