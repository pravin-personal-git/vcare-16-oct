'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { friendlyError } from '@/lib/friendly-error';
import type { SendDocType } from '@/server/document-send';

const VIEW: Record<SendDocType, string[]> = {
  invoice: ['invoice.view', 'invoice.create', 'invoice.edit'],
  quotation: ['quotation.view', 'quotation.create', 'quotation.edit'],
  order: ['orders.view', 'orders.create', 'orders.edit'],
};
const PAGE: Record<SendDocType, string> = { invoice: '/invoices', quotation: '/quotation', order: '/sales/orders' };

/** Send the document's PDF from the branch's WhatsApp Business number (A3, 12 Oct 2026). */
export async function sendDocumentWhatsAppAction(type: SendDocType, id: string): Promise<{ error?: string; status?: string }> {
  try {
    const ctx = await requireContext();
    if (!VIEW[type].some((p) => ctx.permissions.has(p))) return { error: 'You do not have access to this document.' };
    if (ctx.readOnly) return { error: 'This business is in read-only mode.' };
    const h = await (await import('next/headers')).headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const { sendDocumentOnWhatsApp, SendError } = await import('@/server/document-send');
    try {
      const r = await sendDocumentOnWhatsApp(ctx, type, id, `${proto}://${host}`);
      revalidatePath(`${PAGE[type]}/${id}`);
      return r.ok ? { status: r.status } : { error: r.error ?? 'WhatsApp refused it.' };
    } catch (e) {
      if (e instanceof SendError || (e instanceof Error && /belongs to someone else|Issue the invoice|cancelled order/.test(e.message))) return { error: e.message };
      throw e;
    }
  } catch (err) {
    console.error('[document-send] failed', err);
    return { error: friendlyError(err) };
  }
}
