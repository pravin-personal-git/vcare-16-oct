import Link from 'next/link';
import { requirePlatformContext } from '@/server/platform-context';
import { resolveBestOrgScope } from '@/server/platform-scope';
import { listSupportTickets } from '@/server/platform-support';
import type { TicketStatus } from '@/server/helpdesk';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/Layout';

/**
 * SUPPORT (30 Oct 2026): every helpdesk ticket a business sent to the
 * software's support team, newest first; the ones waiting on us on top.
 */
const STATUS: Record<TicketStatus, { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' }> = {
  open: { label: 'Open', tone: 'info' },
  in_progress: { label: 'Working', tone: 'warning' },
  resolved: { label: 'Solved', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
};
const FILTERS: [string, string][] = [['', 'All'], ['open', 'Open'], ['in_progress', 'Working'], ['resolved', 'Solved'], ['closed', 'Closed']];

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requirePlatformContext();
  const scope = await resolveBestOrgScope(ctx.memberships);
  const { status } = await searchParams;
  const filter = status && status in STATUS ? (status as TicketStatus) : undefined;
  const tickets = scope ? await listSupportTickets(scope, { status: filter }) : [];
  const sorted = [...tickets].sort((a, b) => Number(b.waitingOnUs) - Number(a.waitingOnUs) || +b.lastAt - +a.lastAt);
  const waiting = tickets.filter((t) => t.waitingOnUs).length;

  return (
    <div>
      <PageHeader badge="SP" title="Support" subtitle={`Tickets businesses sent to the software team${waiting ? ` · ${waiting} waiting for an answer` : ''}`} />
      <nav aria-label="Filter by status" className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map(([k, l]) => (
          <Link key={k} href={k ? `/platform/support?status=${k}` : '/platform/support'} aria-current={(filter ?? '') === k ? 'page' : undefined}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${(filter ?? '') === k ? 'bg-foreground text-background' : 'bg-card hover:bg-muted'}`}>{l}</Link>
        ))}
      </nav>
      <Card>
        {sorted.length === 0 ? (
          <EmptyState icon="mail" title="No tickets here" hint="When a business sends a helpdesk ticket to software support, it shows up here." />
        ) : (
          <ul className="divide-y divide-border">
            {sorted.map((t) => (
              <li key={t.id}>
                <Link href={`/platform/support/${t.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-3 transition hover:bg-muted/40">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${t.waitingOnUs ? 'bg-danger' : 'bg-transparent'}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{t.subject}</span>
                    <span className="block truncate text-xs text-muted-foreground">{t.businessName} · {t.branchName} · {t.raisedByName} · {t.ticketNo}</span>
                  </span>
                  {t.waitingOnUs && <Badge tone="danger">Waiting on us</Badge>}
                  {t.priority !== 'normal' && <Badge tone={t.priority === 'urgent' || t.priority === 'high' ? 'warning' : 'neutral'}>{t.priority}</Badge>}
                  <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                  <span className="w-28 text-end text-xs text-muted-foreground tabular-nums">{t.lastAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
