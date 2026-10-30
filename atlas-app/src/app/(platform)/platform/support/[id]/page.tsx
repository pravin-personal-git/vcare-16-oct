import { notFound } from 'next/navigation';
import { requirePlatformContext } from '@/server/platform-context';
import { resolveBestOrgScope } from '@/server/platform-scope';
import { getSupportTicket } from '@/server/platform-support';
import { SupportTicketClient } from './SupportTicketClient';

/** One support ticket: the conversation, what the business was looking at, and the reply box. */
export default async function SupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePlatformContext();
  const scope = await resolveBestOrgScope(ctx.memberships);
  if (!scope) notFound();
  const { id } = await params;
  const t = await getSupportTicket(scope, id).catch(() => null);
  if (!t) notFound();
  return (
    <SupportTicketClient
      ticket={{
        ...t,
        createdAt: t.createdAt.toISOString(),
        context: Object.fromEntries(Object.entries(t.context ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)])),
        comments: t.comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
      }}
      canOpenBusiness={ctx.permissions.has('platformTenant.access')}
    />
  );
}
