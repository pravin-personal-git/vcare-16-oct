import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { guardPersonPage } from '@/server/people-reach';
import { canOpenRoute } from '@/lib/route-access';
import { employeeView } from '@/server/employee-view';
import { SectionCard, SummaryRow } from '@/components/ui/Layout';
import { DetailHeader } from '@/components/document/DetailHeader';
import { CustomerLink } from '@/components/document/CustomerLink';
import { formatCurrency } from '@/lib/format';
import { scorecardFor } from '@/server/scorecard';
import { Scorecard } from '@/components/people/Scorecard';
import { PERIODS, type PeriodKey } from '@/lib/scorecard/period';

/**
 * ONE EMPLOYEE (G-37, 10 Oct 2026). A person's name - on a job, a payslip,
 * the team lists - opens this page. Read-only; editing a person stays in
 * Settings > Employees and the HRM screens.
 */
const fmtDate = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const words = (s: string) => s.replace(/_/g, ' ');

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ period?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const period: PeriodKey = sp.period && sp.period in PERIODS ? (sp.period as PeriodKey) : 'month';
  const ctx = await requireContext();
  const storeIds = ctx.scope.kind === 'single' ? [ctx.scope.storeId] : ctx.stores.map((s) => s.id);
  const e = await employeeView(storeIds, id, { canSeePay: canOpenRoute('/hrm/payroll', ctx.permissions) });
  if (!e) notFound();
  // Whose attendance and leave this person sees (B4 step 4).
  await guardPersonPage(ctx, id, `/hrm/employees/${id}`);
  const row = 'flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted';
  // The scorecard (31 Oct 2026): a failure there must not take the person's page down with it.
  const scorecard = await scorecardFor(ctx.scope, storeIds, storeIds[0] ?? '', id, period).catch((err) => {
    console.error('[scorecard] failed', err);
    return null;
  });
  const a = e.attendance;

  return (
    <div>
      <DetailHeader
        icon="user"
        kind="Employee"
        number={e.fullName}
        status={e.isActive ? { label: 'Active', tone: 'success' } : { label: 'Inactive', tone: 'neutral' }}
        facts={[
          { label: 'Code', value: e.userCode },
          { label: 'Department', value: e.department },
          { label: 'Role', value: e.roles.map((r) => (e.roles.length > 1 ? `${r.role} (${r.store})` : r.role)).join(', ') },
          { label: 'Joined', value: e.profile?.dateOfJoining ? fmtDate(e.profile.dateOfJoining) : null },
        ]}
        backHref="/settings/employees"
        backLabel="Employees"
      />

      {scorecard && <div className="mb-4"><Scorecard view={scorecard} canManage={ctx.permissions.has('hrm.edit') && id !== ctx.user.id} basePath={`/hrm/employees/${id}`} /></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          <SectionCard title={a ? `Attendance this month · ${a.branch}` : 'Attendance this month'} icon="calendar">
            {!a ? <p className="text-sm text-muted-foreground">No attendance found for this month.</p> : (
              <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
                {([
                  ['Present', a.present], ['Half day', a.halfDay], ['Absent', a.absent],
                  ['Leave', a.leave], ['Holiday', a.holiday], ['Week off', a.weekOff],
                ] as const).map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-muted/40 px-2 py-2">
                    <p className="text-lg font-semibold tabular-nums">{v}</p>
                    <p className="text-xs text-muted-foreground">{k}</p>
                  </div>
                ))}
              </div>
            )}
            <Link href={`/attendance/grid`} className="mt-2 inline-block text-xs font-medium text-brand hover:underline">Open the attendance grid</Link>
          </SectionCard>

          <SectionCard title={`Jobs assigned (${e.jobs.length}, ${e.openJobs} open)`} icon="wrench" bodyClassName="p-2">
            {e.jobs.length === 0 ? <p className="px-2 py-1 text-sm text-muted-foreground">No jobs assigned.</p> : (
              <div className="max-h-96 overflow-y-auto thin-scroll">
                {e.jobs.map((j) => (
                  <div key={j.id} className={row}>
                    <span className="min-w-0">
                      <Link href={`/services/complaints/${j.id}`} className="font-mono text-brand hover:underline">{j.complaintNo}</Link>
                      <CustomerLink id={j.customerId} className="ms-2 text-xs text-muted-foreground">{j.customerName}</CustomerLink>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(j.createdAt)} · {words(j.status)}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title={`Leave (${e.leave.length})`} icon="calendar" bodyClassName="p-2">
            {e.leave.length === 0 ? <p className="px-2 py-1 text-sm text-muted-foreground">No leave requests.</p> : (
              <div className="max-h-96 overflow-y-auto thin-scroll">
                {e.leave.map((l) => (
                  <div key={l.id} className={row}>
                    <span>{l.typeName ?? words(l.kind)}<span className="ms-2 text-xs text-muted-foreground">{fmtDate(l.fromDate)}{+l.toDate !== +l.fromDate ? ` to ${fmtDate(l.toDate)}` : ''}</span></span>
                    <span className={`text-xs ${l.status === 'approved' ? 'text-success' : l.status === 'rejected' ? 'text-danger' : 'text-warning'}`}>{words(l.status)}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <div className="grid content-start gap-4">
          <SectionCard title="Details" icon="info">
            {e.phone && <SummaryRow label="Phone" value={e.phone} />}
            {e.email && <SummaryRow label="Email" value={e.email} />}
            {e.manager && <SummaryRow label="Reports to" value={<Link href={`/hrm/employees/${e.manager.id}`} className="text-brand hover:underline">{e.manager.fullName}</Link>} />}
            {e.profile?.employmentType && <SummaryRow label="Type" value={words(e.profile.employmentType)} />}
            {e.profile?.confirmedAt && <SummaryRow label="Confirmed" value={fmtDate(e.profile.confirmedAt)} />}
            {e.profile?.exitDate && <SummaryRow label="Left" value={`${fmtDate(e.profile.exitDate)}${e.profile.exitReason ? ` · ${e.profile.exitReason}` : ''}`} />}
            <SummaryRow label="Last signed in" value={fmtDate(e.lastLoginAt)} />
          </SectionCard>
          {e.canSeePay && <SectionCard title={`Payslips (${e.payslips.length})`} icon="receipt" bodyClassName="p-2">
            {e.payslips.length === 0 ? <p className="px-2 py-1 text-sm text-muted-foreground">No payslips yet.</p> : (
              <div className="max-h-96 overflow-y-auto thin-scroll">
                {e.payslips.map((p) => (
                  <Link key={p.id} href={`/hrm/payroll/${p.payrollRunId}/payslip/${p.id}`} className={row}>
                    <span>{p.payrollRun.label}<span className="ms-2 text-xs text-muted-foreground">{words(p.payrollRun.status)}</span></span>
                    <span className="font-mono text-xs">{formatCurrency(p.netPaise)}</span>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>}
        </div>
      </div>
    </div>
  );
}
