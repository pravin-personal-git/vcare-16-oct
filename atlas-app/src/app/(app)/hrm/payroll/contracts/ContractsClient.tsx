'use client';

import { EmployeeLink } from '@/components/document/EmployeeLink';
import { useUrlState } from '@/components/ui/useListParams';
import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { Badge, PageHeader, Card, SummaryRow, EmptyState } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Toolbar } from '@/components/ui/Toolbar';
import { formatCurrency } from '@/lib/format';
import type { EmployeeContractRow, ContractHistoryRow, ContractComponentRow, CreateComponentInput } from '@/server/salary-contracts';
import { createContractAction, deactivateContractAction, getContractHistoryAction } from './actions';
import { ask } from '@/components/ui/ask';

type ContractComponentRowVM = Omit<ContractComponentRow, 'oneTimePeriodStart'> & { oneTimePeriodStart: string | null };
interface EmployeeContractRowVM extends Omit<EmployeeContractRow, 'effectiveFrom' | 'components'> {
  effectiveFrom: string | null;
  components: ContractComponentRowVM[];
}

const REGIME_LABEL: Record<string, string> = { new: 'New regime', old: 'Old regime' };

const EMPLOYMENT_TYPES = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'intern', label: 'Intern' },
] as const;

const PERCENT_BASIS_LABEL: Record<string, string> = {
  percent_of_basic: "% of this employee's own basic pay",
  percent_of_gross: "% of this employee's own gross pay (every other component)",
  percent_of_sales: "% of this employee's own sales this period",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

/** A component's contribution to the estimate shown on the list/dialog - the cap (or 0 if uncapped) for anything variable, the real figure for `fixed`. The actual payslip figure for a variable component is only known once a run looks at real data. */
function estimatedComponentPaise(c: { calcType: string; monthlyPaise: number | null; capPaise: number | null }): number {
  if (c.calcType === 'fixed') return c.monthlyPaise ?? 0;
  return c.capPaise ?? 0;
}

export function ContractsClient({
  rows, presets, contractTypes, calcTypes, overtimeKinds, conditionFields, conditionOperators, canEdit,
}: {
  rows: EmployeeContractRowVM[];
  presets: readonly { code: string; label: string }[];
  contractTypes: readonly { value: string; label: string }[];
  calcTypes: readonly { value: string; label: string }[];
  overtimeKinds: readonly { value: string; label: string }[];
  conditionFields: readonly { value: string; label: string }[];
  conditionOperators: readonly { value: string; label: string }[];
  canEdit: boolean;
}) {
  // Kept in the address (F1b): survives refresh and Back.
  const [search, setSearch] = useUrlState('q');
  const [editing, setEditing] = useState<EmployeeContractRowVM | null>(null);
  const [viewingHistory, setViewingHistory] = useState<EmployeeContractRowVM | null>(null);

  const visible = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => r.fullName.toLowerCase().includes(q) || r.userCode.toLowerCase().includes(q));
  }, [rows, search]);

  const columns: Column<EmployeeContractRowVM>[] = [
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
    {
      key: 'type', header: 'Type',
      render: (r) => r.hasContract
        ? <Badge tone="neutral">{contractTypes.find((t) => t.value === r.contractType)?.label ?? r.contractType}</Badge>
        : <span className="text-xs text-muted-foreground">-</span>,
      optional: true,
    },
    {
      key: 'gross', header: 'Monthly Gross', align: 'end',
      render: (r) => r.hasContract ? (
        <span className="font-mono text-xs font-medium">
          {formatCurrency(r.estimatedGrossMonthlyPaise)}
          {r.hasVariableComponent && <Badge tone="info" className="ms-1.5 align-middle normal-case">est.</Badge>}
        </span>
      ) : <span className="text-xs text-muted-foreground">-</span>,
      sortValue: (r) => r.estimatedGrossMonthlyPaise,
    },
    {
      key: 'ctc', header: 'Annual CTC', align: 'end',
      render: (r) => <span className="font-mono text-xs">{r.hasContract ? formatCurrency(r.ctcAnnualPaise) : '-'}</span>,
      sortValue: (r) => r.ctcAnnualPaise, optional: true,
    },
    {
      key: 'flags', header: 'PF / ESIC / PT',
      render: (r) => r.hasContract ? (
        <div className="flex flex-wrap gap-1">
          <Badge tone={r.pfApplicable ? 'success' : 'neutral'}>PF {r.pfApplicable ? 'on' : 'off'}</Badge>
          <Badge tone={r.esicApplicable ? 'success' : 'neutral'}>ESIC {r.esicApplicable ? 'on' : 'off'}</Badge>
          <Badge tone={r.ptApplicable ? 'success' : 'neutral'}>PT {r.ptApplicable ? 'on' : 'off'}</Badge>
        </div>
      ) : <span className="text-xs text-muted-foreground">-</span>,
      optional: true,
    },
    {
      key: 'regime', header: 'Tax Regime',
      render: (r) => r.hasContract ? <Badge tone="info">{REGIME_LABEL[r.taxRegime] ?? r.taxRegime}</Badge> : <span className="text-xs text-muted-foreground">-</span>,
      optional: true,
    },
    {
      key: 'effective', header: 'Effective From',
      render: (r) => r.effectiveFrom ? <span className="text-xs text-muted-foreground">{fmtDate(r.effectiveFrom)}</span> : <Badge tone="warning">not set</Badge>,
      sortValue: (r) => r.effectiveFrom ?? '',
    },
  ];

  return (
    <div>
      <Link href="/hrm/payroll" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <Icon name="arrow-left" className="h-3.5 w-3.5" />
        Payroll Dashboard
      </Link>

      <PageHeader badge="₹" title="Contracts" subtitle={`${rows.length} employees`} />

      <Card className="mb-4 flex items-start gap-2.5 px-3 py-2.5">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          A new contract closes whoever&rsquo;s currently effective for that person and starts fresh
          from today - it never edits a past one. Payslips already generated keep the figures they
          were generated with, whatever changes here afterward.
        </p>
      </Card>

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Employee name or code…"
        count={`Total (${visible.length})`}
      />

      <DataGrid
        exportAs={{ title: 'Contracts' }}
        rows={visible}
        columns={columns}
        rowKey={(r) => r.userId}
        emptyIcon="file-text"
        emptyMessage="No employees found."
        pageSizes={[10, 25, 50, 100]}
        actions={canEdit ? [
          { label: 'New contract', icon: 'plus', onSelect: (r) => setEditing(r) },
          { label: 'View history', icon: 'clock', enabled: (r) => r.hasContract, onSelect: (r) => setViewingHistory(r) },
          {
            label: 'End contract', icon: 'x-circle', tone: 'danger', enabled: (r) => r.hasContract,
            onSelect: async (r) => {
              if (!r.contractId) return;
              if (!(await ask.confirm({
                tone: 'danger', icon: 'x-circle',
                title: `End ${r.fullName}'s contract?`,
                message: 'Payroll will have nothing to pay them against until a new contract is set. Their history stays.',
                confirmLabel: 'End contract', cancelLabel: 'Keep it',
              }))) return;
              void deactivateContractAction(r.contractId).then(() => window.location.reload());
            },
          },
        ] : [
          { label: 'View history', icon: 'clock', enabled: (r) => r.hasContract, onSelect: (r) => setViewingHistory(r) },
        ]}
      />

      {editing && (
        <ContractDialog
          row={editing}
          presets={presets}
          contractTypes={contractTypes}
          calcTypes={calcTypes}
          overtimeKinds={overtimeKinds}
          conditionFields={conditionFields}
          conditionOperators={conditionOperators}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); window.location.reload(); }}
        />
      )}

      {viewingHistory && (
        <HistoryDialog row={viewingHistory} onClose={() => setViewingHistory(null)} />
      )}
    </div>
  );
}

interface DraftCondition {
  key: string;
  field: string;
  operator: string;
  value: string;
}

interface DraftComponent {
  key: string;
  code: string;
  label: string;
  calcType: string;
  /** Rupees, as text - `fixed` only. */
  monthlyRupees: string;
  /** `percent_of_basic` | `percent_of_gross` | `percent_of_sales` only. */
  ratePct: string;
  /** Rupees, as text, blank = uncapped - any variable calcType. */
  capRupees: string;
  /** Rupees, as text - `per_attendance_day` (per day) / `per_overtime_hour` (per hour) only. */
  unitRateRupees: string;
  /** `per_overtime_hour` only. */
  overtimeKind: string;
  /** Optional, any calcType - blank means not tracked. */
  employerRatePct: string;
  /** Optional, any calcType - yyyy-mm-dd, blank means recurring. */
  oneTimeDate: string;
  /** Optional targeting rules. */
  conditions: DraftCondition[];
  showAdvanced: boolean;
}

function draftFromRow(c: ContractComponentRowVM, i: number): DraftComponent {
  return {
    key: `${i}`, code: c.code, label: c.label, calcType: c.calcType,
    monthlyRupees: c.monthlyPaise !== null ? String(c.monthlyPaise / 100) : '',
    ratePct: c.ratePct !== null ? String(c.ratePct) : '',
    capRupees: c.capPaise !== null ? String(c.capPaise / 100) : '',
    unitRateRupees: c.unitRatePaise !== null ? String(c.unitRatePaise / 100) : '',
    overtimeKind: c.overtimeKind ?? 'regular',
    employerRatePct: c.employerRatePct !== null ? String(c.employerRatePct) : '',
    oneTimeDate: c.oneTimePeriodStart ? c.oneTimePeriodStart.slice(0, 10) : '',
    conditions: c.conditions.map((cond, j) => ({ key: `${i}-${j}`, ...cond })),
    showAdvanced: false,
  };
}

function blankDraft(key: string): DraftComponent {
  return {
    key, code: '', label: '', calcType: 'fixed', monthlyRupees: '', ratePct: '', capRupees: '',
    unitRateRupees: '', overtimeKind: 'regular', employerRatePct: '', oneTimeDate: '', conditions: [], showAdvanced: false,
  };
}

/** What a component contributes to the estimate shown while editing - see `estimatedComponentPaise` for the same rule applied to a saved row. */
function estimatedDraftPaise(c: DraftComponent): number {
  if (c.calcType === 'fixed') return Math.round(Number(c.monthlyRupees) * 100) || 0;
  return c.capRupees.trim() ? Math.round(Number(c.capRupees) * 100) : 0;
}

function ContractDialog({
  row, presets, contractTypes, calcTypes, overtimeKinds, conditionFields, conditionOperators, onClose, onDone,
}: {
  row: EmployeeContractRowVM;
  presets: readonly { code: string; label: string }[];
  contractTypes: readonly { value: string; label: string }[];
  calcTypes: readonly { value: string; label: string }[];
  overtimeKinds: readonly { value: string; label: string }[];
  conditionFields: readonly { value: string; label: string }[];
  conditionOperators: readonly { value: string; label: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [contractType, setContractType] = useState(row.contractType ?? 'permanent');
  const [components, setComponents] = useState<DraftComponent[]>(
    row.components.length > 0
      ? row.components.map(draftFromRow)
      : [{ ...blankDraft('0'), code: 'BASIC', label: 'Basic' }],
  );
  const [ctcAnnual, setCtcAnnual] = useState(row.hasContract ? String(row.ctcAnnualPaise / 100) : '');
  const [ctcTouched, setCtcTouched] = useState(false);
  const [pfApplicable, setPfApplicable] = useState(row.pfApplicable);
  const [esicApplicable, setEsicApplicable] = useState(row.esicApplicable);
  const [ptApplicable, setPtApplicable] = useState(row.ptApplicable);
  const [taxRegime, setTaxRegime] = useState(row.taxRegime);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const estimatedGross = components.reduce((n, c) => n + estimatedDraftPaise(c), 0);
  const hasVariable = components.some((c) => c.calcType !== 'fixed');

  const suggestCtc = (next: DraftComponent[]) => {
    if (ctcTouched) return;
    const newGross = next.reduce((n, c) => n + estimatedDraftPaise(c), 0);
    setCtcAnnual(String((newGross / 100) * 12));
  };

  const updateComponent = (key: string, patch: Partial<DraftComponent>) => {
    setComponents((prev) => {
      const next = prev.map((c) => (c.key === key ? { ...c, ...patch } : c));
      suggestCtc(next);
      return next;
    });
  };

  const addComponent = () => {
    setComponents((prev) => [...prev, blankDraft(`${Date.now()}`)]);
  };

  const removeComponent = (key: string) => {
    setComponents((prev) => {
      const next = prev.filter((c) => c.key !== key);
      suggestCtc(next);
      return next;
    });
  };

  const addCondition = (componentKey: string) => {
    setComponents((prev) => prev.map((c) => (
      c.key === componentKey
        ? { ...c, conditions: [...c.conditions, { key: `${Date.now()}`, field: conditionFields[0].value, operator: 'equal', value: '' }] }
        : c
    )));
  };
  const updateCondition = (componentKey: string, condKey: string, patch: Partial<DraftCondition>) => {
    setComponents((prev) => prev.map((c) => (
      c.key === componentKey
        ? { ...c, conditions: c.conditions.map((cond) => (cond.key === condKey ? { ...cond, ...patch } : cond)) }
        : c
    )));
  };
  const removeCondition = (componentKey: string, condKey: string) => {
    setComponents((prev) => prev.map((c) => (
      c.key === componentKey ? { ...c, conditions: c.conditions.filter((cond) => cond.key !== condKey) } : c
    )));
  };

  const hasBasic = components.some((c) => c.code === 'BASIC' && c.calcType === 'fixed' && Number(c.monthlyRupees) > 0);
  const componentsValid = components.every((c) => {
    if (!c.code.trim() || !c.label.trim()) return false;
    if (c.calcType === 'fixed') return Number(c.monthlyRupees) > 0;
    if (c.calcType.startsWith('percent_of_')) return c.ratePct.trim() !== '' && Number(c.ratePct) > 0;
    if (c.calcType === 'per_attendance_day') return c.unitRateRupees.trim() !== '' && Number(c.unitRateRupees) > 0;
    if (c.calcType === 'per_overtime_hour') return c.unitRateRupees.trim() !== '' && Number(c.unitRateRupees) > 0 && !!c.overtimeKind;
    return false;
  });
  const ready = hasBasic && Number(ctcAnnual) > 0 && componentsValid;

  const save = () => {
    setError(null);
    startTransition(async () => {
      const componentInputs: CreateComponentInput[] = components.map((c) => ({
        code: c.code.trim(),
        label: c.label.trim(),
        calcType: c.calcType,
        monthlyPaise: c.calcType === 'fixed' ? Math.round(Number(c.monthlyRupees) * 100) : 0,
        ratePct: c.calcType.startsWith('percent_of_') ? Number(c.ratePct) : null,
        capPaise: c.calcType !== 'fixed' && c.capRupees.trim() ? Math.round(Number(c.capRupees) * 100) : null,
        unitRatePaise: (c.calcType === 'per_attendance_day' || c.calcType === 'per_overtime_hour') && c.unitRateRupees.trim()
          ? Math.round(Number(c.unitRateRupees) * 100) : null,
        overtimeKind: c.calcType === 'per_overtime_hour' ? c.overtimeKind : null,
        employerRatePct: c.employerRatePct.trim() ? Number(c.employerRatePct) : null,
        oneTimePeriodStart: c.oneTimeDate.trim() ? new Date(c.oneTimeDate) : null,
        conditions: c.conditions.filter((cond) => cond.value.trim()).map((cond) => ({
          field: cond.field, operator: cond.operator, value: cond.value.trim(),
        })),
      }));
      const res = await createContractAction({
        userId: row.userId,
        contractType,
        ctcAnnualPaise: Math.round(Number(ctcAnnual) * 100),
        pfApplicable, esicApplicable, ptApplicable,
        taxRegime,
        components: componentInputs,
      });
      if (res.error) { setError(res.error); return; }
      onDone();
    });
  };

  return (
    <Modal
      open
      title={row.fullName}
      subtitle={row.hasContract ? 'New contract - replaces the current one' : 'First contract'}
      icon="file-text"
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {hasVariable ? 'Estimated monthly gross' : 'Monthly gross'}:{' '}
            <strong className="text-foreground">{formatCurrency(estimatedGross)}</strong>
          </span>
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon="check" disabled={!ready || pending} loading={pending} onClick={save}>
              Save
            </Button>
          </div>
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
          Contract type
          <select value={contractType} onChange={(e) => setContractType(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
            {contractTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Earnings breakup</p>
          <div className="grid gap-2">
            {components.map((c) => {
              const isPreset = presets.some((p) => p.code === c.code);
              return (
                <div key={c.key} className="rounded-lg border border-border p-2.5">
                  <div className="flex items-center gap-2">
                    <select
                      value={isPreset ? c.code : 'CUSTOM'}
                      onChange={(e) => {
                        const preset = presets.find((p) => p.code === e.target.value);
                        const forceFixed = preset?.code === 'BASIC' ? { calcType: 'fixed' } : {};
                        updateComponent(c.key, preset ? { code: preset.code, label: preset.label, ...forceFixed } : { code: '', label: '' });
                      }}
                      className="w-36 shrink-0 rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground"
                    >
                      {presets.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
                      <option value="CUSTOM">Custom…</option>
                    </select>
                    {!isPreset && (
                      <input
                        type="text" placeholder="Label" value={c.label}
                        onChange={(e) => updateComponent(c.key, { label: e.target.value, code: e.target.value })}
                        className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground"
                      />
                    )}
                    <select
                      value={c.calcType}
                      disabled={c.code === 'BASIC'}
                      onChange={(e) => updateComponent(c.key, { calcType: e.target.value })}
                      className={`shrink-0 rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground disabled:opacity-50 ${isPreset ? '' : 'w-40'}`}
                    >
                      {calcTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <button
                      type="button" aria-label="Remove this pay component" onClick={() => removeComponent(c.key)}
                      disabled={components.length === 1}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {c.calcType === 'fixed' && (
                    <div className="mt-2">
                      <input
                        type="number" min={0} placeholder="₹ per month"
                        value={c.monthlyRupees}
                        onChange={(e) => updateComponent(c.key, { monthlyRupees: e.target.value })}
                        className="w-full rounded-lg border border-border bg-background px-2 py-2 text-end text-xs text-foreground"
                      />
                    </div>
                  )}

                  {c.calcType.startsWith('percent_of_') && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="number" min={0} max={100} placeholder="%"
                        value={c.ratePct}
                        onChange={(e) => updateComponent(c.key, { ratePct: e.target.value })}
                        className="w-20 rounded-lg border border-border bg-background px-2 py-2 text-end text-xs text-foreground"
                      />
                      <span className="text-xs text-muted-foreground">{PERCENT_BASIS_LABEL[c.calcType]}, capped at</span>
                      <input
                        type="number" min={0} placeholder="no cap"
                        value={c.capRupees}
                        onChange={(e) => updateComponent(c.key, { capRupees: e.target.value })}
                        className="w-28 rounded-lg border border-border bg-background px-2 py-2 text-end text-xs text-foreground"
                      />
                      <span className="text-xs text-muted-foreground">₹/month - blank means uncapped</span>
                    </div>
                  )}

                  {(c.calcType === 'per_attendance_day' || c.calcType === 'per_overtime_hour') && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        type="number" min={0} placeholder="₹"
                        value={c.unitRateRupees}
                        onChange={(e) => updateComponent(c.key, { unitRateRupees: e.target.value })}
                        className="w-24 rounded-lg border border-border bg-background px-2 py-2 text-end text-xs text-foreground"
                      />
                      {c.calcType === 'per_attendance_day' ? (
                        <span className="text-xs text-muted-foreground">per day attended, capped at</span>
                      ) : (
                        <>
                          <span className="text-xs text-muted-foreground">per hour of</span>
                          <select
                            value={c.overtimeKind}
                            onChange={(e) => updateComponent(c.key, { overtimeKind: e.target.value })}
                            className="rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground"
                          >
                            {overtimeKinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                          </select>
                          <span className="text-xs text-muted-foreground">capped at</span>
                        </>
                      )}
                      <input
                        type="number" min={0} placeholder="no cap"
                        value={c.capRupees}
                        onChange={(e) => updateComponent(c.key, { capRupees: e.target.value })}
                        className="w-28 rounded-lg border border-border bg-background px-2 py-2 text-end text-xs text-foreground"
                      />
                      <span className="text-xs text-muted-foreground">₹/month - blank means uncapped</span>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => updateComponent(c.key, { showAdvanced: !c.showAdvanced })}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    <Icon name={c.showAdvanced ? 'chevron-up' : 'chevron-down'} className="h-3 w-3" />
                    Advanced - employer contribution, one-off, who this applies to
                  </button>

                  {c.showAdvanced && (
                    <div className="mt-2 grid gap-2 rounded-lg bg-muted/30 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">Employer also contributes</span>
                        <input
                          type="number" min={0} max={100} placeholder="%"
                          value={c.employerRatePct}
                          onChange={(e) => updateComponent(c.key, { employerRatePct: e.target.value })}
                          className="w-20 rounded-lg border border-border bg-background px-2 py-2 text-end text-xs text-foreground"
                        />
                        <span className="text-xs text-muted-foreground">% (shown on the payslip, never deducted from pay) - blank if not tracked</span>
                      </div>
                      {c.code !== 'BASIC' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">One-off - pays out only in the run covering</span>
                        <input
                          type="date"
                          value={c.oneTimeDate}
                          onChange={(e) => updateComponent(c.key, { oneTimeDate: e.target.value })}
                          className="rounded-lg border border-border bg-background px-2 py-2 text-xs text-foreground"
                        />
                        <span className="text-xs text-muted-foreground">blank means every run (recurring)</span>
                      </div>
                      )}
                      {c.code === 'BASIC' && (
                        <p className="text-xs text-muted-foreground">Basic always recurs and applies to every run - it can&rsquo;t be conditional or one-off.</p>
                      )}
                      {c.code !== 'BASIC' && (
                      <div>
                        <p className="mb-1 text-xs text-muted-foreground">Only applies when...</p>
                        {c.conditions.length === 0 && (
                          <p className="text-xs text-muted-foreground">Nothing set - applies to everyone this contract is for.</p>
                        )}
                        {c.conditions.map((cond) => (
                          <div key={cond.key} className="mb-1 flex flex-wrap items-center gap-1.5">
                            <select
                              value={cond.field}
                              onChange={(e) => updateCondition(c.key, cond.key, { field: e.target.value, value: '' })}
                              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                            >
                              {conditionFields.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                            </select>
                            <select
                              value={cond.operator}
                              onChange={(e) => updateCondition(c.key, cond.key, { operator: e.target.value })}
                              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                            >
                              {conditionOperators.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            {cond.field === 'contractType' ? (
                              <select
                                value={cond.value}
                                onChange={(e) => updateCondition(c.key, cond.key, { value: e.target.value })}
                                className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                              >
                                <option value="">Choose…</option>
                                {contractTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                              </select>
                            ) : (
                              <select
                                value={cond.value}
                                onChange={(e) => updateCondition(c.key, cond.key, { value: e.target.value })}
                                className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                              >
                                <option value="">Choose…</option>
                                {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                              </select>
                            )}
                            <button type="button" aria-label="Remove this condition" onClick={() => removeCondition(c.key, cond.key)} className="text-muted-foreground hover:text-danger">
                              <Icon name="trash" className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button" onClick={() => addCondition(c.key)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                        >
                          <Icon name="plus" className="h-3 w-3" />
                          Add condition
                        </button>
                      </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button" onClick={addComponent}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add component
          </button>
          {!hasBasic && (
            <p className="mt-1.5 text-xs text-warning">A fixed Basic component is required - PF and HRA exemption are computed from it, and it can&rsquo;t be a formula.</p>
          )}
        </div>

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Annual CTC (₹)
          <input
            type="number" min={0} value={ctcAnnual}
            onChange={(e) => { setCtcAnnual(e.target.value); setCtcTouched(true); }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <span className="font-normal normal-case tracking-normal text-muted-foreground">
            Suggested from the breakup above ({formatCurrency(estimatedGross * 12)}
            {hasVariable ? ', using each variable component’s cap' : ''}) - edit if the real CTC includes
            anything not paid monthly.
          </span>
        </label>

        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Tax regime
          <select value={taxRegime} onChange={(e) => setTaxRegime(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
            <option value="new">New regime</option>
            <option value="old">Old regime</option>
          </select>
        </label>

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={pfApplicable} onChange={(e) => setPfApplicable(e.target.checked)} />
            PF applicable
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={esicApplicable} onChange={(e) => setEsicApplicable(e.target.checked)} />
            ESIC applicable
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={ptApplicable} onChange={(e) => setPtApplicable(e.target.checked)} />
            PT applicable
          </label>
        </div>
      </div>
    </Modal>
  );
}

function HistoryDialog({ row, onClose }: { row: EmployeeContractRowVM; onClose: () => void }) {
  const [rows, setRows] = useState<ContractHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getContractHistoryAction(row.userId).then((res) => {
      if (res.error) setError(res.error);
      else setRows(res.rows ?? []);
    });
  }, [row.userId]);

  return (
    <Modal open title={row.fullName} subtitle="Contract history" icon="clock" size="md" onClose={onClose}>
      {error && <p className="text-sm text-danger">{error}</p>}
      {!error && rows === null && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows?.length === 0 && <EmptyState icon="clock" title="No contracts yet" />}
      {rows && rows.length > 0 && (
        <div className="grid gap-3">
          {rows.map((c) => (
            <Card key={c.id} className={`p-3 ${c.effectiveTo === null ? 'border-brand/40' : ''}`}>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">
                  {fmtDate(c.effectiveFrom.toString())} - {c.effectiveTo ? fmtDate(c.effectiveTo.toString()) : 'current'}
                </span>
                {c.effectiveTo === null && <Badge tone="success">Current</Badge>}
              </div>
              <SummaryRow label="Type" value={c.contractType} />
              <SummaryRow label="Annual CTC" value={formatCurrency(c.ctcAnnualPaise)} />
              <SummaryRow
                label={c.components.some((x) => x.calcType !== 'fixed') ? 'Est. monthly gross' : 'Monthly gross'}
                value={formatCurrency(c.components.reduce((n, x) => n + estimatedComponentPaise(x), 0))}
              />
              {c.components.filter((x) => x.calcType !== 'fixed').map((x) => (
                <SummaryRow
                  key={x.code}
                  label={x.label}
                  value={
                    x.calcType.startsWith('percent_of_')
                      ? `${x.ratePct}% ${x.calcType === 'percent_of_sales' ? 'of sales' : x.calcType === 'percent_of_basic' ? 'of basic' : 'of gross'}${x.capPaise !== null ? `, capped at ${formatCurrency(x.capPaise)}` : ' (uncapped)'}`
                      : `${formatCurrency(x.unitRatePaise ?? 0)} ${x.calcType === 'per_attendance_day' ? 'per day' : `per ${x.overtimeKind?.replace('_', ' ')} overtime hour`}${x.capPaise !== null ? `, capped at ${formatCurrency(x.capPaise)}` : ' (uncapped)'}`
                  }
                />
              ))}
            </Card>
          ))}
        </div>
      )}
    </Modal>
  );
}
