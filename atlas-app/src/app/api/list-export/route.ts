import { requireContext } from '@/server/context';
import { LIST_EXPORTS } from '@/server/list-exports';
import { canOpenRoute } from '@/lib/route-access';
import { canExportLists } from '@/lib/levels';
import { configFor } from '@/server/config';
import { BOM, toCsv } from '@/lib/csv';
import { buildXlsx, type XlsxCell } from '@/lib/xlsx';
import { istDate } from '@/lib/date-ranges';

/**
 * Export a list screen as Excel (default) or CSV, with the screen's own filters
 * (F1 UI standard). /api/list-export?screen=complaints&<the list's filters>
 *
 * A route rather than a server action because the browser has to receive a
 * file with Content-Disposition headers.
 *
 * Checked here, not only by hiding the button: office/admin level (decision
 * Q1), AND the screen's own route permission, AND the branch scope inside the
 * screen's loader.
 */
const MAX_ROWS = 50_000;

export async function GET(req: Request) {
  const ctx = await requireContext();
  const params = new URL(req.url).searchParams;
  const spec = LIST_EXPORTS[params.get('screen') ?? ''];
  if (!spec) return new Response('No such list.', { status: 404 });

  if (!canExportLists(ctx.permissions) || !canOpenRoute(spec.route, ctx.permissions)) {
    return new Response('You do not have permission to export this list.', { status: 403 });
  }

  // Some businesses want their data to stay in the system (web.export, F1a).
  // Checked here for the same reason as the permission above: hiding the button
  // does not stop somebody typing the URL.
  if (!(await configFor(ctx)).on('web.export')) {
    return new Response('Exporting lists is switched off for this business.', { status: 403 });
  }

  const sp = Object.fromEntries(params.entries());
  try {
    const { rows, columns, rangeLabel } = await spec.load(ctx, sp);
    if (rows.length > MAX_ROWS) {
      return new Response(`That is ${rows.length.toLocaleString('en-IN')} rows - narrow the filters to under ${MAX_ROWS.toLocaleString('en-IN')}.`, { status: 413 });
    }
    const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const base = [safe(spec.title), rangeLabel && safe(rangeLabel), istDate(new Date())].filter(Boolean).join('_');

    if (params.get('format') === 'csv') {
      return new Response(BOM + toCsv(rows as never[], columns), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${base}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const book = buildXlsx(
      spec.title.slice(0, 31),
      columns.map((c) => c.header),
      (rows as never[]).map((r) => columns.map((c) => c.value(r) as XlsxCell)),
    );
    return new Response(book as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${base}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[list-export]', params.get('screen'), err);
    return new Response('The export could not be made.', { status: 500 });
  }
}
