'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Card, Field, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { saveOpeningBalanceAction } from './actions';

interface Existing {
  asOfDate: string;
  cashPaise: number;
  bankPaise: number;
  capitalPaise: number;
  fixedAssetsPaise: number;
  loansPaise: number;
  note: string | null;
}

/** Rupees typed by a person into integer paise. Never floats near money. */
function toPaise(v: string): number {
  const n = Number(String(v).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

const toRupees = (p: number) => (p / 100).toFixed(2);

export function OpeningBalanceClient({
  existing, canEdit, scopeIsAll,
}: {
  existing: Existing | null;
  canEdit: boolean;
  scopeIsAll: boolean;
}) {
  const router = useRouter();

  const [asOf, setAsOf] = useState(existing?.asOfDate ?? new Date().toISOString().slice(0, 10));
  const [cash, setCash] = useState(existing ? toRupees(existing.cashPaise) : '0');
  const [bank, setBank] = useState(existing ? toRupees(existing.bankPaise) : '0');
  const [capital, setCapital] = useState(existing ? toRupees(existing.capitalPaise) : '0');
  const [assets, setAssets] = useState(existing ? toRupees(existing.fixedAssetsPaise) : '0');
  const [loans, setLoans] = useState(existing ? toRupees(existing.loansPaise) : '0');
  const [note, setNote] = useState(existing?.note ?? '');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setSaved(null);
    const r = await saveOpeningBalanceAction({
      asOfDate: asOf,
      cashPaise: toPaise(cash),
      bankPaise: toPaise(bank),
      capitalPaise: toPaise(capital),
      fixedAssetsPaise: toPaise(assets),
      loansPaise: toPaise(loans),
      note: note.trim() || null,
    });
    setBusy(false);
    if (r.error) setError(r.error);
    else { setSaved(r.message ?? 'Saved.'); router.refresh(); }
  };

  return (
    <>
      <PageHeader
        badge="OB"
        title="Opening Balances"
        subtitle="The figures the balance sheet needs that your documents cannot supply"
        actions={
          <Link href="/reports/balance-sheet">
            <Button icon="trending-up">Balance sheet</Button>
          </Link>
        }
      />

      {scopeIsAll && (
        <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="flex-1 text-xs leading-relaxed">
            <strong>Select a single branch first.</strong> Opening balances belong to one
            branch - a bank balance shared across three shops is nobody&apos;s balance.
          </p>
        </Card>
      )}

      <Card className="mb-4 flex items-start gap-2.5 px-3 py-2.5">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        <div className="flex-1 text-xs leading-relaxed">
          <strong>You only type these once.</strong>
          <p className="mt-1">
            Atlas works out what customers owe you, what you owe suppliers and what your stock
            is worth - all from your documents. It has no way of knowing what was already in
            your bank on the day you started using it, or how much money you put into the
            business. Those two are usually the biggest numbers on a balance sheet.
          </p>
          <p className="mt-1">
            Anything Atlas records <em>after</em> the date below is added to these figures.
            Anything before is assumed to be inside them already - so pick the day you started
            entering real documents, not the day the business was founded.
          </p>
        </div>
      </Card>

      {error && (
        <Card className="mb-3 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <p className="text-xs text-danger">{error}</p>
        </Card>
      )}
      {saved && (
        <Card className="mb-3 border-success/30 bg-success/[0.06] px-3 py-2.5">
          <p className="text-xs text-success">{saved}</p>
        </Card>
      )}

      <SectionCard title="As at" icon="clock" className="mb-3">
        <Field
          label="These figures were true on"
          hint="Usually the day you started entering real invoices and bills into Atlas."
        >
          <input
            type="date"
            className="w-full max-w-xs rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            disabled={!canEdit}
          />
        </Field>
      </SectionCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <SectionCard title="What you had" icon="package">
          <Money
            label="Cash in hand"
            hint="Notes in the drawer and the safe."
            value={cash} onChange={setCash} disabled={!canEdit}
          />
          <Money
            label="Bank balance"
            hint="All accounts added together. Atlas does not track accounts separately, so one figure is more honest than a split it cannot maintain."
            value={bank} onChange={setBank} disabled={!canEdit}
          />
          <Money
            label="Fixed assets"
            hint="Vehicles, machinery, fittings - at what they are worth now, not what you paid. Atlas does not calculate depreciation, so you update this yourself."
            value={assets} onChange={setAssets} disabled={!canEdit}
          />
        </SectionCard>

        <SectionCard title="Where it came from" icon="credit-card">
          <Money
            label="Capital introduced"
            hint="Money the owner put in and does not expect back."
            value={capital} onChange={setCapital} disabled={!canEdit}
          />
          <Money
            label="Loans outstanding"
            hint="Borrowings still to be repaid - bank loans, family money that comes back. Enter it as a positive number."
            value={loans} onChange={setLoans} disabled={!canEdit}
          />

          <div className="mt-3">
            <Field label="Note" hint="Optional - where these figures came from.">
              <input
                className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="From the 31 March balance sheet"
                disabled={!canEdit}
              />
            </Field>
          </div>
        </SectionCard>
      </div>

      {canEdit && (
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={submit} loading={busy} disabled={busy || scopeIsAll}>
            {existing ? 'Update' : 'Save'}
          </Button>
          <span className="text-xs text-muted-foreground">
            Changing these changes every total on the balance sheet.
          </span>
        </div>
      )}

      {!canEdit && (
        <p className="mt-4 text-xs text-muted-foreground">
          You can see these but not change them - that needs the <code>accounts.edit</code>{' '}
          permission.
        </p>
      )}

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        <strong>If you are not sure of a figure, leave it at zero</strong> rather than guessing.
        A zero is visibly missing on the balance sheet, and somebody will ask about it. A wrong
        number looks exactly like a right one and nobody ever asks.
      </p>
    </>
  );
}

function Money({
  label, hint, value, onChange, disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <Field label={label} hint={hint}>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">₹</span>
          <input
            className="w-full max-w-[14rem] rounded-md border border-border bg-card px-2 py-1.5 text-sm tabular-nums"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputMode="decimal"
            disabled={disabled}
          />
        </div>
      </Field>
    </div>
  );
}
