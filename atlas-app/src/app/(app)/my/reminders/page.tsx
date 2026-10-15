import { requireContext } from '@/server/context';
import { runRemindersForScope } from '@/server/reminders';
import { MyRemindersClient } from './MyRemindersClient';

/**
 * My Reminders & Requests (27 Sep 2026, NOTIFICATIONS-APPROVALS-SPEC.md §3):
 * what waits on me, my reminders, where my own requests are, and my
 * notification history. Everyone has it, filtered to them.
 */
export default async function MyRemindersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireContext();
  const { tab } = await searchParams;
  // Anything due is generated before the page reads it (throttled).
  await runRemindersForScope(ctx.scope).catch(() => undefined);
  return (
    <MyRemindersClient
      initialTab={tab ?? 'waiting'}
      isOwner={ctx.permissions.has('settings.edit')}
      singleStore={ctx.scope.kind === 'single'}
    />
  );
}
