import 'server-only';

/**
 * THE ONE PLACE A DOCUMENT BECOMES A PDF (A3, 12 Oct 2026).
 *
 * WhatsApp's Cloud API sends a real file, which it downloads from a public
 * address - so a PDF has to be made on the server. Every other part of A3
 * (the template, the send, the log, the webhook, the buttons) is built and
 * waits on this one function.
 *
 * NOT CHOSEN YET - Pravin's call (cost):
 *   - Headless Chrome (@sparticuz/chromium + puppeteer-core) printing the
 *     document's own no-login page: one layout, pixel-identical to Print,
 *     but ~60 MB more in every Vercel deployment and a few seconds a PDF.
 *   - @react-pdf/renderer: small and fast, but a second copy of each paper
 *     layout to keep in step (the "two renderers" trap, CONNECTIONS.md).
 * Until then `PDF_ENGINE_READY` is false, the send button says so, and the
 * /pdf addresses answer 503 instead of a broken file.
 */
export const PDF_ENGINE_READY = false;

export class PdfEngineMissing extends Error {
  constructor() {
    super('Sending the PDF on WhatsApp is not switched on yet - the PDF maker still has to be chosen. Use "Open in my WhatsApp" for now.');
  }
}

/** The document's printable page at `pageUrl`, as PDF bytes. */
export async function renderPdf(pageUrl: string): Promise<Uint8Array> {
  void pageUrl;
  throw new PdfEngineMissing();
}
