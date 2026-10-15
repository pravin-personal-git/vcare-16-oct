'use client';

import Link from 'next/link';
import { Badge, PageHeader, SectionCard } from '@/components/ui/Layout';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Icon, type IconName } from '@/components/ui/Icon';

interface HrmDashboard {
  headcount: number;
  latestRun: { id: string; label: string; status: string; periodEnd: string } | null;
  approvals: { entityType: string; label: string; count: number }[];
  approvalsTotal: number;
  helpdesk: { open: number; inProgress: number; unassigned: number };
  assets: { total: number; assigned: number; pendingRequests: number };
}

const RUN_STATUS_TONE = { draft: 'neutral', processed: 'info', paid: 'success' } as const;

const QUICK_LINKS: { label: string; route: string; icon: IconName; hint: string }[] = [
  { label: 'Payroll Dashboard', route: '/hrm/payroll', icon: 'receipt', hint: 'Runs, payslips' },
  { label: 'Contracts', route: '/hrm/payroll/contracts', icon: 'file-text', hint: 'Salary structures' },
  { label: 'Team Setup', route: '/hierarchy/team-setup', icon: 'user-plus', hint: 'Reporting lines, designations' },
  { label: 'Attendance Settings', route: '/settings/attendance', icon: 'settings', hint: 'Leave types, shift rules' },
  { label: 'Asset Management', route: '/assets', icon: 'box', hint: 'Company assets' },
  { label: 'Helpdesk', route: '/helpdesk', icon: 'alert-circle', hint: 'Employee tickets' },
  { label: 'Recruitment', route: '/hrm/recruitment', icon: 'user-plus', hint: 'Openings, candidates' },
  { label: 'Onboarding', route: '/hrm/onboarding', icon: 'user-plus', hint: 'New joiner checklists' },
  { label: 'Offboarding', route: '/hrm/offboarding', icon: 'user', hint: 'Resignations, exit checklists' },
];

export function HrmDashboardClient({ dashboard }: { dashboard: HrmDashboard }) {
  const kpis: KpiCard[] = [
    { key: 'headcount', label: 'Headcount', count: dashboard.headcount, icon: 'users' },
    {
      key: 'approvals', label: 'Awaiting Approval', count: dashboard.approvalsTotal, icon: 'clock',
      tone: dashboard.approvalsTotal > 0 ? 'warning' : 'default',
    },
    {
      key: 'helpdesk', label: 'Open Tickets', count: dashboard.helpdesk.open + dashboard.helpdesk.inProgress, icon: 'alert-circle',
      tone: dashboard.helpdesk.unassigned > 0 ? 'danger' : 'default',
    },
    { key: 'assets', label: 'Assets Assigned', count: `${dashboard.assets.assigned}/${dashboard.assets.total}`, icon: 'box' },
  ];

  return (
    <div>
      <PageHeader badge="HR" title="HRM Homescreen" subtitle="Payroll, approvals and the rest of the People function, in one place" />

      <KpiStrip cards={kpis} activeKey={null} onSelect={() => {}} columns={4} />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Latest payroll run" icon="receipt" bodyClassName="p-4">
          {dashboard.latestRun ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{dashboard.latestRun.label}</p>
                <p className="text-xs text-muted-foreground">
                  Period ends {new Date(dashboard.latestRun.periodEnd).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={RUN_STATUS_TONE[dashboard.latestRun.status as keyof typeof RUN_STATUS_TONE] ?? 'neutral'}>
                  {dashboard.latestRun.status}
                </Badge>
                <Link href={`/hrm/payroll/${dashboard.latestRun.id}`} className="text-sm font-medium text-brand hover:underline">
                  View
                </Link>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No payroll run yet. <Link href="/hrm/payroll" className="font-medium text-brand hover:underline">Generate the current period</Link>
            </p>
          )}
        </SectionCard>

        <SectionCard title="Waiting on someone's decision" icon="clock" bodyClassName="p-0">
          {dashboard.approvalsTotal === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nothing waiting - every leave, WFH, comp-off and asset request has been decided.</p>
          ) : (
            <div className="divide-y divide-border">
              {dashboard.approvals.filter((a) => a.count > 0).map((a) => (
                <Link
                  key={a.entityType}
                  href={a.entityType === 'asset_request' ? '/assets' : '/attendance/grid'}
                  className="flex items-center justify-between px-4 py-2.5 text-sm transition hover:bg-muted/40"
                >
                  <span>{a.label}</span>
                  <Badge tone="warning">{a.count}</Badge>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Helpdesk" icon="alert-circle" bodyClassName="p-4">
          <div className="flex items-center justify-between text-sm">
            <span>{dashboard.helpdesk.open} open · {dashboard.helpdesk.inProgress} in progress</span>
            {dashboard.helpdesk.unassigned > 0 && <Badge tone="danger">{dashboard.helpdesk.unassigned} unassigned</Badge>}
          </div>
          <Link href="/helpdesk" className="mt-2 inline-block text-sm font-medium text-brand hover:underline">Open the queue</Link>
        </SectionCard>

        <SectionCard title="Assets" icon="box" bodyClassName="p-4">
          <div className="flex items-center justify-between text-sm">
            <span>{dashboard.assets.assigned} of {dashboard.assets.total} assigned</span>
            {dashboard.assets.pendingRequests > 0 && <Badge tone="warning">{dashboard.assets.pendingRequests} pending</Badge>}
          </div>
          <Link href="/assets" className="mt-2 inline-block text-sm font-medium text-brand hover:underline">Manage assets</Link>
        </SectionCard>
      </div>

      <SectionCard title="Jump to" icon="chevron-right" className="mt-4" bodyClassName="p-0">
        <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-3">
          {QUICK_LINKS.map((l) => (
            <Link key={l.route} href={l.route} className="flex items-center gap-3 px-4 py-3 transition hover:bg-muted/40">
              <Icon name={l.icon} className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">{l.label}</span>
                <span className="block text-xs text-muted-foreground">{l.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
