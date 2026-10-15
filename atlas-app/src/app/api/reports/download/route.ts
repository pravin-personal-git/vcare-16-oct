import { requireContext } from '@/server/context';
import { findReport } from '@/server/report-catalogue';
import { BOM, fileName, toCsv } from '@/lib/csv';
import { buildXlsx, type XlsxCell } from '@/lib/xlsx';
import { istDayEnd, istDayStart, presetRange } from '@/lib/date-ranges';

/**
 * Download one report as Excel (.xlsx, the default) or CSV (`format=csv`).
 *
 * A ROUTE, NOT A SERVER ACTION - a server action returns data to JavaScript,
 * and what is wanted here is a file the browser saves. That needs real
 * `Content-Disposition` headers, which only a route can set.
 *
 * PERMISSION IS CHECKED HERE, NOT ONLY ON THE SCREEN.
 *
 * The screen hides reports somebody may not run, but a hidden button is not a
 * control - this URL can be typed. Each report declares the permission it
 * needs and this refuses without it, so hiding the card stays a courtesy
 * rather than the security.
 */
export async function GET(req: Request) {
  const ctx = await requireContext();
  const params = new URL(req.url).searchParams;

  const report = findReport(params.get('id') ?? '');
  if (!report) {
    return new Response('No such report.', { status: 404 });
  }

  if (!ctx.permissions.has(report.permission)) {
    return new Response('You do not have permission to run this report.', { status: 403 });
  }

  // Defaults to the current financial-ish month rather than all time - an
  // accidental download of every invoice ever is slow for the user and hard on
  // a pooled connection that allows one query at a time.
  const now = new Date();
  // India days (9 Oct 2026): from midnight India time on ?from= to the last
  // instant of ?to=, not the server's UTC days. A value that is not a real
  // day is a 400, as before, rather than a quiet default.
  const fromParam = params.get('from');
  const toParam = params.get('to');
  const from = fromParam ? istDayStart(fromParam) : presetRange('this_month', now).from;
  const to = toParam ? istDayEnd(toParam) : now;

  if (!from || !to) {
    return new Response('Those dates are not valid.', { status: 400 });
  }
  if (from > to) {
    return new Response('The start date is after the end date.', { status: 400 });
  }

  try {
    const { rows, columns } = await report.run(ctx.scope, from, to);
    const name = fileName(report.id, report.dated ? from : undefined, report.dated ? to : undefined);

    if (params.get('format') !== 'csv') {
      const toCell = (v: unknown): XlsxCell => (v instanceof Date ? v.toISOString().slice(0, 10) : (v as XlsxCell));
      const book = buildXlsx(
        report.name,
        columns.map((c) => c.header),
        (rows as never[]).map((r) => columns.map((c) => toCell(c.value(r)))),
      );
      return new Response(book as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${name.replace(/.csv$/, '.xlsx')}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const csv = BOM + toCsv(rows as never[], columns);

    return new Response(csv, {
      headers: {
        // `charset=utf-8` AND the BOM. Excel ignores the header and reads the
        // bytes, so without the mark every ₹ becomes mojibake.
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition':
          `attachment; filename="${name}"`,
        // A report is a snapshot of live data. Caching it would hand somebody
        // yesterday's figures with today's filename.
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[reports/download]', report.id, err);
    return new Response('The report could not be generated.', { status: 500 });
  }
}
