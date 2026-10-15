'use client';
import { EmployeeLink } from '@/components/document/EmployeeLink';
import { describeRule, formatDistance } from '@/lib/distance';
import { ListFilter } from '@/components/ui/ListFilter';

import { useRouter } from 'next/navigation';
import { Card, EmptyState, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';

interface MonthlySummaryRowVM {
  userId: string;
  userName: string;
  present: number;
  late: number;
  halfDay: number;
  wfh: number;
  leave: number;
  absent: number;
  unmarked: number;
  workingDays: number;
}

const MONTH_LABEL = (year: number, month: number) =>
  new Date(year, month, 1).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' });

const shiftMonth = (year: number, month: number, delta: number) => {
  const d = new Date(year, month + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function MonthlySummaryClient({
  year, month, rows, scopeIsAll, canLocate = false, distances = {},
}: {
  year: number;
  month: number;
  rows: MonthlySummaryRowVM[];
  scopeIsAll: boolean;
  /** Attendance: Locate. Without it the distance column is absent, not blank. */
  canLocate?: boolean;
  /** Per user. Null means location tracking is off for them - not zero km. */
  distances?: Record<string, { metres: number; usedPoints: number; mocked: number } | null>;
}) {
  const router = useRouter();

  if (scopeIsAll) {
    return (
      <div>
        <PageHeader badge="AT" title="Monthly Summary" subtitle="Everyone's totals for the month" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="Monthly totals are kept per branch." />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        badge="AT"
        title="Monthly Summary"
        subtitle="Present, late, absent and leave totals for the month - the same figures the grid's own column totals show"
        actions={
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => router.push(`/attendance/monthly-summary?m=${shiftMonth(year, month, -1)}`)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card transition hover:bg-muted" aria-label="Previous month">
              <Icon name="chevron-left" className="h-4 w-4" />
            </button>
            <span className="px-2 text-sm font-medium">{MONTH_LABEL(year, month)}</span>
            <button type="button" onClick={() => router.push(`/attendance/monthly-summary?m=${shiftMonth(year, month, 1)}`)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card transition hover:bg-muted" aria-label="Next month">
              <Icon name="chevron-right" className="h-4 w-4" />
            </button>
          </span>
        }
      />

      <SectionCard title={`${rows.length} ${rows.length === 1 ? 'person' : 'people'}`} icon="users" bodyClassName="p-0">
        {rows.length === 0 ? (
          <EmptyState icon="users" title="Nobody to show" />
        ) : (
          /* F1b / D17. Tier B (F1-SPEC §3.1): a summary table gets search and a
             count, not status chips - the columns already are the statuses.
             "Anyone absent more than twice" is the question, and the chip below
             answers it without reading forty rows across nine columns. */
          <ListFilter
            rows={rows}
            noun="people"
            placeholder="Employee name…"
            searchOn={(r) => [r.userName]}
            chipOf={(r) => (r.absent > 0 || r.late > 0 ? 'flagged' : 'clean')}
            chipLabel="Attendance"
            chips={[
              { value: 'flagged', label: 'Late or absent', count: rows.filter((r) => r.absent > 0 || r.late > 0).length },
              { value: 'clean', label: 'Neither', count: rows.filter((r) => r.absent === 0 && r.late === 0).length },
            ]}
          >
            {(shown) => (shown.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see everybody." />
            ) : (
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 text-center font-medium">Present</th>
                  <th className="px-3 py-2 text-center font-medium">Late</th>
                  <th className="px-3 py-2 text-center font-medium">Half day</th>
                  <th className="px-3 py-2 text-center font-medium">WFH</th>
                  <th className="px-3 py-2 text-center font-medium">Leave</th>
                  <th className="px-3 py-2 text-center font-medium">Absent</th>
                  <th className="px-3 py-2 text-center font-medium">Not marked</th>
                  <th className="px-3 py-2 text-center font-medium">Working days</th>
                  {canLocate && <th className="px-3 py-2 text-center font-medium">Distance</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((r) => (
                  <tr key={r.userId}>
                    <td className="px-4 py-2.5 font-medium"><EmployeeLink id={r.userId}>{r.userName}</EmployeeLink></td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-success">{r.present}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-warning">{r.late}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums">{r.halfDay}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums">{r.wfh}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-info">{r.leave}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-danger">{r.absent}</td>
                    <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">{r.unmarked}</td>
                    <td className="px-3 py-2.5 text-center font-semibold tabular-nums">{r.workingDays}</td>
                    {canLocate && (
                      <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
                        {/* "Not tracked" rather than "0 km": a person whose
                            location tracking is off did not sit still, and
                            saying so about them would be wrong (F1c). */}
                        {distances[r.userId] === null || distances[r.userId] === undefined
                          ? <span className="text-xs">Not tracked</span>
                          : distances[r.userId]!.usedPoints < 2
                            ? <span className="text-xs">No readings</span>
                            : (
                              <span title={distances[r.userId]!.mocked > 0 ? `${distances[r.userId]!.mocked} simulated fixes ignored` : undefined}>
                                {formatDistance(distances[r.userId]!.metres)}
                                {distances[r.userId]!.mocked > 0 && <span className="ms-1 text-danger">*</span>}
                              </span>
                            )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            ))}
          </ListFilter>
        )}
      </SectionCard>

      {/* The method, beside the numbers (F1c). Without it "18.4 km" is a
          figure people argue with rather than one they can check. */}
      {canLocate && rows.length > 0 && (
        <p className="mt-2 px-1 text-xs leading-relaxed text-muted-foreground">
          <strong>Distance is approximate and deliberately under-counts.</strong> {describeRule()}{' '}
          Straight lines between readings, so a winding route counts as less than it really was.
          &ldquo;Not tracked&rdquo; means location tracking is off for that person - it does not
          mean they did not travel. An asterisk marks a month where simulated locations were
          found and ignored.
        </p>
      )}
    </div>
  );
}
