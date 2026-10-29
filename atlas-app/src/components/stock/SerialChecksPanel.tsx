import Link from 'next/link';
import { SerialLink } from '@/components/document/SerialLink';
import type { SerialCheckRow } from '@/server/serial-links';

/**
 * Serial checks on Stock → Checks (29 Oct 2026): every place a serial is
 * still unknown or its records disagree, each row opening its document.
 * Empty groups are not shown; nothing waiting says so in one line.
 */
export function SerialChecksPanel({ notNamed, astray, picked, pickedTotal, capped }: { notNamed: SerialCheckRow[]; astray: SerialCheckRow[]; picked: SerialCheckRow[]; pickedTotal: number; capped: boolean }) {
  const groups = [
    { title: 'Sent on a job with no serial', hint: 'Open the job and use Add serial on the line.', rows: notNamed },
    { title: 'Serial records that disagree', hint: 'The job names the serial, but the unit or its bill says otherwise.', rows: astray },
    { title: `Picked by Atlas, not checked${pickedTotal > picked.length ? ` (${picked.length} of ${pickedTotal})` : ''}`, hint: 'Atlas chose the oldest on the shelf. Open the document and Confirm or Change.', rows: picked },
  ].filter((g) => g.rows.length);
  return (
    <section aria-label="Serial checks" className="mt-4 grid gap-3 rounded-lg border border-border bg-card p-4 text-sm">
      <h2 className="text-base font-semibold">Serial checks</h2>
      {capped && <p className="text-xs text-warning">Only the most recent records were checked - clear these and open again for the rest.</p>}
      {!groups.length && !capped && <p className="text-muted-foreground">Every serial out with a customer or supplier is named, checked and agrees with its document.</p>}
      {groups.map((g) => (
        <div key={g.title} className="grid gap-1.5">
          <h3 className="font-medium">{g.title} <span className="tabular-nums text-muted-foreground">· {g.rows.length}</span></h3>
          <p className="text-xs text-muted-foreground">{g.hint}</p>
          <ul className="grid max-h-80 gap-1 overflow-y-auto">
            {g.rows.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border/60 py-1 last:border-0">
                {r.serialNo && <SerialLink serialNo={r.serialNo} unitId={r.unitId} />}
                <span>{r.productName}</span>
                <span className="text-xs text-warning">{r.problem}</span>
                {r.docNo && (r.href
                  ? <Link href={r.href} className="ms-auto font-mono text-xs text-brand hover:underline">{r.docNo}</Link>
                  : <span className="ms-auto font-mono text-xs">{r.docNo}</span>)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
