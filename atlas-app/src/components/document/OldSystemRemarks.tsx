import { requireContext } from '@/server/context';
import { legacyRemarksFor, type LegacyRemarkTable } from '@/server/legacy-remarks';
import { Badge, SectionCard } from '@/components/ui/Layout';

const fmt = (d: Date) => d.toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * "From the old system" on a challan, quotation, order or bill (29 Oct 2026):
 * every remark the old Vcare software held for this job, with the ones that
 * named this challan marked. Shows nothing for a document Atlas issued, and a
 * failure shows nothing rather than breaking the page, like DocumentActivity.
 */
export async function OldSystemRemarks({ table, rowId }: { table: LegacyRemarkTable; rowId: string }) {
  try {
    const ctx = await requireContext();
    const r = await legacyRemarksFor(ctx.scope, table, rowId);
    if (!r || r.total === 0) return null;
    const jobs = [...new Set(r.rows.map((x) => x.jobRef))].join(', ');
    const mine = r.rows.filter((x) => x.challanRef === r.docRef).length;
    return (
      <SectionCard title={`From the old system (${r.total})`} icon="clock" className="mt-3 print:hidden" bodyClassName="p-0">
        <p className="px-4 pt-3 text-xs text-muted-foreground">
          Remarks written in the old Vcare software on {jobs}{mine ? `; ${mine} of them about ${r.docRef}` : ''}. Oldest first.
          {r.total > r.rows.length ? ` Showing the first ${r.rows.length}.` : ''}
        </p>
        <ul className="divide-y divide-border">
          {r.rows.map((x) => (
            <li key={x.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {x.kind && <Badge tone="neutral">{x.kind}</Badge>}
                {x.challanRef === r.docRef && <Badge tone="info">This challan</Badge>}
                {x.challanRef && x.challanRef !== r.docRef && <span className="font-mono text-xs text-muted-foreground">{x.challanRef}</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{x.body}</p>
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{x.authorName ?? 'Unknown'} · {fmt(x.at)}</p>
            </li>
          ))}
        </ul>
      </SectionCard>
    );
  } catch {
    return null;
  }
}
