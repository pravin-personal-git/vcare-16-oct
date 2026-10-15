import Link from 'next/link';
import { Card } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';

/**
 * A signpost to the Complaint GDNs page (30 Sep 2026).
 *
 * Moving a list people have learned to find is a small betrayal unless you
 * leave something behind saying where it went. This is that something, and it
 * carries the count so the answer to "are there any?" does not need the click.
 *
 * It sits ABOVE the search box rather than under the table (1 Oct 2026). Below
 * the paging it would be invisible the moment this register holds a few
 * hundred rows - which is exactly when somebody hunting a GDN needs it most.
 */
export function JobGdnPointer({ count }: { count: number }) {
  return (
    <Card className="mb-3 flex flex-wrap items-center gap-3 px-4 py-2.5">
      <Icon name="truck" className="h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="flex-1 text-sm text-muted-foreground">
        <strong className="text-foreground">Complaint GDNs</strong> - parts issued against a job -
        now have their own page, with search and filters.
        {count > 0 ? ` ${count} in this branch.` : ' None in this branch yet.'}
      </p>
      <Link
        href="/goods-dispatch/complaint-gdns"
        className="shrink-0 text-sm font-semibold text-brand hover:underline"
      >
        Open Complaint GDNs →
      </Link>
    </Card>
  );
}
