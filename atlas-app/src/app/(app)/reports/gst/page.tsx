import { requireContext } from '@/server/context';
import { gstReport } from '@/server/gst-report';
import { GstReportClient } from './GstReportClient';
import { istDayEnd, istDayStart, presetRange } from '@/lib/date-ranges';

export default async function GstReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();

  const now = new Date();
  // India days, not the server's UTC ones (9 Oct 2026): the month starts at
  // midnight India time, and ?to= runs to the end of that India day.
  const defaultFrom = presetRange('this_month', now).from!;
  const from = istDayStart(sp.from) ?? defaultFrom;
  const to = istDayEnd(sp.to) ?? now;

  const report = await gstReport(ctx.scope, from, to);

  return (
    <GstReportClient
      report={{
        ...report,
        from: report.from.toISOString(),
        to: report.to.toISOString(),
        sales: report.sales.map((r) => ({ ...r, date: r.date.toISOString() })),
        creditNotes: report.creditNotes.map((r) => ({ ...r, date: r.date.toISOString() })),
        purchases: report.purchases.map((r) => ({ ...r, date: r.date.toISOString() })),
      }}
    />
  );
}
