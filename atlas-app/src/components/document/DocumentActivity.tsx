import { requireContext } from '@/server/context';
import { listAuditEvents } from '@/server/audit-log';
import { ActivityPanel } from './ActivityPanel';

/**
 * Server half of the Activity section on a detail page (F1b, 6 Oct 2026).
 * `table` is the Prisma model name the audit trigger records ("Invoice").
 * A failure shows nothing rather than breaking the document.
 */
export async function DocumentActivity({ table, rowId }: { table: string; rowId: string }) {
  try {
    const ctx = await requireContext();
    const { rows, total } = await listAuditEvents(ctx.scope, ctx.stores.map((s) => s.id), { table, row: rowId }, 0, 20);
    return <ActivityPanel rows={rows} total={total} table={table} rowId={rowId} />;
  } catch {
    return null;
  }
}
