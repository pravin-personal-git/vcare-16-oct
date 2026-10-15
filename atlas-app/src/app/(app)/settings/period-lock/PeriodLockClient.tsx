'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { formatFinancialYear } from '@/lib/financial-year';
import type { PeriodReport } from '@/server/accounting-periods';
import { setPeriodLockAction } from './actions';

/**
 * Closing the books, month by month (3 Oct 2026).
 *
 * THE SCREEN IS A ROW PER MONTH AND NOT A DATE RANGE PICKER, because that is how
 * the decision is actually made: an accountant finishes a month, files on it, and
 * wants nothing more dated into it. A free date range would let somebody close
 * 14 March to 2 April, which no return is ever filed on and which Atlas would
 * then have to explain on every refusal.
 *
 * Closing is one click. REOPENING asks for a reason, which is the right way round
 * - closing says "these figures are final", and reopening is the act somebody is
 * asked about six months later when the books and the filed return disagree.
 */

type MonthVM = Omit<PeriodReport['months'][number], 'startDate' | 'endDate' | 'lockedAt'> & {
  startDate: string;
  endDate: string;
  lockedAt: string | null;
};

interface Props {
  report: Omit<PeriodReport, 'months'> & { months: MonthVM[] };
  thisYear: number;
  canEdit: boolean;
  scopeIsAll: boolean;
}

const when = (iso: string | null) =>
  (iso
    ? new Date(iso).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    })
    : null);

export function PeriodLockClient({ report, thisYear, canEdit, scopeIsAll }: Props) {
  const { months, financialYear, lockedCount } = report;
  const years = [thisYear, thisYear - 1, thisYear - 2];

  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [reopening, setReopening] = useState<MonthVM | null>(null);
  const [reason, setReason] = useState('');
  const [, startTransition] = useTransition();

  const run = (monthIndex: number, locked: boolean, why?: string) => {
    setBusyIndex(monthIndex); setNote(null);
    startTransition(async () => {
      const r = await setPeriodLockAction({ financialYear, monthIndex, locked, reason: why });
      setBusyIndex(null);
      setReopening(null);
      setReason('');
      setNote(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Done.' });
    });
  };

  return (
    <>
      <PageHeader
        badge="LCK"
        title="Close the books"
        subtitle="Stop anything new being dated into a month you have already filed on"
        actions={
          <div className="flex items-center gap-1">
            {years.map((y) => (
              <Link
                key={y}
                href={`/settings/period-lock?fy=${y}`}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                  y === financialYear
                    ? 'border-brand bg-brand/10 text-on-tint-brand'
                    : 'border-border text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {formatFinancialYear(y)}
              </Link>
            ))}
          </div>
        }
      />

      {scopeIsAll ? (
        <EmptyState
          icon="building"
          title="Pick a single branch"
          hint="Branches file and reconcile separately, so each closes its own months. Showing all of them at once would mean twelve rows with a different answer each."
        />
      ) : (
        <>
          <Card className="mb-4 p-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Closing a month refuses any new invoice, receipt, bill, payment, credit note or journal
              entry <strong className="text-foreground">dated inside it</strong>. A correction then
              goes into the current month as a reversal, which is what an accountant wants anyway
              &mdash; the figures you filed stay the figures you filed. It does not change or delete
              anything already there.
            </p>
            {lockedCount === 0 && (
              /*
                Said plainly because of what was actually wrong here: the lock
                has existed in the ledger since the beginning and nothing could
                ever create a period, so every month of every year has been open
                for every tenant. Finding that out from a silent screen would be
                worse than being told.
              */
              <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs leading-relaxed">
                <strong>Nothing is closed yet.</strong> Until a month is closed, somebody can date an
                invoice into any month of any year &mdash; including one you have already filed a GST
                return on. Close each month once you have filed it.
              </p>
            )}
          </Card>

          {note && (
            <Card className={`mb-3 p-3 text-sm ${
              note.ok ? 'border-success/40 bg-success/10 text-foreground' : 'border-danger/40 bg-danger/10 text-on-tint-danger'
            }`}>
              {note.text}
            </Card>
          )}

          <SectionCard
            title={`${formatFinancialYear(financialYear)} · ${lockedCount} of 12 closed`}
            icon="calendar"
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="border-b border-border bg-muted/40 text-micro uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-start font-medium">Month</th>
                    <th className="px-4 py-2 text-end font-medium">Ledger entries</th>
                    <th className="px-4 py-2 text-start font-medium">State</th>
                    <th className="px-4 py-2 text-start font-medium">Closed</th>
                    {canEdit && <th className="px-4 py-2 text-end font-medium" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {months.map((m) => (
                    <tr
                      key={m.monthIndex}
                      /*
                        A reopen request's entityId is `<financial year>-<month
                        index>` - see settings/period-lock/actions - so the row
                        it is about can say so exactly, and My Desk's "Open"
                        lands on the month rather than on the table
                        (8 Oct 2026).
                      */
                      data-row-id={`${financialYear}-${m.monthIndex}`}
                      className={m.future ? 'opacity-50' : undefined}
                    >
                      <td className="px-4 py-2 font-medium">{m.label}</td>
                      <td className="px-4 py-2 text-end font-mono tabular-nums">
                        {m.entries > 0 ? m.entries : <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="px-4 py-2">
                        {m.locked ? (
                          <Badge tone="danger" icon="lock">Closed</Badge>
                        ) : m.future ? (
                          <Badge tone="neutral">Not started</Badge>
                        ) : m.ended ? (
                          <Badge tone="warning">Open</Badge>
                        ) : (
                          <Badge tone="info">This month</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {m.locked
                          ? `${when(m.lockedAt) ?? ''}${m.lockedByName ? ` by ${m.lockedByName}` : ''}`
                          : '—'}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-2 text-end">
                          {m.future ? (
                            <span className="text-xs text-muted-foreground">nothing to close</span>
                          ) : m.locked ? (
                            <Button
                              variant="ghost"
                              loading={busyIndex === m.monthIndex}
                              onClick={() => { setReopening(m); setReason(''); }}
                            >
                              Reopen
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              loading={busyIndex === m.monthIndex}
                              onClick={() => run(m.monthIndex, true)}
                              title={m.ended
                                ? 'Nothing new can be dated into this month afterwards'
                                : 'This month has not finished - closing it will refuse work dated today'}
                            >
                              {m.ended ? 'Close' : 'Close early'}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {!canEdit && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon name="info" className="h-3.5 w-3.5" />
              You can see which months are closed. Closing or reopening one needs the Accounts edit
              permission.
            </p>
          )}
        </>
      )}

      {reopening && (
        <Modal
          title={`Reopen ${reopening.label}?`}
          subtitle="This is the decision somebody will ask about later"
          icon="lock"
          tone="accent"
          size="md"
          onClose={() => setReopening(null)}
          footer={
            <>
              <Button onClick={() => setReopening(null)}>Cancel</Button>
              <Button
                variant="danger"
                disabled={!reason.trim()}
                loading={busyIndex === reopening.monthIndex}
                onClick={() => run(reopening.monthIndex, false, reason)}
              >
                Reopen the month
              </Button>
            </>
          }
        >
          <div className="grid gap-3">
            <p className="text-sm leading-relaxed">
              {reopening.label} was closed on {when(reopening.lockedAt)}
              {reopening.lockedByName ? ` by ${reopening.lockedByName}` : ''}. Anything posted into it
              from now on will <strong>not</strong> be in the figures already filed for that month, and
              the two will disagree until somebody files a revision.
            </p>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Why is it being reopened?</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                autoFocus
                placeholder="e.g. a supplier bill for March arrived in May and the return is being revised"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-brand"
              />
            </label>
          </div>
        </Modal>
      )}
    </>
  );
}
