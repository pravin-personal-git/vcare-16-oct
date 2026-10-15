import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { userInScope } from '@/server/store-scope';
import { travelMonth, fuelMonth, unattributedFuelPaise } from '@/server/travel-allowance';
import { monthKey } from '@/lib/travel-allowance';
import { Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { TravelClient } from './TravelClient';

/**
 * Travel Allowance (F-03, 6 Oct 2026) - HRM › Payroll. Rate per km by
 * vehicle, km from the location trail or between job sites, daily and
 * monthly caps; a month becomes travel claims through the normal
 * reimbursement approval, paid from Payroll › Claims.
 */
export default async function TravelPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireContext();
  if (ctx.scope.kind === 'all') {
    return (
      <div>
        <PageHeader badge="TA" title="Travel Allowance" subtitle="Fuel and travel money from km" />
        <Card><EmptyState icon="building" title="Choose a branch first" hint="Rates and claims are kept per branch." /></Card>
      </div>
    );
  }
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month! : monthKey(new Date());
  const [{ settings, rows }, fuel, unattributedPaise, staff] = await Promise.all([
    travelMonth(ctx.scope, ctx.scope.storeId, month),
    fuelMonth(ctx.scope, ctx.scope.storeId, month),
    unattributedFuelPaise(ctx.scope, month),
    db.user.findMany({
      where: { ...userInScope(ctx.scope), isActive: true },
      select: { id: true, fullName: true }, orderBy: { fullName: 'asc' },
    }),
  ]);

  return (
    <TravelClient
      month={month}
      settings={settings}
      rows={rows}
      fuel={{
        rows: fuel.rows, givenTotalPaise: fuel.givenTotalPaise,
        expectedTotalPaise: fuel.expectedTotalPaise, unattributedPaise,
      }}
      staff={staff.map((u) => ({ id: u.id, name: u.fullName }))}
      canManage={ctx.permissions.has('payroll.process')}
    />
  );
}
