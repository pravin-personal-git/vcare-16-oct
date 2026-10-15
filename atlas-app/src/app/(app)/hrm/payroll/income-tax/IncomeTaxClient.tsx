'use client';
import { EmployeeLink } from '@/components/document/EmployeeLink';
import { ListFilter } from '@/components/ui/ListFilter';

import { useState, useTransition } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge, Field, PageHeader, SectionCard, EmptyState, type BadgeTone } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { formatCurrency, toRupees } from '@/lib/format';
import { formatFinancialYear } from '@/lib/financial-year';
import { DECLARATION_CATEGORIES } from '@/lib/income-tax-categories';
import { saveMyDeclarationAction, setDeclarationProofStatusAction } from './actions';

interface DeclarationRowVM {
  id: string; userId: string; userName: string; financialYear: number; regime: string;
  declarations: Record<string, number>; proofStatus: string; totalDeclaredPaise: number; updatedAt: string;
}

interface Props {
  financialYear: number;
  mine: DeclarationRowVM | null;
  all: DeclarationRowVM[];
  canManage: boolean;
}

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

const PROOF_TONE: Record<string, BadgeTone> = { pending: 'neutral', submitted: 'warning', verified: 'success' };

export function IncomeTaxClient({ financialYear, mine, all, canManage }: Props) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const [regime, setRegime] = useState(mine?.regime ?? 'new');
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of DECLARATION_CATEGORIES) {
      const paise = mine?.declarations[c.code];
      init[c.code] = paise ? String(toRupees(paise)) : '';
    }
    return init;
  });

  const save = () => {
    setError(null);
    const declarations: Record<string, number> = {};
    for (const c of DECLARATION_CATEGORIES) {
      const v = Number(amounts[c.code] || 0);
      if (v > 0) declarations[c.code] = v;
    }
    startTransition(async () => {
      const res = await saveMyDeclarationAction({ financialYear, regime, declarations });
      setError(res.error ?? null);
      setNotice(res.error ? null : 'Declaration saved.');
    });
  };

  const setProof = (id: string, status: 'pending' | 'submitted' | 'verified') => {
    setBusyId(id);
    startTransition(async () => {
      const res = await setDeclarationProofStatusAction(id, status);
      setError(res.error ?? null);
      setNotice(res.error ? null : `Marked ${status}.`);
      setBusyId(null);
    });
  };

  const totalRupees = Object.values(amounts).reduce((sum, v) => sum + (Number(v) || 0), 0);

  return (
    <div>
      <PageHeader
        badge="IT"
        title="Income Tax Declarations"
        subtitle={`${formatFinancialYear(financialYear)} - old-regime deductions, verified before payroll uses them`}
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

      <SectionCard
        title="My declaration"
        icon="file-text"
        action={mine && <Badge tone={PROOF_TONE[mine.proofStatus] ?? 'neutral'}>{mine.proofStatus}</Badge>}
        className="mb-4"
      >
        <div className="grid gap-3">
          <Field label="Tax regime" htmlFor="it-regime" hint="Only the old regime uses these declarations for TDS.">
            <select id="it-regime" value={regime} onChange={(e) => setRegime(e.target.value)} className={input}>
              <option value="new">New regime</option>
              <option value="old">Old regime</option>
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {DECLARATION_CATEGORIES.map((c) => (
              <Field key={c.code} label={c.label} htmlFor={`it-${c.code}`}>
                <input
                  id={`it-${c.code}`} type="number" min={0} value={amounts[c.code]}
                  onChange={(e) => setAmounts((a) => ({ ...a, [c.code]: e.target.value }))}
                  className={input} placeholder="₹"
                />
              </Field>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <p className="text-sm text-muted-foreground">Total declared: <span className="font-semibold text-foreground">{formatCurrency(totalRupees * 100)}</span></p>
            <Button variant="primary" loading={pending} onClick={save}>Save declaration</Button>
          </div>
        </div>
      </SectionCard>

      {canManage && (
        <SectionCard title={`${all.length} declaration${all.length === 1 ? '' : 's'} this year`} icon="users" bodyClassName="p-0">
          {all.length === 0 ? (
            <EmptyState icon="file-text" title="Nobody has declared yet" hint="Declarations appear here once employees submit them." />
          ) : (
            /* F1b / D17. Proof verification is done in a sitting, against a
               pile of documents - so "who is still pending" is the filter that
               matters, and it carries its own count. */
            <ListFilter
              rows={all}
              noun="declarations"
              placeholder="Employee, regime…"
              searchOn={(d) => [d.userName, d.regime, d.proofStatus]}
              chipOf={(d) => d.proofStatus}
              chipLabel="Proof"
              chips={[...new Set(all.map((d) => d.proofStatus))].sort().map((s) => ({
                value: s, label: s, count: all.filter((d) => d.proofStatus === s).length,
              }))}
            >
              {(shown) => (shown.length === 0 ? (
                <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every declaration." />
              ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-4 py-2 font-medium">Regime</th>
                  <th className="px-4 py-2 font-medium">Declared</th>
                  <th className="px-4 py-2 font-medium">Proof</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2.5 font-medium"><EmployeeLink id={d.userId}>{d.userName}</EmployeeLink></td>
                    <td className="px-4 py-2.5 capitalize text-muted-foreground">{d.regime}</td>
                    <td className="px-4 py-2.5">{formatCurrency(d.totalDeclaredPaise)}</td>
                    <td className="px-4 py-2.5"><Badge tone={PROOF_TONE[d.proofStatus] ?? 'neutral'}>{d.proofStatus}</Badge></td>
                    <td className="px-4 py-2.5 text-end">
                      {d.proofStatus !== 'verified' ? (
                        <button type="button" disabled={pending && busyId === d.id} onClick={() => setProof(d.id, 'verified')} className="text-xs font-medium text-brand hover:underline">
                          Verify
                        </button>
                      ) : (
                        <button type="button" disabled={pending && busyId === d.id} onClick={() => setProof(d.id, 'pending')} className="text-xs font-medium text-muted-foreground hover:underline">
                          Revert
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
              ))}
            </ListFilter>
          )}
        </SectionCard>
      )}
    </div>
  );
}
