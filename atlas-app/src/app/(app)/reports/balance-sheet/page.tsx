import { requireContext } from '@/server/context';
import { balanceSheet } from '@/server/balance-sheet';
import { BalanceSheetClient } from './BalanceSheetClient';
import { istDayEnd } from '@/lib/date-ranges';

/**
 * Where the business stands.
 *
 * Real as of 9 Sep 2026 - it could not have been earlier. Receivables needed
 * invoices, payables needed purchase bills, and stock needed something that
 * knew what stock cost. All three arrived in the last three days.
 */
export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  // The END of that India day, not 23:59 UTC (which is 05:29 the next morning
  // in India and let the next day's early entries in) - 9 Oct 2026.
  const asOf = istDayEnd(sp.asOf) ?? new Date();
  const sheet = await balanceSheet(ctx.scope, asOf);

  return (
    <BalanceSheetClient
      sheet={{
        ...sheet,
        asOf: sheet.asOf.toISOString(),
        openingAsOf: sheet.openingAsOf?.toISOString() ?? null,
      }}
      canEdit={ctx.permissions.has('accounts.edit')}
    />
  );
}
