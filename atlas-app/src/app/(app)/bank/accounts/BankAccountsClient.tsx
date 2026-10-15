'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import { ListFilter } from '@/components/ui/ListFilter';
import {
  saveBankAccount, makeDefaultBankAccount, toggleBankAccountActive, removeBankAccount,
} from './actions';

interface Account {
  id: string;
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  branch: string | null;
  isDefault: boolean;
  showOnDocuments: boolean;
  isActive: boolean;
}

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function BankAccountsClient({
  accounts, canEdit, isSingleStore,
}: { accounts: Account[]; canEdit: boolean; isSingleStore: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<{ error?: string; ok?: boolean }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    if (res.error) setError(res.error);
    setBusy(false);
    router.refresh();
    return !res.error;
  }

  return (
    <div>
      <PageHeader
        badge="BA"
        title="Bank Accounts"
        subtitle="Printed on quotations and invoices so a customer knows where to pay"
        actions={canEdit && isSingleStore ? (
          <Button variant="primary" iconEnd="user-plus" onClick={() => setEditing('new')}>
            Add Account
          </Button>
        ) : undefined}
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}
      {!isSingleStore && (
        <Card className="mb-3 border-warning/40 bg-warning/10 p-3">
          <p className="text-sm"><strong>All Company</strong> is read-only. Select a single store to add or change an account.</p>
        </Card>
      )}

      <SectionCard title={`${accounts.length} account${accounts.length === 1 ? '' : 's'}`} icon="credit-card" bodyClassName="p-0">
        {accounts.length === 0 ? (
          <EmptyState icon="credit-card" title="No bank account yet" hint="Add one so it can print on your documents." />
        ) : (
          /* Tier C (F1-SPEC §3.1): search, not a grid. A business with a dozen
             accounts across branches still needs to find one by IFSC or by the
             last digits somebody read out over the phone. */
          <ListFilter
            rows={accounts}
            noun="accounts"
            placeholder="Bank, account holder, account number, IFSC, branch…"
            searchOn={(a) => [a.bankName, a.accountHolderName, a.accountNumber, a.ifsc, a.branch]}
            chipOf={(a) => (a.isActive ? 'active' : 'inactive')}
            chipLabel="Status"
            chips={[
              { value: 'active', label: 'Active', count: accounts.filter((a) => a.isActive).length },
              { value: 'inactive', label: 'Inactive', count: accounts.filter((a) => !a.isActive).length },
            ]}
          >
            {(shown) => (shown.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every account." />
            ) : (
          <div className="divide-y divide-border">
            {shown.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{a.bankName}</p>
                    {a.isDefault && <Badge tone="brand">Default</Badge>}
                    {!a.isActive && <Badge tone="neutral">Inactive</Badge>}
                    {!a.showOnDocuments && <Badge tone="neutral" icon="eye-off">Hidden on documents</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {a.accountHolderName} · A/C {a.accountNumber} · {a.ifsc}{a.branch ? ` · ${a.branch}` : ''}
                  </p>
                </div>
                {canEdit && isSingleStore && (
                  <div className="flex flex-wrap gap-2">
                    {!a.isDefault && a.isActive && (
                      <Button size="sm" variant="outline" loading={busy} onClick={() => act(() => makeDefaultBankAccount(a.id))}>
                        Set default
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setEditing(a)}>Edit</Button>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busy}
                      onClick={() => act(() => toggleBankAccountActive(a.id, !a.isActive))}
                    >
                      {a.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                    {!a.isDefault && (
                      <Button size="sm" variant="outline" onClick={() => setDeleting(a)}>Delete</Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
            ))}
          </ListFilter>
        )}
      </SectionCard>

      {editing && (
        <AccountForm
          account={editing === 'new' ? null : editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const ok = await act(() => saveBankAccount(editing === 'new' ? null : editing.id, input));
            if (ok) setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete bank account?"
          message={`"${deleting.bankName}" will be removed. This cannot be undone.`}
          confirmLabel="Delete"
          tone="danger"
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            const ok = await act(() => removeBankAccount(deleting.id));
            if (ok) setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function AccountForm({
  account, busy, onClose, onSave,
}: {
  account: Account | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: {
    accountHolderName: string; bankName: string; accountNumber: string;
    ifsc: string; branch: string | null; showOnDocuments: boolean;
  }) => void;
}) {
  const [accountHolderName, setAccountHolderName] = useState(account?.accountHolderName ?? '');
  const [bankName, setBankName] = useState(account?.bankName ?? '');
  const [accountNumber, setAccountNumber] = useState(account?.accountNumber ?? '');
  const [ifsc, setIfsc] = useState(account?.ifsc ?? '');
  const [branch, setBranch] = useState(account?.branch ?? '');
  const [showOnDocuments, setShowOnDocuments] = useState(account?.showOnDocuments ?? true);

  const valid = accountHolderName.trim() && bankName.trim() && accountNumber.trim() && ifsc.trim();

  return (
    <Modal
      title={account ? 'Edit bank account' : 'Add bank account'}
      icon="credit-card"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={() => onSave({
              accountHolderName: accountHolderName.trim(),
              bankName: bankName.trim(),
              accountNumber: accountNumber.trim(),
              ifsc: ifsc.trim(),
              branch: branch.trim() || null,
              showOnDocuments,
            })}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Account holder name" required htmlFor="ba-holder" className="sm:col-span-2">
          <input id="ba-holder" value={accountHolderName} onChange={(e) => setAccountHolderName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Bank name" required htmlFor="ba-bank">
          <input id="ba-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Branch" htmlFor="ba-branch">
          <input id="ba-branch" value={branch} onChange={(e) => setBranch(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Account number" required htmlFor="ba-number">
          <input id="ba-number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} className={`${inputClass} font-mono`} />
        </Field>
        <Field label="IFSC" required hint="e.g. HDFC0001234" htmlFor="ba-ifsc">
          <input id="ba-ifsc" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} maxLength={11} className={`${inputClass} font-mono uppercase`} />
        </Field>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" checked={showOnDocuments} onChange={(e) => setShowOnDocuments(e.target.checked)} />
          <span className="text-sm">Show on quotations and invoices</span>
        </label>
      </div>
    </Modal>
  );
}
