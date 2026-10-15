'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Card, Badge, EmptyState } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { RANGE_PRESETS } from '@/lib/date-ranges';
import { minutesLabel, type PerfRow } from '@/lib/technician-performance';
import { ExportButton } from '@/components/ui/ExportButton';
import { ActivityTable } from './ActivityTable';
import type { ActivityRow } from '@/lib/team-activity';

interface JobView {
  id: string; complaintNo: string; customerId?: string; customerName: string; status: string; priority: string;
  createdAt: string; assignedAt: string | null; acceptedAt: string | null; firstOnSiteAt: string | null;
  resolvedAt: string | null; closedAt: string | null; timeOnSiteSec: number; reopenCount: number;
  signOff: string | null; techRatingStars: number | null; partsIssued: number; migrated: boolean;
}

const when = (d: string | null) => (d
  ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '-');

const SIGN_OFF: Record<string, string> = { otp: 'Customer OTP', customer: 'Customer', technician: 'Technician', office: 'Office' };

export function TechniciansClient({ rows, jobs, activity, range, rangeLabel, onlyMine }: {
  rows: PerfRow[];
  jobs: Record<string, JobView[]>;
  /** Everything that is not a field job (wave 4, 8 Oct 2026). */
  activity: ActivityRow[];
  range: string;
  rangeLabel: string;
  onlyMine: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const total = rows.reduce((a, r) => ({ assigned: a.assigned + r.assigned, closed: a.closed + r.closed, open: a.open + r.openNow }),
    { assigned: 0, closed: 0, open: 0 });

  return (
    <>
      <PageHeader
        badge="TP"
        title="Team Performance"
        subtitle={`${rangeLabel} · ${total.assigned} jobs assigned · ${total.closed} closed · ${total.open} open now`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
          <ExportButton title="Technician performance" rows={rows} columns={[
            { header: 'Technician', value: (r) => r.name }, { header: 'Assigned', value: (r) => r.assigned },
            { header: 'Accepted', value: (r) => r.accepted }, { header: 'Closed', value: (r) => r.closed },
            { header: 'Open now', value: (r) => r.openNow }, { header: 'To accept (min)', value: (r) => r.avgAcceptMin },
            { header: 'To reach (min)', value: (r) => r.avgReachMin }, { header: 'On site (min)', value: (r) => r.avgOnSiteMin },
            { header: 'To close (min)', value: (r) => r.avgCloseMin }, { header: 'Missed deadline', value: (r) => r.slaMissed },
            { header: 'Judged', value: (r) => r.slaTracked }, { header: 'Reopened', value: (r) => r.reopened },
            { header: 'Rating', value: (r) => r.avgRating }, { header: 'Parts issued', value: (r) => r.partsIssued },
            { header: 'Km', value: (r) => (r.km == null ? 'Not tracked' : r.km) },
          ]} />
          <select
            aria-label="Period" value={range === 'custom' ? 'this_month' : range}
            onChange={(e) => router.push(`/services/technicians?range=${e.target.value}`)}
            className="field-input h-9 w-auto py-1 text-sm"
          >
            {RANGE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          </div>
        }
      />
      <h2 className="-mt-3 text-base font-bold">Field jobs</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Jobs assigned in the period, jobs closed in it, and what is open right now. Times are averages; deadlines are the ones
        in Settings › Field jobs (old imported jobs are not judged). Tap a name for each job&apos;s timeline.
        {onlyMine && ' You see your own work only.'}
      </p>

      {rows.length === 0 ? (
        <EmptyState icon="user" title="No technician jobs in this period" hint="Assign complaints to technicians and their work shows here." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                {['Technician', 'Assigned', 'Accepted', 'Closed', 'Open now', 'To accept', 'To reach', 'On site', 'To close',
                  'Missed deadline', 'Reopened', 'Rating', 'Parts', 'Km'].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-semibold ${i === 0 ? 'text-start' : 'text-end'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.userId}>
                  <tr className="border-t border-border hover:bg-muted/40">
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setOpen(open === r.userId ? null : r.userId)}
                        className="flex items-center gap-1.5 font-medium text-start">
                        <Icon name={open === r.userId ? 'chevron-down' : 'chevron-right'} className="h-3.5 w-3.5 shrink-0" />
                        {r.name}
                      </button>
                      <p className="ms-5 text-xs text-muted-foreground">
                        Signed off: {(['otp', 'customer', 'technician', 'office'] as const)
                          .filter((k) => r.signOff[k] > 0).map((k) => `${SIGN_OFF[k]} ${r.signOff[k]}`).join(' · ') || '-'}
                      </p>
                    </td>
                    <Num v={r.assigned} />
                    <Num v={r.accepted} />
                    <Num v={r.closed} strong />
                    <Num v={r.openNow} />
                    <Txt v={minutesLabel(r.avgAcceptMin)} />
                    <Txt v={minutesLabel(r.avgReachMin)} />
                    <Txt v={minutesLabel(r.avgOnSiteMin)} />
                    <Txt v={minutesLabel(r.avgCloseMin)} />
                    <td className="px-3 py-2 text-end tabular-nums">
                      {r.slaTracked === 0 ? '-' : (
                        <span className={r.slaMissed > 0 ? 'font-semibold text-danger' : 'text-success'}>
                          {r.slaMissed} of {r.slaTracked}
                        </span>
                      )}
                    </td>
                    <Num v={r.reopened} warn={r.reopened > 0} />
                    <Txt v={r.avgRating != null ? `${r.avgRating}★ (${r.ratings})` : '-'} />
                    <Num v={r.partsIssued} />
                    <Txt v={r.km == null ? 'Not tracked' : `${r.km.toLocaleString('en-IN')}`} />
                  </tr>
                  {open === r.userId && (
                    <tr className="border-t border-border bg-muted/20">
                      <td colSpan={14} className="px-3 py-2">
                        <JobTimeline jobs={jobs[r.userId] ?? []} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ActivityTable rows={activity} rangeLabel={rangeLabel} onlyMine={onlyMine} />
    </>
  );
}

function Num({ v, strong, warn }: { v: number; strong?: boolean; warn?: boolean }) {
  return <td className={`px-3 py-2 text-end tabular-nums ${strong ? 'font-semibold' : ''} ${warn ? 'text-warning' : ''}`}>{v}</td>;
}

function Txt({ v }: { v: string }) {
  return <td className="whitespace-nowrap px-3 py-2 text-end text-xs tabular-nums">{v}</td>;
}

/** One line per job: created → assigned → accepted → on site → done. */
function JobTimeline({ jobs }: { jobs: JobView[] }) {
  if (!jobs.length) return <p className="text-xs text-muted-foreground">No jobs.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            {['Job', 'Status', 'Raised', 'Assigned', 'Accepted', 'On site', 'Done', 'On site for', 'Sign-off', 'Parts'].map((h) => (
              <th key={h} className="px-2 py-1 text-start font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-t border-border/60">
              <td className="px-2 py-1">
                <Link href={`/services/complaints/${j.id}`} className="font-mono text-brand hover:underline">{j.complaintNo}</Link>
                <CustomerLink id={j.customerId} className="ms-1 text-muted-foreground">{j.customerName}</CustomerLink>
                {j.reopenCount > 0 && <Badge tone="warning">reopened</Badge>}
              </td>
              <td className="px-2 py-1">{j.status.replace(/_/g, ' ')}</td>
              <td className="whitespace-nowrap px-2 py-1">{when(j.createdAt)}</td>
              <td className="whitespace-nowrap px-2 py-1">{when(j.assignedAt)}</td>
              <td className="whitespace-nowrap px-2 py-1">{when(j.acceptedAt)}</td>
              <td className="whitespace-nowrap px-2 py-1">{when(j.firstOnSiteAt)}</td>
              <td className="whitespace-nowrap px-2 py-1">{when(j.resolvedAt ?? j.closedAt)}</td>
              <td className="px-2 py-1">{j.timeOnSiteSec > 0 ? minutesLabel(Math.round(j.timeOnSiteSec / 60)) : '-'}</td>
              <td className="px-2 py-1">{j.signOff ? SIGN_OFF[j.signOff] ?? j.signOff : '-'}</td>
              <td className="px-2 py-1">{j.partsIssued || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
