import { staff } from '@/server/auth/v1-staff';
import { technicianReport } from '@/server/technician-performance';
import { resolveRange } from '@/lib/date-ranges';
import type { PerfRow } from '@/lib/technician-performance';

/**
 * A technician's own work on the phone (F-02, 6 Oct 2026): this month and
 * last month, the same figures as Services › Technician Performance, for
 * nobody but the person asking.
 */
export async function GET(req: Request) {
  return staff(req, null, async (ctx) => {
    const storeIds = ctx.stores.map((s) => s.id);
    const mine = (uid: string) => uid === ctx.user.id;
    const month = async (preset: 'this_month' | 'last_month') => {
      const r = resolveRange({ range: preset }, preset);
      const { rows } = await technicianReport(ctx.scope, storeIds, r.from!, r.to!, mine, { withKm: preset === 'this_month' });
      const row: PerfRow | null = rows[0] ?? null;
      return { label: r.label, row };
    };
    const [thisMonth, lastMonth] = await Promise.all([month('this_month'), month('last_month')]);
    return { thisMonth, lastMonth };
  });
}
