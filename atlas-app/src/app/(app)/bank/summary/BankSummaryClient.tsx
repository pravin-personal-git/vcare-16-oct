'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, EmptyState, PageHeader, SectionCard } from '@/components/ui/Layout';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import { BOM, parseCsv, rowsToObjects, toCsv } from '@/lib/csv';
import {
  loadStatementAction, importStatementAction, autoReconcileAction, suggestMatchesAction,
  confirmMatchAction, clearMatchAction,
} from './actions';

const dateFmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

interface Account {
  id: string;
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
  isActive: boolean;
  isDefault: boolean;
  openingBalancePaise: number;
  currentBalancePaise: number;
  lastTxnAt: string | null;
  unmatchedCount: number;
}

interface Totals {
  totalAccounts: number;
  activeAccounts: number;
  openingBalancePaise: number;
  currentBalancePaise: number;
}

interface Line {
  id: string;
  txnDate: string;
  description: string;
  debitPaise: number;
  creditPaise: number;
  reference: string | null;
  balancePaise: number;
  matchedType: 'Receipt' | 'SupplierPayment' | 'Transaction' | null;
  matchedId: string | null;
  matchedLabel: string | null;
  matchedAt: string | null;
}

type Candidate = Awaited<ReturnType<typeof suggestMatchesAction>>[number];

export function BankSummaryClient({
  totals, accounts, initialAccountId, initialLines, canEdit,
}: {
  totals: Totals;
  accounts: Account[];
  initialAccountId: string | null;
  initialLines: Line[];
  canEdit: boolean;
}) {
  const [accountId, setAccountId] = useState(initialAccountId);
  const [lines, setLines] = useState(initialLines);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [matching, setMatching] = useState<Line | null>(null);
  const [pending, startTransition] = useTransition();

  const account = accounts.find((a) => a.id === accountId) ?? null;

  const kpis: KpiCard[] = [
    { key: 'total', label: 'Total Accounts', count: totals.totalAccounts, icon: 'credit-card' },
    { key: 'opening', label: 'Opening Balance', count: formatCurrencyCompact(totals.openingBalancePaise), icon: 'bar-chart' },
    { key: 'current', label: 'Current Balance', count: formatCurrencyCompact(totals.currentBalancePaise), icon: 'trending-up', tone: totals.currentBalancePaise < 0 ? 'danger' : 'success' },
    { key: 'active', label: 'Active Accounts', count: totals.activeAccounts, icon: 'check-circle' },
  ];

  async function reload(nextAccountId: string, nextFrom = from, nextTo = to) {
    setBusy(true);
    setError(null);
    try {
      const res = await loadStatementAction(nextAccountId, nextFrom || null, nextTo || null);
      setLines(res.lines as unknown as Line[]);
    } catch {
      setError('Could not load that account’s statement.');
    } finally {
      setBusy(false);
    }
  }

  function selectAccount(id: string) {
    setAccountId(id);
    startTransition(async () => { await reload(id); });
  }

  function applyDateFilter() {
    if (!accountId) return;
    startTransition(async () => { await reload(accountId); });
  }

  async function onFile(file: File) {
    if (!accountId) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const text = await file.text();
      const { rows } = rowsToObjects(parseCsv(text));
      if (rows.length === 0) {
        setError('That file has no data rows.');
        return;
      }
      const res = await importStatementAction(accountId, rows);
      if (res.error) { setError(res.error); return; }
      const parts = [`Imported ${res.imported} line${res.imported === 1 ? '' : 's'}`];
      if (res.duplicates) parts.push(`${res.duplicates} already on file, skipped`);
      if (res.errors?.length) parts.push(`${res.errors.length} row(s) could not be read`);
      setNotice(parts.join(' - '));
      await reload(accountId);
    } catch {
      setError('Could not read that file. Check it is a plain CSV export.');
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    if (!accountId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await autoReconcileAction(accountId);
    if (res.error) setError(res.error);
    else setNotice(`Matched ${res.autoMatched} automatically. ${res.ambiguous} need a manual pick. ${res.stillUnmatched} still unmatched.`);
    await reload(accountId);
    setBusy(false);
  }

  function exportCsv() {
    if (!account) return;
    const csv = BOM + toCsv(lines, [
      { header: 'Date', value: (l: Line) => dateFmt(l.txnDate) },
      { header: 'Description', value: (l: Line) => l.description },
      { header: 'Debit', value: (l: Line) => (l.debitPaise / 100).toFixed(2) },
      { header: 'Credit', value: (l: Line) => (l.creditPaise / 100).toFixed(2) },
      { header: 'Balance', value: (l: Line) => (l.balancePaise / 100).toFixed(2) },
      { header: 'Reference', value: (l: Line) => l.reference ?? '' },
      { header: 'Matched', value: (l: Line) => l.matchedLabel ?? '' },
    ]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${account.bankName.replace(/\s+/g, '-').toLowerCase()}-statement.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function unmatch(line: Line) {
    setBusy(true);
    const res = await clearMatchAction(line.id);
    if (res.error) setError(res.error);
    if (accountId) await reload(accountId);
    setBusy(false);
  }

  const columns: Column<Line>[] = [
    { key: 'date', header: 'Date', render: (l) => dateFmt(l.txnDate), sortValue: (l) => l.txnDate, width: '110px' },
    { key: 'description', header: 'Description', render: (l) => <span className="line-clamp-1">{l.description}</span>, sortValue: (l) => l.description },
    { key: 'reference', header: 'Reference', render: (l) => l.reference ?? '-', sortValue: (l) => l.reference ?? '' },
    { key: 'debit', header: 'Debit', align: 'end', render: (l) => (l.debitPaise ? formatCurrency(l.debitPaise) : ''), sortValue: (l) => l.debitPaise },
    { key: 'credit', header: 'Credit', align: 'end', render: (l) => (l.creditPaise ? formatCurrency(l.creditPaise) : ''), sortValue: (l) => l.creditPaise },
    { key: 'balance', header: 'Balance', align: 'end', render: (l) => formatCurrency(l.balancePaise), sortValue: (l) => l.balancePaise },
    {
      key: 'matched',
      header: 'Matched',
      render: (l) => (l.matchedLabel ? (
        <span className="inline-flex items-center gap-1.5">
          <Badge tone="success">{l.matchedType}</Badge>
          <span className="text-xs text-muted-foreground">{l.matchedLabel}</span>
          {canEdit && (
            <button type="button" title="Unmatch" onClick={() => unmatch(l)} className="text-muted-foreground hover:text-danger">
              <Icon name="x-circle" className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      ) : canEdit ? (
        <Button size="sm" onClick={() => setMatching(l)}>Match</Button>
      ) : (
        <Badge tone="warning">Unmatched</Badge>
      )),
      sortValue: (l) => (l.matchedLabel ? 1 : 0),
    },
  ];

  return (
    <div>
      <PageHeader
        badge="BS"
        title="Bank Statement"
        subtitle="Import a statement and match each line to a receipt or payment already recorded"
      />

      <KpiStrip cards={kpis} activeKey={null} onSelect={() => {}} columns={4} />

      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-sm text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}
      {notice && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-info/40 bg-info/5 p-2.5 text-sm text-on-tint-info">
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </p>
      )}

      <SectionCard title="Accounts" icon="credit-card" className="mb-4" bodyClassName="p-0">
        <div className="divide-y divide-border">
          {accounts.length === 0 && (
            <EmptyState icon="credit-card" title="No bank accounts yet" hint="Add one from Settings → Bank Accounts first." />
          )}
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => selectAccount(a.id)}
              className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-muted ${a.id === accountId ? 'bg-brand/[0.06]' : ''}`}
            >
              <span className="min-w-0">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{a.bankName}</span>
                  {a.isDefault && <Badge tone="brand">Default</Badge>}
                  {!a.isActive && <Badge tone="neutral">Inactive</Badge>}
                  {a.unmatchedCount > 0 && <Badge tone="warning">{a.unmatchedCount} unmatched</Badge>}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{a.accountHolderName} · {a.accountNumber}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-semibold tabular-nums">{formatCurrency(a.currentBalancePaise)}</span>
                <span className="block text-xs text-muted-foreground">
                  {a.lastTxnAt ? `last activity ${dateFmt(a.lastTxnAt)}` : 'no statement lines yet'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </SectionCard>

      {account && (
        <SectionCard
          title={`Statement - ${account.bankName}`}
          icon="file-text"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded-md border border-border bg-card px-2 text-xs" />
              <span className="text-xs text-muted-foreground">to</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 rounded-md border border-border bg-card px-2 text-xs" />
              <Button size="sm" onClick={applyDateFilter} disabled={busy || pending}>Apply</Button>
              <Button size="sm" icon="download" onClick={exportCsv}>Export</Button>
              {canEdit && (
                <>
                  <Button size="sm" icon="refresh" onClick={reconcile} disabled={busy || pending} loading={busy}>
                    Reconcile
                  </Button>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition hover:border-brand/40">
                    <Icon name="upload" className="h-3.5 w-3.5" />
                    Import statement
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }}
                    />
                  </label>
                </>
              )}
            </div>
          }
        >
          <DataGrid
            rows={lines}
            columns={columns}
            rowKey={(l) => l.id}
            emptyIcon="file-text"
            emptyMessage="No statement lines for this account yet"
            emptyHint={canEdit ? 'Import a CSV export from your bank to get started.' : undefined}
          />
        </SectionCard>
      )}

      {matching && (
        <MatchDialog
          line={matching}
          onClose={() => setMatching(null)}
          onMatched={async () => { setMatching(null); if (accountId) await reload(accountId); }}
        />
      )}
    </div>
  );
}

function MatchDialog({ line, onClose, onMatched }: { line: Line; onClose: () => void; onMatched: () => void }) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    suggestMatchesAction(line.id).then(setCandidates).catch(() => setError('Could not load suggestions.'));
  }, [line.id]);

  async function pick(c: Candidate) {
    setBusy(true);
    const res = await confirmMatchAction(line.id, c.type, c.id);
    setBusy(false);
    if (res.error) setError(res.error);
    else onMatched();
  }

  return (
    <Modal open title="Match statement line" subtitle={line.description} icon="check-circle" size="md" onClose={onClose}>
      <div className="grid gap-3">
        {error && <p className="text-sm text-danger">{error}</p>}
        <p className="text-xs text-muted-foreground">
          {line.creditPaise > 0 ? `Credit of ${formatCurrency(line.creditPaise)}` : `Debit of ${formatCurrency(line.debitPaise)}`} on {dateFmt(line.txnDate)}
        </p>
        {candidates === null && <p className="text-sm text-muted-foreground">Looking for matching receipts and payments…</p>}
        {candidates?.length === 0 && (
          <EmptyState icon="alert-circle" title="No matching record found" hint="Check the receipt or payment was recorded with a non-cash method and a similar date." />
        )}
        {candidates?.map((c) => (
          <button
            key={`${c.type}-${c.id}`}
            type="button"
            disabled={busy}
            onClick={() => pick(c)}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition hover:border-brand/40 hover:bg-muted disabled:opacity-50"
          >
            <span>
              <span className="flex items-center gap-2">
                <Badge tone="info">{c.type}</Badge>
                <span className="font-medium">{c.label}</span>
              </span>
              {c.partyName && <span className="block text-xs text-muted-foreground">{c.partyName}</span>}
            </span>
            <span className="text-right">
              <span className="block font-semibold tabular-nums">{formatCurrency(c.amountPaise)}</span>
              <span className="block text-xs text-muted-foreground">{dateFmt(c.date)}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
