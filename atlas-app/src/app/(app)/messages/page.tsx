import { requireContext } from '@/server/context';
import { listConversations, listOrgUsers } from '@/server/messages';
import { MessagesClient } from './MessagesClient';

export default async function MessagesPage() {
  const ctx = await requireContext();
  const [conversations, orgUsers] = await Promise.all([
    listConversations(ctx.organization.id, ctx.user.id),
    listOrgUsers(ctx.organization.id, ctx.user.id),
  ]);

  return (
    <MessagesClient
      conversations={conversations.map((c) => ({ ...c, lastAt: c.lastAt.toISOString() }))}
      orgUsers={orgUsers}
    />
  );
}
