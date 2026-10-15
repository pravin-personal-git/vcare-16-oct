'use client';

import { EmployeeLink } from '@/components/document/EmployeeLink';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge, Card, SectionCard } from '@/components/ui/Layout';
import { Toolbar, FilterChip } from '@/components/ui/Toolbar';
import { DataGrid, type Column } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { setServiceDepartmentsAction } from './actions';
import { DIRECTION_LABEL, formatDuration, formatNumber } from '@/lib/call-log';
import { useDebouncedSearch } from '@/components/ui/useListParams';
import { ServerExportButton } from '@/components/ui/ServerExportButton';
import type { ServerPaging } from '@/components/ui/DataGrid';

interface CallVM {
  id: string;
  userId: string;
  userName: string;
  rawNumber: string;
  e164Number: string;
  direction: string;
  startedAt: string;
  durationSec: number;
  matchedCrm: boolean;
  partyId: string | null;
  partyName: string | null;
}

const fmtTime = (d: string) =>
  new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

export function ServiceCallsClient({
  days, activeDept, departments, serviceDeptNames, serviceDeptIds, chosen, canConfigure, needsBranch = false, staff, calls,
  paging, totals,
}: {
  /** One server-side page (F1b). */
  paging: ServerPaging;
  /** Counted over every call in the period. */
  totals: { count: number; incoming: number; talk: number; customers: number };
  days: number;
  activeDept: string | null;
  departments: { id: string; name: string; code: string }[];
  serviceDeptNames: string[];
  serviceDeptIds: string[];
  /** The admin chose these departments (false = guessed from names). */
  chosen: boolean;
  canConfigure: boolean;
  /** Could configure, but All Company is selected - say so instead of hiding it. */
  needsBranch?: boolean;
  staff: { id: string; name: string; departmentName: string | null }[];
  calls: CallVM[];
}) {
  const router = useRouter();
  // Search runs on the server (F1b server paging).
  const { value: search, setValue: setSearch } = useDebouncedSearch('q');
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>(serviceDeptIds);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Totals come from the server, over every call in the period.

  const cards: KpiCard[] = [
    {
      key: 'calls', label: 'Service calls', count: totals.count,
      subLabel: `last ${days} days`, icon: 'phone', tone: 'brand',
    },
    {
      key: 'incoming', label: 'Incoming', count: totals.incoming,
      subLabel: 'customers calling in', icon: 'phone', tone: 'info',
    },
    {
      key: 'talk', label: 'Talk time', count: formatDuration(totals.talk),
      subLabel: `across ${staff.length} engineer${staff.length === 1 ? '' : 's'}`, icon: 'clock',
    },
    {
      key: 'customers', label: 'Customers reached', count: totals.customers,
      subLabel: 'matched to the CRM', icon: 'users', tone: 'success',
    },
  ];

  const columns: Column<CallVM>[] = [
    {
      key: 'when', header: 'When', sortValue: (c) => new Date(c.startedAt).getTime(),
      render: (c) => <span className="text-xs">{fmtTime(c.startedAt)}</span>,
    },
    {
      key: 'who', header: 'Engineer', sortValue: (c) => c.userName,
      render: (c) => <span className="font-medium"><EmployeeLink id={c.userId}>{c.userName}</EmployeeLink></span>,
    },
    {
      key: 'number', header: 'Number', sortValue: (c) => c.e164Number,
      render: (c) => (
        <span className="flex flex-col">
          <span className="font-mono text-xs">{formatNumber(c.e164Number)}</span>
          {c.partyId ? (
            <Link href={`/customers/${c.partyId}`} className="text-xs text-brand hover:underline">
              {c.partyName}
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">Not in CRM</span>
          )}
        </span>
      ),
    },
    {
      key: 'direction', header: 'Type', sortValue: (c) => c.direction,
      render: (c) => {
        const label = DIRECTION_LABEL[c.direction] ?? c.direction;
        if (c.direction === 'outgoing') return <Badge tone="info">{label}</Badge>;
        if (c.direction === 'incoming') return <Badge tone="success">{label}</Badge>;
        return <Badge tone="warning">{label}</Badge>;
      },
    },
    {
      key: 'duration', header: 'Duration', align: 'end', sortValue: (c) => c.durationSec,
      render: (c) => (
        c.durationSec > 0
          ? <span className="tabular-nums">{formatDuration(c.durationSec)}</span>
          : <span className="text-xs text-muted-foreground">Not connected</span>
      ),
    },
  ];

  const setDept = (id: string | null) => {
    const p = new URLSearchParams();
    p.set('days', String(days));
    if (id) p.set('dept', id);
    router.push(`/service?${p}`);
  };

  return (
    <>
      <PageHeader
        badge="SC"
        title="Service Team Calls"
        subtitle={
          staff.length > 0
            ? `${calls.length} calls · ${staff.length} engineer${staff.length === 1 ? '' : 's'} · last ${days} days`
            : 'No service staff configured yet'
        }
        actions={
          <Link href="/call-logs">
            <Button icon="phone">All call logs</Button>
          </Link>
        }
      />

      {staff.length === 0 && (
        <Card className="mb-3 flex items-start gap-2.5 border-warning/30 bg-warning/[0.06] px-3 py-2.5">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="flex-1 text-xs leading-relaxed">
            <strong>Nobody is assigned to a service department yet.</strong>
            <p className="mt-1">
              This screen shows calls made by staff whose department looks like service work -
              anything named Service, Support, Field, AMC, Maintenance or Technical. Set a
              department on your engineers under{' '}
              <Link href="/settings/users" className="font-medium text-brand hover:underline">
                Users
              </Link>
              , and their calls appear here automatically. Their phones are already reporting;
              nothing extra needs installing.
            </p>
            {needsBranch && (
              <p className="mt-1.5 font-medium">Or pick a branch in the top bar to choose which departments are the service team.</p>
            )}
          </div>
        </Card>
      )}

      <Toolbar
        filters={
          <>
            {[1, 7, 30].map((d) => (
              <FilterChip
                key={d} label={d === 1 ? 'Today' : `${d} days`}
                active={days === d}
                onClick={() => router.push(`/service?days=${d}${activeDept ? `&dept=${activeDept}` : ''}`)}
              />
            ))}
            <FilterChip
              label="Service teams" active={!activeDept} onClick={() => setDept(null)}
            />
            {departments.map((d) => (
              <FilterChip
                key={d.id} label={d.name}
                active={activeDept === d.id}
                onClick={() => setDept(activeDept === d.id ? null : d.id)}
              />
            ))}
          </>
        }
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search number, engineer, customer…"
        end={<ServerExportButton screen="calls" extra={{ team: 'service' }} />}
      />

      <div className="mb-3">
        <KpiStrip cards={cards} activeKey={null} onSelect={() => undefined} columns={4} />
      </div>

      {staff.length > 0 && (
        <SectionCard title="Who is counted" icon="users" className="mb-4">
          <p className="text-sm leading-relaxed">
            {staff.map((s) => s.name).join(', ')}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {activeDept
              ? 'Filtered to one department.'
              : chosen
                ? `The service team is ${serviceDeptNames.join(', ')}, as chosen for this branch.`
                : `Guessed from department names (${serviceDeptNames.join(', ') || 'none matched'}) - choose them to be sure.`}{' '}
            Change somebody&apos;s department under Users and this list follows.
          </p>
          {canConfigure && !picking && (
            <Button size="sm" variant="primary" icon="settings" className="mt-3" onClick={() => setPicking(true)}>
              Choose service departments
            </Button>
          )}
          {needsBranch && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs font-medium text-on-tint-warning">
              <Icon name="info" className="h-3.5 w-3.5" />
              Pick a branch in the top bar to choose which departments are the service team.
            </p>
          )}
        </SectionCard>
      )}

      {canConfigure && (picking || staff.length === 0) && (
        <SectionCard title="Which departments are the service team?" icon="settings" className="mb-4">
          <div className="flex flex-wrap gap-2">
            {departments.map((d) => {
              const on = picked.includes(d.id);
              return (
                <button key={d.id} type="button" aria-pressed={on}
                  onClick={() => setPicked((p) => (on ? p.filter((x) => x !== d.id) : [...p, d.id]))}
                  className={`rounded-full border px-3 py-1 text-xs transition ${on ? 'border-brand bg-brand/10 text-brand' : 'border-border hover:bg-muted'}`}>
                  {d.name}
                </button>
              );
            })}
            {departments.length === 0 && <p className="text-sm text-muted-foreground">No departments yet - add them under Settings → Masters.</p>}
          </div>
          {saveError && <p className="mt-2 text-xs text-danger">{saveError}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" disabled={saving}
              onClick={async () => {
                setSaving(true); setSaveError(null);
                const r = await setServiceDepartmentsAction(picked);
                setSaving(false);
                if (r.error) { setSaveError(r.error); return; }
                setPicking(false); router.refresh();
              }}
              className="h-8 rounded-lg bg-brand px-3 text-xs font-medium text-brand-fg disabled:opacity-50">
              Save
            </button>
            {picking && <button type="button" onClick={() => setPicking(false)} className="h-8 rounded-lg border border-border px-3 text-xs">Cancel</button>}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Also decides who appears in the technician lists on complaints and visits.</p>
        </SectionCard>
      )}

      <DataGrid
        rows={calls}
        server={paging}
        columns={columns}
        rowKey={(c) => c.id}
        emptyIcon="phone"
        emptyMessage={
          staff.length === 0 ? 'No service staff yet' : 'No service calls in this period'
        }
        emptyHint={
          staff.length > 0
            ? 'Calls appear here once a service engineer with a paired phone makes one.'
            : undefined
        }
      />

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        These are the same calls as the main Call Logs screen, narrowed to service staff. Nothing
        extra is captured and no second app is needed - the engineer&apos;s phone is already
        reporting, and the only thing that makes a call a &ldquo;service call&rdquo; is which team
        the person is on.
      </p>
    </>
  );
}
