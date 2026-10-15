import { requireContext } from '@/server/context';
import { listStaffAccounts } from '@/server/staff-accounts';
import { UserAccountClient } from './UserAccountClient';

/**
 * Staff Account - a read, like Customer Account and Supplier Account beside it.
 * Nothing is recorded here any more (9 Oct 2026); see the note on the client.
 */
export default async function UserAccountPage({ searchParams }: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { rows, cards } = await listStaffAccounts(ctx.scope);

  return (
    <UserAccountClient
      rows={rows}
      cards={cards}
      // `?q=` seeds the search box, so a global-search result lands on the
      // row rather than on the whole list with the number in the address bar.
      initialSearch={sp.q ?? ''}
    />
  );
}
