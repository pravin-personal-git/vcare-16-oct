'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import { newestFirst, oldestFirst } from '@/lib/card-list';
import Link from 'next/link';
import { useState } from 'react';
import { JobGdnDocument } from './JobGdnDocument';
import { Badge, EmptyState, SectionCard } from '@/components/ui/Layout';
import { ListFilter } from '@/components/ui/ListFilter';

/**
 * Complaint GDNs - parts issued against a job, on their own page (30 Sep 2026).
 *
 * WHY THIS IS NOT A SECTION UNDER THE DISPATCH REGISTER ANY MORE.
 *
 * It used to be a second table stapled below the sales-dispatch grid, which
 * was wrong twice over. It looked bolted on, and it had none of what every
 * other list in the product got in F1b - no search, no filters, no saved
 * layout, no "Showing X of Y". Worse, it inherited the register's financial-
 * year range, so a document trail could link to a GDN and land on an empty
 * section filtered by a date range nobody chose.
 *
 * They are also genuinely different documents. A sales dispatch is keyed on
 * the ORDER and carries a courier, an AWB and a value; a complaint GDN is
 * keyed on its own GDN number and carries the parts issued, returned and
 * actually used. Merging them into one grid would have meant every row
 * showing blanks in half its columns.
 *
 * So: one page each, and navigation joins them - Goods Dispatch Note is now a
 * menu parent with both underneath it.
 */

export interface ComplaintGdnVM {
  id: string;
  gdnNo: string;
  issuedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  complaintId: string;
  complaintNo: string;
  customerId?: string | null;
  customerName: string;
  challanNo: string;
  type: string;
  issuedByName: string | null;
  lines: { productName: string; issued: number; returned: number; pending: number; used: number }[];
}

const when = (d: string) =>
  new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

const TYPE: Record<string, string> = {
  material: 'Material', replacement: 'Replacement', installation: 'Installation',
};

/** Cancelled is a status, not a type - but people filter for it the same way. */
const CANCELLED = 'cancelled';

export function ComplaintGdnsClient({ rows, highlight }: {
  rows: ComplaintGdnVM[];
  highlight: string | null;
}) {
  const [opening, setOpening] = useState<string | null>(null);
  const found = highlight ? rows.some((r) => r.gdnNo === highlight) : false;

  const chipOf = (r: ComplaintGdnVM) => (r.cancelledAt ? CANCELLED : r.type);
  const chipValues = [...new Set(rows.map(chipOf))].sort();

  return (
    <SectionCard
      title="Complaint GDNs"
      icon="truck"
      bodyClassName="p-0"
      action={<span className="text-xs text-muted-foreground">{rows.length} in this branch</span>}
    >
      {highlight && (
        <p className="border-b border-border bg-brand/5 px-4 py-2 text-xs">
          {found ? (
            <>Showing <span className="font-mono font-semibold">{highlight}</span> from the document trail - highlighted below.</>
          ) : (
            <>
              <span className="font-mono font-semibold">{highlight}</span> is not in this branch.
              Check the branch in the top bar.
            </>
          )}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon="truck"
          title="No complaint GDNs yet"
          hint="They are created when a job challan is approved or issued in Parts counter."
        />
      ) : (
        <ListFilter
          exportAs={{ title: 'Complaint GDNs', columns: [{ header: 'GDN', value: (r) => r.gdnNo }, { header: 'Issued', value: (r) => r.issuedAt ? r.issuedAt.slice(0, 10) : '' }, { header: 'Complaint', value: (r) => r.complaintNo }, { header: 'Customer', value: (r) => r.customerName }, { header: 'Challan', value: (r) => r.challanNo }, { header: 'Type', value: (r) => r.type }, { header: 'Issued by', value: (r) => r.issuedByName }, { header: 'Parts', value: (r) => r.lines.map((l) => `${l.productName} x${l.issued}`).join('; ') }, { header: 'Cancelled', value: (r) => r.cancelledAt ? r.cancelledAt.slice(0, 10) : '' }] }}
          rows={rows}
          // Date filter and sort, newest first (9 Oct 2026).
          dates={[{ key: 'issued', label: 'Issued on', of: (r) => r.issuedAt }]}
          sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.issuedAt) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.issuedAt) }]}
          noun="GDNs"
          placeholder="GDN number, job, customer, challan, part…"
          searchOn={(r) => [
            r.gdnNo, r.complaintNo, r.customerName, r.challanNo,
            TYPE[r.type] ?? r.type,
            ...r.lines.map((l) => l.productName),
          ]}
          chipLabel="Type"
          chipOf={chipOf}
          chips={chipValues.map((v) => ({
            value: v,
            label: v === CANCELLED ? 'Cancelled' : TYPE[v] ?? v,
            count: rows.filter((r) => chipOf(r) === v).length,
          }))}
        >
          {(shown) => (
            shown.length === 0 ? (
              <EmptyState
                icon="search"
                title="Nothing matches"
                hint="Clear the search or the type filter to see every complaint GDN."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-start text-micro uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 text-start font-medium">GDN</th>
                      <th className="px-4 py-2 text-start font-medium">Job</th>
                      <th className="px-4 py-2 text-start font-medium">Customer</th>
                      <th className="px-4 py-2 text-start font-medium">Parts (issued · returned · used)</th>
                      <th className="px-4 py-2 text-start font-medium">Issued</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr
                        key={r.id}
                        id={`gdn-${r.gdnNo}`}
                        className={`border-b border-border align-top last:border-0 ${
                          r.gdnNo === highlight ? 'bg-brand/10 ring-2 ring-inset ring-brand' : ''
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          {/*
                            The number opens the note itself. Until now this was
                            plain text on a row and a job GDN had no document at
                            all, while the sales GDN next door has always been
                            printable - same goods, same warehouse, two standards
                            of paperwork.
                          */}
                          <button
                            type="button"
                            onClick={() => setOpening(r.id)}
                            className={`font-mono font-semibold hover:underline ${
                              r.cancelledAt ? 'text-muted-foreground line-through' : 'text-brand'
                            }`}
                            title="Open the dispatch note"
                          >
                            {r.gdnNo}
                          </button>
                          <span className="block text-xs text-muted-foreground">
                            {TYPE[r.type] ?? r.type} · {r.challanNo}
                          </span>
                          {r.cancelledAt && (
                            <Badge tone="danger">Cancelled{r.cancelReason ? `: ${r.cancelReason}` : ''}</Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <Link href={`/services/complaints/${r.complaintId}`} className="font-mono text-brand hover:underline">
                            {r.complaintNo}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5"><CustomerLink id={r.customerId}>{r.customerName}</CustomerLink></td>
                        <td className="px-4 py-2.5">
                          {r.lines.map((l, i) => (
                            <span key={i} className="block">
                              {l.productName}:{' '}
                              <span className="tabular-nums">
                                {l.issued} · {l.returned}{l.pending ? ` (+${l.pending} coming)` : ''} · <strong>{l.used}</strong>
                              </span>
                            </span>
                          ))}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          {when(r.issuedAt)}
                          {r.issuedByName ? <span className="block text-xs text-muted-foreground">{r.issuedByName}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </ListFilter>
      )}
    {opening && <JobGdnDocument id={opening} onClose={() => setOpening(null)} />}
    </SectionCard>
  );
}
