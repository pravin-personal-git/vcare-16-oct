/**
 * Open WhatsApp with a message that needs a server call first (a share link).
 *
 * The tab is opened inside the click, before the await, so a pop-up blocker
 * lets it through - the complaint page's way (G6). Returns the error to show
 * on the page's own notice line, or null; never `alert()` (A1, 11 Oct 2026).
 */
import { whatsappLink } from './revenue';

export async function openWhatsApp(
  phone: string | null | undefined,
  build: () => Promise<string | { error: string }>,
): Promise<string | null> {
  const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  const r = await build();
  if (typeof r !== 'string') { tab?.close(); return r.error; }
  const href = whatsappLink(phone, r);
  if (tab) tab.location.href = href;
  else window.open(href, '_blank');
  return null;
}
