import 'server-only';
import { PdfEngineMissing, renderPdf } from './pdf-engine';

/**
 * GET /i|/q|/o/<token>/pdf - the document's PDF, for WhatsApp to download
 * (A3). No login: the token is the credential, as for the page itself, and
 * the PDF is that same page printed - one layout. Never cached by a shared
 * cache; never indexed.
 */
export async function pdfResponse(
  req: Request, pagePath: string, found: { docNo: string } | null,
): Promise<Response> {
  if (!found) return new Response('Not found', { status: 404 });
  const origin = new URL(req.url).origin;
  try {
    const bytes = await renderPdf(`${origin}${pagePath}`);
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${found.docNo.replace(/[^A-Za-z0-9._-]/g, '-')}.pdf"`,
        'cache-control': 'private, no-store',
        'x-robots-tag': 'noindex',
      },
    });
  } catch (e) {
    if (e instanceof PdfEngineMissing) return new Response(e.message, { status: 503 });
    console.error('[pdf] render failed', e);
    return new Response('Could not make the PDF.', { status: 500 });
  }
}
