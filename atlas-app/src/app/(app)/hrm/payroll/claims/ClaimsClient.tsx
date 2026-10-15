'use client';
import { EmployeeLink } from '@/components/document/EmployeeLink';
import { ListFilter } from '@/components/ui/ListFilter';

import { useState, useTransition } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge, Field, PageHeader, SectionCard, EmptyState, type BadgeTone } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, toPaise } from '@/lib/format';
import { newestFirst, oldestFirst, type CardListPage } from '@/lib/card-list';
import {
  requestEncashmentAction, requestReimbursementAction,
  decideEncashmentAction, payEncashmentAction,
  decideReimbursementAction, payReimbursementAction,
} from './actions';

interface EncashmentRowVM {
  id: string; userId: string; userName: string; leaveTypeId: string; leaveTypeName: string;
  days: number; ratePaise: number; amountPaise: number; status: string;
  decidedAt: string | null; decisionNote: string | null; createdAt: string;
}

interface ReimbursementRowVM {
  id: string; userId: string; userName: string; category: string; amountPaise: number;
  expenseDate: string; description: string | null; status: string;
  decidedAt: string | null; decisionNote: string | null; createdAt: string;
}

interface Props {
  /** One server-side page of each list (F1b). */
  encPage: CardListPage;
  reimPage: CardListPage;
  encashments: EncashmentRowVM[];
  reimbursements: ReimbursementRowVM[];
  leaveTypes: { id: string; name: string }[];
  canManage: boolean;
}

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

const STATUS_TONE: Record<string, BadgeTone> = { pending: 'warning', approved: 'info', rejected: 'danger', paid: 'success' };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

const CATEGORIES = ['travel', 'medical', 'food', 'other'];

export function ClaimsClient({ encashments, reimbursements, leaveTypes, canManage, encPage, reimPage }: Props) {
  const [tab, setTab] = useState<'encashments' | 'reimbursements'>('encashments');
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const report = (res: { error?: string }, okMessage: string) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : okMessage);
  };

  const decideEnc = (id: string, decision: 'approved' | 'rejected') => {
    setBusyId(id);
    startTransition(async () => {
      const res = await decideEncashmentAction(id, decision);
      report(res, `Encashment ${decision}.`);
      setBusyId(null);
    });
  };
  const payEnc = (id: string) => {
    setBusyId(id);
    startTransition(async () => {
      const res = await payEncashmentAction(id, 'bank');
      report(res, 'Encashment paid.');
      setBusyId(null);
    });
  };
  const decideReimb = (id: string, decision: 'approved' | 'rejected') => {
    setBusyId(id);
    startTransition(async () => {
      const res = await decideReimbursementAction(id, decision);
      report(res, `Claim ${decision}.`);
      setBusyId(null);
    });
  };
  const payReimb = (id: string) => {
    setBusyId(id);
    startTransition(async () => {
      const res = await payReimbursementAction(id, 'bank');
      report(res, 'Claim paid.');
      setBusyId(null);
    });
  };

  return (
    <div>
      <PageHeader
        badge="EC"
        title="Encashments & Reimbursements"
        subtitle="Leave encashment and expense claims"
        actions={<Button size="sm" variant="primary" icon="plus" onClick={() => setRequesting(true)}>New request</Button>}
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

      <div className="mb-4 inline-flex rounded-lg border border-border bg-card p-1">
        {(['encashments', 'reimbursements'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`h-8 rounded-md px-3.5 text-sm font-medium transition ${
              tab === t ? 'bg-brand text-brand-fg' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {t === 'encashments' ? 'Encashments' : 'Reimbursements'}
          </button>
        ))}
      </div>

      {tab === 'encashments' ? (
        <SectionCard title={`${encPage.total} request${encPage.total === 1 ? '' : 's'}`} icon="receipt" bodyClassName="p-0">
          {encPage.total === 0 ? (
            <EmptyState icon="receipt" title="No encashment requests" hint="Nothing has been raised for this branch." />
          ) : (
            <ListFilter
              server={encPage.server}
              exportScreen="encashments"
              rows={encashments}
              // Date filter and sort (9 Oct 2026) - same keys as server/card-lists.
              dates={[{ key: 'asked', label: 'Asked on', of: (r) => r.createdAt }]}
              sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.createdAt) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.createdAt) }]}
              noun="requests"
              paramKey="enc"
              placeholder="Employee, leave type, status…"
              searchOn={(e) => [e.userName, e.leaveTypeName, e.status]}
              chipOf={(e) => e.status}
              chipLabel="Status"
              chips={Object.keys(encPage.chipCounts).sort().map((s) => ({
                value: s, label: s, count: encPage.chipCounts[s] ?? 0,
              }))}
            >
              {(shownE) => (shownE.length === 0 ? (
                <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every request." />
              ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-4 py-2 font-medium">Leave Type</th>
                  <th className="px-4 py-2 font-medium">Days</th>
                  <th className="px-4 py-2 font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shownE.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2.5 font-medium"><EmployeeLink id={e.userId}>{e.userName}</EmployeeLink></td>
                    <td className="px-4 py-2.5">{e.leaveTypeName}</td>
                    <td className="px-4 py-2.5">{e.days}</td>
                    <td className="px-4 py-2.5">{formatCurrency(e.amountPaise)}</td>
                    <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[e.status] ?? 'neutral'}>{e.status}</Badge></td>
                    <td className="px-4 py-2.5 text-end">
                      {canManage && (
                        <div className="flex justify-end gap-2">
                          {e.status === 'pending' && (
                            <>
                              <button type="button" disabled={pending && busyId === e.id} onClick={() => decideEnc(e.id, 'rejected')} className="text-xs font-medium text-danger hover:underline">Reject</button>
                              <button type="button" disabled={pending && busyId === e.id} onClick={() => decideEnc(e.id, 'approved')} className="text-xs font-medium text-brand hover:underline">Approve</button>
                            </>
                          )}
                          {e.status === 'approved' && (
                            <button type="button" disabled={pending && busyId === e.id} onClick={() => payEnc(e.id)} className="text-xs font-medium text-brand hover:underline">Pay</button>
                          )}
                        </div>
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
      ) : (
        <SectionCard title={`${reimPage.total} claim${reimPage.total === 1 ? '' : 's'}`} icon="receipt" bodyClassName="p-0">
          {reimPage.total === 0 ? (
            <EmptyState icon="receipt" title="No reimbursement claims" hint="Nothing has been raised for this branch." />
          ) : (
            <ListFilter
              server={reimPage.server}
              exportScreen="reimbursements"
              rows={reimbursements}
              // Date filter and sort (9 Oct 2026) - same keys as server/card-lists.
              dates={[{ key: 'spent', label: 'Expense date', of: (r) => r.expenseDate }, { key: 'asked', label: 'Asked on', of: (r) => r.createdAt }]}
              sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.expenseDate) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.expenseDate) }]}
              noun="claims"
              paramKey="reim"
              placeholder="Employee, category, status…"
              searchOn={(r) => [r.userName, r.category, r.status]}
              chipOf={(r) => r.status}
              chipLabel="Status"
              chips={Object.keys(reimPage.chipCounts).sort().map((s) => ({
                value: s, label: s, count: reimPage.chipCounts[s] ?? 0,
              }))}
            >
              {(shownR) => (shownR.length === 0 ? (
                <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every claim." />
              ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Expense date</th>
                  <th className="px-4 py-2 font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shownR.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 font-medium"><EmployeeLink id={r.userId}>{r.userName}</EmployeeLink></td>
                    <td className="px-4 py-2.5 capitalize">{r.category}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(r.expenseDate)}</td>
                    <td className="px-4 py-2.5">{formatCurrency(r.amountPaise)}</td>
                    <td className="px-4 py-2.5"><Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge></td>
                    <td className="px-4 py-2.5 text-end">
                      {canManage && (
                        <div className="flex justify-end gap-2">
                          {r.status === 'pending' && (
                            <>
                              <button type="button" disabled={pending && busyId === r.id} onClick={() => decideReimb(r.id, 'rejected')} className="text-xs font-medium text-danger hover:underline">Reject</button>
                              <button type="button" disabled={pending && busyId === r.id} onClick={() => decideReimb(r.id, 'approved')} className="text-xs font-medium text-brand hover:underline">Approve</button>
                            </>
                          )}
                          {r.status === 'approved' && (
                            <button type="button" disabled={pending && busyId === r.id} onClick={() => payReimb(r.id)} className="text-xs font-medium text-brand hover:underline">Pay</button>
                          )}
                        </div>
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

      {requesting && (
        <RequestModal
          tab={tab}
          leaveTypes={leaveTypes}
          onClose={() => setRequesting(false)}
          onSaved={(res) => { report(res, 'Request submitted.'); if (!res.error) setRequesting(false); }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------------

function RequestModal({
  tab, leaveTypes, onClose, onSaved,
}: {
  tab: 'encashments' | 'reimbursements';
  leaveTypes: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (res: { error?: string }) => void;
}) {
  const [leaveTypeId, setLeaveTypeId] = useState(leaveTypes[0]?.id ?? '');
  const [days, setDays] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    if (tab === 'encashments') {
      const d = Number(days);
      if (!leaveTypeId || !d || d <= 0) { setError('Choose a leave type and a number of days.'); return; }
      setError(null);
      startTransition(async () => {
        const res = await requestEncashmentAction({ leaveTypeId, days: d });
        if (res.error) setError(res.error);
        else onSaved(res);
      });
    } else {
      const amountPaise = toPaise(Number(amount));
      if (!amountPaise || amountPaise <= 0) { setError('Enter an amount greater than zero.'); return; }
      setError(null);
      startTransition(async () => {
        const res = await requestReimbursementAction({
          category, amountPaise, expenseDate, description: description.trim() || null,
        });
        if (res.error) setError(res.error);
        else onSaved(res);
      });
    }
  };

  return (
    <Modal
      title={tab === 'encashments' ? 'Request leave encashment' : 'Claim a reimbursement'}
      icon="receipt"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={save}>Submit</Button>
        </div>
      }
    >
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      {tab === 'encashments' ? (
        <div className="grid gap-3">
          <Field label="Leave type" htmlFor="ec-type">
            <select id="ec-type" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} className={input}>
              {leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Days" htmlFor="ec-days" hint="The rate is snapshot from your current salary contract.">
            <input id="ec-days" type="number" min={0.5} step={0.5} value={days} onChange={(e) => setDays(e.target.value)} className={input} />
          </Field>
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" htmlFor="rc-cat">
              <select id="rc-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
                {CATEGORIES.map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
              </select>
            </Field>
            <Field label="Amount (₹)" htmlFor="rc-amount">
              <input id="rc-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className={input} />
            </Field>
          </div>
          <Field label="Expense date" htmlFor="rc-date">
            <input id="rc-date" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className={input} />
          </Field>
          <Field label="Description" htmlFor="rc-desc" hint="Optional.">
            <textarea id="rc-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`${input} h-auto py-2`} />
          </Field>
        </div>
      )}
    </Modal>
  );
}
