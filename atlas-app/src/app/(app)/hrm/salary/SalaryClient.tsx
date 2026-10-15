'use client';

import { EmployeeLink } from '@/components/document/EmployeeLink';
import { useMemo, useState, useTransition } from 'react';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Badge, PageHeader, Card } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Toolbar, ToolbarIcon } from '@/components/ui/Toolbar';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import type { EmployeeSalaryRow, PayrollSummary } from '@/server/payroll';
import { saveSalaryStructureAction, setSalaryActiveAction } from './actions';

export function SalaryClient({
  rows, summary, canEdit,
}: {
  rows: EmployeeSalaryRow[];
  summary: PayrollSummary;
  canEdit: boolean;
}) {
  const [search, setSearch] = useState('');
  // G-07: the question on this screen is "who has no salary set yet".
  const [only, setOnly] = useState('all');
  const [editing, setEditing] = useState<EmployeeSalaryRow | null>(null);

  const kpis: KpiCard[] = [
    { key: 'gross', label: 'Gross Payroll', count: formatCurrencyCompact(summary.grossPaise), icon: 'receipt', tone: 'info' },
    { key: 'pf', label: 'PF Deduction', count: formatCurrencyCompact(summary.pfPaise), icon: 'lock' },
    { key: 'esic', label: 'ESIC Deduction', count: formatCurrencyCompact(summary.esicPaise), icon: 'file-text' },
    { key: 'advances', label: 'Salary Advances', count: formatCurrencyCompact(summary.advancesOutstandingPaise), icon: 'credit-card', tone: 'warning' },
    // Not a payroll net - see getPayrollSummary. The real net is on the run's payslips.
    { key: 'net', label: 'After PF & ESIC', count: formatCurrencyCompact(summary.netPaise), icon: 'check-circle', tone: 'success' },
  ];

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (!q || r.fullName.toLowerCase().includes(q) || r.userCode.toLowerCase().includes(q))
      && (only === 'all' || (only === 'unset' && !r.hasStructure) || (only === 'nopf' && r.hasStructure && !r.pfApplicable)
        || (only === 'inactive' && r.hasStructure && !r.isActive)));
  }, [rows, search, only]);

  const columns: Column<EmployeeSalaryRow>[] = [
    {
      key: 'employee', header: 'Employee',
      render: (r) => (
        <div>
          <div className="font-medium"><EmployeeLink id={r.userId}>{r.fullName}</EmployeeLink></div>
          <div className="text-xs text-muted-foreground">{r.userCode}</div>
        </div>
      ),
      sortValue: (r) => r.fullName,
    },
    { key: 'basic', header: 'Basic', align: 'end', render: (r) => <span className="font-mono text-xs">{r.hasStructure ? formatCurrency(r.basicPaise) : '-'}</span>, sortValue: (r) => r.basicPaise },
    { key: 'hra', header: 'HRA', align: 'end', render: (r) => <span className="font-mono text-xs">{r.hasStructure ? formatCurrency(r.hraPaise) : '-'}</span>, sortValue: (r) => r.hraPaise, optional: true },
    { key: 'allowances', header: 'Allowances', align: 'end', render: (r) => <span className="font-mono text-xs">{r.hasStructure ? formatCurrency(r.allowancesPaise) : '-'}</span>, sortValue: (r) => r.allowancesPaise, optional: true },
    { key: 'gross', header: 'Gross', align: 'end', render: (r) => <span className="font-mono text-xs font-medium">{r.hasStructure ? formatCurrency(r.grossPaise) : '-'}</span>, sortValue: (r) => r.grossPaise },
    {
      key: 'flags', header: 'PF / ESIC',
      render: (r) => r.hasStructure ? (
        <div className="flex gap-1">
          <Badge tone={r.pfApplicable ? 'success' : 'neutral'}>PF {r.pfApplicable ? 'on' : 'off'}</Badge>
          <Badge tone={r.esicApplicable ? 'success' : 'neutral'}>ESIC {r.esicApplicable ? 'on' : 'off'}</Badge>
        </div>
      ) : <span className="text-xs text-muted-foreground">-</span>,
      optional: true,
    },
    {
      key: 'status', header: 'Status',
      render: (r) => r.hasStructure
        ? <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'active' : 'inactive'}</Badge>
        : <Badge tone="warning">not set</Badge>,
      sortValue: (r) => (r.hasStructure ? (r.isActive ? 1 : 0) : -1),
    },
  ];

  return (
    <div>
      <PageHeader badge="SL" title="Salary Structure" subtitle={`${rows.length} employees`} />

      <Card className="mb-4 flex items-start gap-2.5 px-3 py-2.5">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          A light, indicative view - Basic/HRA/Allowances per employee and a rough monthly summary.
          The figures above come from salary structures, not from a payroll run: loss of pay, TDS,
          professional tax and loan EMI are not in them. For what people are actually paid, open the
          month in Payroll.
          PF is 12% of Basic and ESIC is 0.75% of Gross, both simple arithmetic, not a statutory
          payroll engine. Real payroll runs under HRM → Payroll.
        </p>
      </Card>

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Employee name or code…"
        filters={
          <select aria-label="Show" value={only} onChange={(e) => setOnly(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-2 text-sm outline-none focus:border-brand">
            <option value="all">Everyone</option>
            <option value="unset">Salary not set ({rows.filter((r) => !r.hasStructure).length})</option>
            <option value="nopf">PF off</option>
            <option value="inactive">Inactive structure</option>
          </select>
        }
        count={`Total (${visible.length})`}
        end={<ToolbarIcon icon="refresh" label="Refresh" onClick={() => window.location.reload()} />}
      />

      <KpiStrip cards={kpis} activeKey={null} onSelect={() => {}} columns={5} />

      <DataGrid
        rows={visible}
        columns={columns}
        rowKey={(r) => r.userId}
        emptyIcon="receipt"
        emptyMessage="No employees found."
        pageSizes={[10, 25, 50, 100]}
        pageSummary={(pageRows) => (
          <span className="text-muted-foreground">
            Count: <strong className="text-foreground">{pageRows.length}</strong>
          </span>
        )}
        actions={canEdit ? [
          { label: 'Set salary', icon: 'receipt', onSelect: (r) => setEditing(r) },
          {
            label: 'Deactivate', icon: 'x-circle', enabled: (r) => r.hasStructure && r.isActive,
            onSelect: (r) => void setSalaryActiveAction(r.userId, false).then(() => window.location.reload()),
          },
          {
            label: 'Reactivate', icon: 'check-circle', enabled: (r) => r.hasStructure && !r.isActive,
            onSelect: (r) => void setSalaryActiveAction(r.userId, true).then(() => window.location.reload()),
          },
        ] : []}
      />

      {editing && (
        <SalaryDialog row={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); window.location.reload(); }} />
      )}
    </div>
  );
}

function SalaryDialog({ row, onClose, onDone }: { row: EmployeeSalaryRow; onClose: () => void; onDone: () => void }) {
  const [basic, setBasic] = useState(row.hasStructure ? String(row.basicPaise / 100) : '');
  const [hra, setHra] = useState(row.hasStructure ? String(row.hraPaise / 100) : '0');
  const [allowances, setAllowances] = useState(row.hasStructure ? String(row.allowancesPaise / 100) : '0');
  const [pfApplicable, setPfApplicable] = useState(row.pfApplicable);
  const [esicApplicable, setEsicApplicable] = useState(row.esicApplicable);
  const [notes, setNotes] = useState(row.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = Number(basic) > 0;

  const save = () => {
    startTransition(async () => {
      const res = await saveSalaryStructureAction({
        userId: row.userId,
        basicPaise: Math.round(Number(basic) * 100),
        hraPaise: Math.round(Number(hra || 0) * 100),
        allowancesPaise: Math.round(Number(allowances || 0) * 100),
        pfApplicable, esicApplicable,
        notes: notes.trim() || null,
      });
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <Modal
      open
      title={row.fullName}
      subtitle="Monthly salary structure"
      icon="receipt"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={!ready || pending} loading={pending} onClick={save}>
            Save
          </Button>
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
          Basic (₹/month)
          <input type="number" min={1} value={basic} onChange={(e) => setBasic(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            HRA (₹/month)
            <input type="number" min={0} value={hra} onChange={(e) => setHra(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Allowances (₹/month)
            <input type="number" min={0} value={allowances} onChange={(e) => setAllowances(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </label>
        </div>

        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={pfApplicable} onChange={(e) => setPfApplicable(e.target.checked)} />
            PF applicable
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={esicApplicable} onChange={(e) => setEsicApplicable(e.target.checked)} />
            ESIC applicable
          </label>
        </div>

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Notes
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
      </div>
    </Modal>
  );
}
