'use client';

import { useState } from 'react';
import { Card, Badge, EmptyState } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ExportButton } from '@/components/ui/ExportButton';
import { formatCurrencyCompact } from '@/lib/format';
import {
  MEASURE_GROUPS, MEASURES, emptyGroupReason, measuresIn, totalActivity,
  type ActivityRow, type Measure, type MeasureGroup,
} from '@/lib/team-activity';

/**
 * Everything that is not a field job (Vcare wave 4, 8 Oct 2026).
 *
 * The table beside this one measures technicians well and measures nobody
 * else at all - every figure in it comes off a complaint, so a salesperson
 * with forty quotations and a coordinator with ninety calls both appear as
 * blank. This is the other half, built from what Atlas already records.
 *
 * FOUR GROUPS, ONE AT A TIME. Sixteen measures across one table is a
 * spreadsheet nobody reads; the group tabs mean four to six columns at a
 * time, which fits a laptop and reads on a phone. The group names are what
 * the work is - talking to customers, selling, doing the work, being there -
 * not the module it came out of, because nobody thinks in modules.
 *
 * PEOPLE WITH NOTHING RECORDED STILL GET A ROW, at the end and in grey.
 * "Nobody has logged anything for this person" is frequently the finding -
 * somebody not using the app, or a department whose work Atlas does not yet
 * capture - and dropping them off the list hides it behind what looks like a
 * filter.
 */
export function ActivityTable({ rows, rangeLabel, onlyMine }: {
  rows: ActivityRow[];
  rangeLabel: string;
  onlyMine: boolean;
}) {
  const [group, setGroup] = useState<MeasureGroup>('Talking to customers');
  const [showSilent, setShowSilent] = useState(false);

  const cols = measuresIn(group);
  const silent = rows.filter((r) => r.silent);
  const shown = showSilent ? rows : rows.filter((r) => !r.silent);
  const totals = totalActivity(rows);
  /*
    A column of dashes reads as "this team did nothing". Usually it means
    nothing was recorded against anybody, which is a different statement and
    the one somebody can act on.
  */
  const nothingHere = emptyGroupReason(group, totals);

  const cell = (r: ActivityRow, m: Measure) => {
    const v = r[m.key] ?? 0;
    if (m.money) return v === 0 ? '-' : formatCurrencyCompact(v);
    return v === 0 ? '-' : v.toLocaleString('en-IN');
  };

  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">Everything else</h2>
          <p className="text-xs text-muted-foreground">
            {rangeLabel} · calls, leads, quotations, orders, invoices, tasks, visits and attendance.
            {onlyMine && ' You see your own line only.'}
          </p>
        </div>
        <ExportButton
          title={`Team activity - ${group}`}
          rows={rows}
          columns={[
            { header: 'Person', value: (r: ActivityRow) => r.name },
            { header: 'Department', value: (r: ActivityRow) => r.departmentName ?? '' },
            // The export carries EVERY measure, not only the open tab - a
            // spreadsheet is where somebody wants all of it at once.
            ...MEASURES.map((m) => ({
              header: m.label,
              value: (r: ActivityRow) => (m.money ? (r[m.key] ?? 0) / 100 : r[m.key] ?? 0),
            })),
          ]}
        />
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {MEASURE_GROUPS.map((g) => (
          <Button key={g} size="sm" variant={g === group ? 'primary' : 'outline'} onClick={() => setGroup(g)}>
            {g}
          </Button>
        ))}
      </div>

      {nothingHere && (
        <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Icon name="info" className="mt-px h-3.5 w-3.5 shrink-0" />
          {nothingHere}
        </p>
      )}

      {shown.length === 0 ? (
        <EmptyState
          icon="users"
          title="Nothing recorded for anybody in this period"
          hint="Calls sync from the phones, and the rest comes from the documents people raise. A whole branch at zero usually means the period is wrong, not that nobody worked."
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-semibold">Person</th>
                {cols.map((m) => (
                  // `title` carries the exact definition. A column head has
                  // room for two words; what is counted takes a sentence.
                  <th key={m.key} className="px-3 py-2 text-end font-semibold" title={m.counts}>{m.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.userId} className={`border-t border-border hover:bg-muted/40 ${r.silent ? 'opacity-55' : ''}`}>
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.name}</span>
                    {r.departmentName && <Badge tone="neutral" className="ms-2">{r.departmentName}</Badge>}
                    {r.silent && <span className="ms-2 text-micro text-muted-foreground">nothing recorded</span>}
                  </td>
                  {cols.map((m) => (
                    <td key={m.key} className="px-3 py-2 text-end tabular-nums">{cell(r, m)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                <td className="px-3 py-2">Everyone</td>
                {cols.map((m) => (
                  <td key={m.key} className="px-3 py-2 text-end tabular-nums">
                    {m.money ? formatCurrencyCompact(totals[m.key]) : totals[m.key].toLocaleString('en-IN')}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      {silent.length > 0 && (
        <button
          type="button"
          onClick={() => setShowSilent(!showSilent)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          <Icon name={showSilent ? 'eye-off' : 'eye'} className="h-3 w-3" />
          {showSilent
            ? `Hide the ${silent.length} with nothing recorded`
            : `${silent.length} ${silent.length === 1 ? 'person has' : 'people have'} nothing recorded — show them`}
        </button>
      )}

      {/*
        Said once, plainly, under the numbers. The first thing a table like
        this invites is a league table, and two of these columns cannot bear
        that weight at all.
      */}
      <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
        These are counts of what people did, not a score. Ninety calls is not better than forty, and
        a quotation raised is not money earned. <strong>Money collected is missing</strong> — Atlas does not
        record who took a payment, so it cannot be shown per person.
      </p>
    </section>
  );
}
