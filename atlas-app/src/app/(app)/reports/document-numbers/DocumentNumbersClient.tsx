'use client';

import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader, SectionCard } from '@/components/ui/Layout';
import { formatFinancialYear } from '@/lib/financial-year';
import type { DocumentNumberReport } from '@/server/document-number-report';

/**
 * "Where is invoice 0008?" (3 Oct 2026).
 *
 * TWO AUDIENCES, ONE PAGE. An owner wants one number: are any statutory series
 * broken. An auditor wants the detail: which number, when it was issued, by
 * whom, and what happened. So the page opens with the one figure and then lists
 * every gap underneath it, rather than being a grid somebody has to interpret.
 *
 * Statutory series come first because those are the ones a notice arrives about.
 * A gap in complaint numbering is untidy; a gap in invoice numbering is a
 * question from the tax authority.
 */

type Row = DocumentNumberReport['series'][number];
type Gap = Omit<Row['gaps'][number], 'allocatedAt'> & { allocatedAt: string | null };
type SeriesVM = Omit<Row, 'gaps'> & { gaps: Gap[] };

interface Props {
  report: Omit<DocumentNumberReport, 'series' | 'ledgerFrom'> & {
    series: SeriesVM[];
    ledgerFrom: string | null;
  };
  thisYear: number;
  scopeIsAll: boolean;
}

const when = (iso: string | null) =>
  (iso
    ? new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
    : null);

const onlyDate = (iso: string | null) =>
  (iso
    ? new Date(iso).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
    })
    : null);

export function DocumentNumbersClient({ report, thisYear, scopeIsAll }: Props) {
  const { series, statutoryGaps, totalGaps, financialYear, ledgerFrom } = report;
  const years = [thisYear, thisYear - 1, thisYear - 2];

  return (
    <>
      <PageHeader
        badge="NUM"
        title="Document numbers"
        subtitle="Every numbered series, and any number that was issued but never used"
        actions={
          <div className="flex items-center gap-1">
            {years.map((y) => (
              <Link
                key={y}
                href={`/reports/document-numbers?fy=${y}`}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                  y === financialYear
                    ? 'border-brand bg-brand/10 text-on-tint-brand'
                    : 'border-border text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {formatFinancialYear(y)}
              </Link>
            ))}
          </div>
        }
      />

      {scopeIsAll ? (
        <EmptyState
          icon="building"
          title="Pick a single branch"
          hint="A series belongs to one branch - its branch code is part of the number - so two branches' sequences cannot be read together without every number of one looking like a gap in the other."
        />
      ) : (
        <>
          <div className="mb-4 grid gap-2 sm:grid-cols-3">
            <Tile
              label="Gaps in statutory series"
              value={String(statutoryGaps)}
              tone={statutoryGaps > 0 ? 'danger' : 'success'}
              hint="invoices, credit notes, refunds, bills, journal entries"
            />
            <Tile
              label="Gaps in every series"
              value={String(totalGaps)}
              tone={totalGaps > 0 ? 'warning' : 'success'}
              hint={`${series.length} series in use this year`}
            />
            <Tile
              label="Records start"
              value={onlyDate(ledgerFrom) ?? 'Not yet'}
              tone="neutral"
              hint="gaps before this date cannot name who issued the number"
            />
          </div>

          <Card className="mb-4 p-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              A number is reserved the moment somebody starts a document and the document is saved a
              moment later. If that save fails &mdash; a locked accounting period, a dropped
              connection &mdash; the number has been used up without a document against it, and the
              series shows a gap. Atlas now <strong className="text-foreground">hands an unused
              number out again</strong> rather than skipping it, so new gaps should be rare. Anything
              listed below was either issued before that change or failed twice.
            </p>
          </Card>

          {series.length === 0 ? (
            <EmptyState
              icon="file-text"
              title={`Nothing numbered in ${formatFinancialYear(financialYear)}`}
              hint="No document has been raised in this branch for that financial year."
            />
          ) : (
            <div className="grid gap-3">
              {series.map((s) => <Series key={s.docType} s={s} />)}
            </div>
          )}
        </>
      )}
    </>
  );
}

function Series({ s }: { s: SeriesVM }) {
  const clean = s.gaps.length === 0 && !s.unreconcilable;

  return (
    <SectionCard
      title={`${s.label} · ${s.docType}`}
      icon={clean ? 'check-circle' : 'alert-triangle'}
      bodyClassName="p-0"
      action={
        <span className="flex items-center gap-1.5">
          {s.statutory && (
            <Badge tone="info" title="A gap here is a question from the tax authority, not from a colleague">
              statutory
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {s.inUse} of {s.lastSequence} issued
          </span>
        </span>
      }
    >
      {s.unreconcilable ? (
        <p className="p-4 text-sm text-warning">
          {/*
            Said rather than shown as zero gaps. A series whose numbers are not
            stored on any row cannot be checked at all, and reporting it as clean
            would be a false clean bill of health.
          */}
          These numbers are not recorded on any row, so nothing about this series can be checked.
          Numbers issued here are never handed out again, because &ldquo;no document holds it&rdquo;
          cannot be told apart from &ldquo;nothing stores it&rdquo;.
        </p>
      ) : clean ? (
        <p className="p-4 text-sm text-success">
          Unbroken: every number from 1 to {s.lastSequence} is on a document.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-sm">
            <thead className="border-b border-border bg-muted/40 text-micro uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-start font-medium">Missing number</th>
                <th className="px-4 py-2 text-start font-medium">Reserved</th>
                <th className="px-4 py-2 text-start font-medium">By</th>
                <th className="px-4 py-2 text-start font-medium">What happened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {s.gaps.map((g) => (
                <tr key={g.sequence}>
                  <td className="px-4 py-2 font-mono font-semibold">{g.number}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">
                    {when(g.allocatedAt) ?? 'Before we kept records'}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {g.allocatedByName ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {g.allocatedAt === null ? (
                      <span className="text-muted-foreground">
                        Issued before Atlas started recording this. The document was never saved,
                        or was deleted before deletions were kept.
                      </span>
                    ) : g.reissued ? (
                      <span className="text-warning">
                        Reserved, unused, offered again &mdash; and the second attempt failed too.
                      </span>
                    ) : (
                      <span className="text-warning">
                        Reserved and never used. The document was not saved.
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function Tile({ label, value, tone, hint }: {
  label: string; value: string; tone: 'danger' | 'warning' | 'success' | 'neutral'; hint: string;
}) {
  const colour = {
    danger: 'text-danger', warning: 'text-warning',
    success: 'text-success', neutral: 'text-foreground',
  }[tone];
  return (
    <Card className="p-3">
      <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${colour}`}>{value}</p>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p>
    </Card>
  );
}
