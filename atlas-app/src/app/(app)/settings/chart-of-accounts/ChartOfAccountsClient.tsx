'use client';
import { ListFilter } from '@/components/ui/ListFilter';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal, ConfirmDialog } from '@/components/ui/Modal';
import type { AccountRow } from '@/server/chart-of-accounts';
import { createAccountAction, deactivateAccountAction, updateAccountAction } from './actions';

const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

const input = 'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function ChartOfAccountsClient({
  accounts, canEdit,
}: {
  accounts: AccountRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [removing, setRemoving] = useState<AccountRow | null>(null);

  const report = (res: { error?: string; message?: string }) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : res.message ?? null);
    if (!res.error) router.refresh();
  };

  /**
   * Grouping happens AFTER filtering (F1b / D17), so a search collapses the
   * whole chart to the types that still have a match rather than leaving empty
   * headings behind. A chart of accounts runs to a few hundred codes and the
   * only way to find one was to scroll.
   */
  const groupOf = (rows: AccountRow[]) => {
    const byType = new Map<string, AccountRow[]>();
    for (const a of rows) byType.set(a.type, [...(byType.get(a.type) ?? []), a]);
    return TYPES.map((t) => ({ type: t, rows: byType.get(t) ?? [] })).filter((g) => g.rows.length > 0);
  };

  return (
    <div>
      <PageHeader
        badge="CA"
        title="Chart of Accounts"
        subtitle="What the general ledger posts to, by code"
        actions={
          canEdit ? (
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              Add Account
            </Button>
          ) : undefined
        }
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}
      {notice && !error && (
        <Card className="mb-3 border-success/40 bg-success/5 p-3">
          <p className="flex items-start gap-2 text-sm">
            <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>{notice}</span>
          </p>
        </Card>
      )}

      {accounts.length === 0 ? (
        <Card><EmptyState icon="sliders" title="No accounts yet" /></Card>
      ) : (
        <Card className="mb-4 overflow-hidden p-0">
          <ListFilter
            rows={accounts}
            noun="accounts"
            placeholder="Code, name, sub-type, parent…"
            searchOn={(a) => [a.code, a.name, a.subType, a.parentName, a.type]}
            chipOf={(a) => (a.isSystem ? 'standard' : 'custom')}
            chipLabel="Source"
            chips={[
              { value: 'standard', label: 'Standard', count: accounts.filter((a) => a.isSystem).length },
              { value: 'custom', label: 'Custom', count: accounts.filter((a) => !a.isSystem).length },
            ]}
          >
            {(shown) => (shown.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see the whole chart." />
            ) : (
        <div className="grid gap-4 p-3">
          {groupOf(shown).map(({ type, rows }) => (
            <SectionCard key={type} title={type} icon="sliders" bodyClassName="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-semibold">Code</th>
                    <th className="px-4 py-2 font-semibold">Name</th>
                    <th className="px-4 py-2 font-semibold">Sub-type</th>
                    <th className="px-4 py-2 font-semibold">Parent</th>
                    <th className="px-4 py-2 font-semibold">Source</th>
                    {canEdit && <th className="w-20 px-4 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-mono">{a.code}</td>
                      <td className="px-4 py-2 font-medium">{a.name}</td>
                      <td className="px-4 py-2 text-muted-foreground">{a.subType ?? '-'}</td>
                      <td className="px-4 py-2 text-muted-foreground">{a.parentName ?? '-'}</td>
                      <td className="px-4 py-2">
                        <Badge tone={a.isSystem ? 'info' : 'neutral'}>{a.isSystem ? 'Standard' : 'Custom'}</Badge>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-2">
                          {!a.isSystem && (
                            <div className="flex items-center justify-end gap-1">
                              <button type="button" title="Edit" aria-label={`Edit ${a.name}`}
                                onClick={() => setEditing(a)}
                                className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                                <Icon name="pencil" className="h-3.5 w-3.5" />
                              </button>
                              <button type="button" title="Remove" aria-label={`Remove ${a.name}`}
                                disabled={a.journalLineCount > 0}
                                onClick={() => setRemoving(a)}
                                className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-30">
                                <Icon name="trash" className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          ))}
        </div>
            ))}
          </ListFilter>
        </Card>
      )}

      {(adding || editing) && (
        <AccountForm
          account={editing}
          accounts={accounts}
          busy={pending}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSubmit={(values) => {
            setError(null); setNotice(null);
            startTransition(async () => {
              const res = editing
                ? await updateAccountAction(editing.id, { name: values.name, subType: values.subType })
                : await createAccountAction(values);
              report(res);
              if (!res.error) { setAdding(false); setEditing(null); }
            });
          }}
        />
      )}

      {removing && (
        <ConfirmDialog
          title={`Remove "${removing.name}"?`}
          message="Nothing has posted to this account, so removing it is safe. This cannot be undone."
          confirmLabel="Remove"
          tone="danger"
          busy={pending}
          onConfirm={() => {
            setError(null); setNotice(null);
            startTransition(async () => {
              const res = await deactivateAccountAction(removing.id);
              report(res);
              if (!res.error) setRemoving(null);
            });
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function AccountForm({
  account, accounts, busy, onClose, onSubmit,
}: {
  account: AccountRow | null;
  accounts: AccountRow[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (values: { code: string; name: string; type: string; subType: string | null; parentId: string | null }) => void;
}) {
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState(account?.type ?? TYPES[0]);
  const [subType, setSubType] = useState(account?.subType ?? '');
  const [parentId, setParentId] = useState(account?.parentId ?? '');

  const ready = code.trim() !== '' && name.trim() !== '';
  const possibleParents = accounts.filter((a) => a.id !== account?.id && a.type === type);

  return (
    <Modal
      title={account ? `Edit ${account.name}` : 'Add Account'}
      icon="sliders"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon="check" disabled={!ready || busy} loading={busy}
            onClick={() => onSubmit({
              code: code.trim(), name: name.trim(), type,
              subType: subType.trim() || null, parentId: parentId || null,
            })}>
            {account ? 'Save changes' : 'Add Account'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code" required htmlFor="acc-code">
            <input id="acc-code" value={code} disabled={!!account}
              onChange={(e) => setCode(e.target.value)} className={`${input} disabled:opacity-60`} />
          </Field>
          <Field label="Type" required htmlFor="acc-type">
            <select id="acc-type" value={type} disabled={!!account}
              onChange={(e) => { setType(e.target.value); setParentId(''); }}
              className={`${input} disabled:opacity-60 capitalize`}>
              {TYPES.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Name" required htmlFor="acc-name">
          <input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </Field>
        <Field label="Sub-type" hint="Optional, e.g. current_asset, bank, receivable" htmlFor="acc-subtype">
          <input id="acc-subtype" value={subType} onChange={(e) => setSubType(e.target.value)} className={input} />
        </Field>
        {!account && (
          <Field label="Parent account" hint="Optional" htmlFor="acc-parent">
            <select id="acc-parent" value={parentId} onChange={(e) => setParentId(e.target.value)} className={input}>
              <option value="">None</option>
              {possibleParents.map((p) => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
