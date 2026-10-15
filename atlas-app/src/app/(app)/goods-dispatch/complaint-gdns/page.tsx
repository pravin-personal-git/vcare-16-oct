import { requireContext } from '@/server/context';
import { jobGdnList } from '@/server/job-challans';
import { PageHeader } from '@/components/ui/Layout';
import { ComplaintGdnsClient } from './ComplaintGdnsClient';

/**
 * Inventory > Goods Dispatch Note > Complaint GDNs.
 *
 * Deliberately NOT clipped to a financial year the way the sales register is.
 * Everything in the branch is loaded (capped in `jobGdnList`) and narrowed
 * with search and chips instead. A date range that hides documents by default
 * is what made a trail link to one GDN land on an empty section.
 */
export default async function ComplaintGdnsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const rows = await jobGdnList(ctx.scope);

  return (
    <>
      <PageHeader
        badge="GDN"
        title="Complaint GDNs"
        subtitle="Parts issued against a job - what left the store, what came back, and what was actually used"
      />
      <ComplaintGdnsClient
        rows={rows.map((r) => ({
          ...r,
          issuedAt: r.issuedAt.toISOString(),
          cancelledAt: r.cancelledAt?.toISOString() ?? null,
        }))}
        highlight={sp.gdn ?? null}
      />
    </>
  );
}
