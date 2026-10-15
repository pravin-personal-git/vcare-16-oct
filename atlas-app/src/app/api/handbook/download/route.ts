import { requireContext } from '@/server/context';
import { handbookFor, sopGuideFor } from '@/server/handbook';

/**
 * The handbook as one HTML file to keep on a laptop. Built for the person
 * downloading it, exactly like the /handbook screen - a helper's copy has no
 * admin chapters in it. Links in the file open the live Atlas site.
 * `?doc=sop` downloads the SOP guidebook instead (5 Oct 2026).
 */
export async function GET(req: Request) {
  const ctx = await requireContext();
  const url = new URL(req.url);
  const origin = url.origin;
  const sop = url.searchParams.get('doc') === 'sop';
  const html = sop ? sopGuideFor(ctx, 'file', origin) : await handbookFor(ctx, 'file', origin);
  const safe = ctx.organization.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Atlas';

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safe}-${sop ? 'SOP-Guidebook' : 'Atlas-Handbook'}.html"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
