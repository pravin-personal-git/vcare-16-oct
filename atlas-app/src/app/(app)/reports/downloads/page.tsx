import { requireContext } from '@/server/context';
import { REPORTS } from '@/server/report-catalogue';
import { DownloadsClient } from './DownloadsClient';

/**
 * The download centre.
 *
 * Everything the platform can export, in one place, with a date range and a
 * search box. Somebody who wants "last quarter's purchase bills for the
 * accountant" should not have to know which screen those live on.
 *
 * Reports the signed-in user may not run are filtered out here rather than
 * greyed out. A disabled row invites somebody to ask why, and the honest answer
 * - "your role does not allow it" - is a conversation for their manager, not a
 * tooltip.
 */
export default async function DownloadsPage() {
  const ctx = await requireContext();

  const allowed = REPORTS.filter((r) => ctx.permissions.has(r.permission));

  return (
    <DownloadsClient
      reports={allowed.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        category: r.category,
        dated: r.dated,
      }))}
      hiddenCount={REPORTS.length - allowed.length}
    />
  );
}
