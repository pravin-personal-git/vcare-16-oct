'use server';

import { requireContext } from '@/server/context';
import { listAttachments } from '@/server/attachments';

/**
 * The photos a goods receipt or lead was scanned from, for the small viewer
 * on those screens. Read-only; the same edit rights that let a person attach
 * a photo are not needed to look at one, only the right to see the record.
 */
const CAN_SEE: Record<'goods_receipt' | 'lead', string[]> = {
  goods_receipt: ['purchase.edit', 'purchase.approve', 'purchase.pay'],
  lead: ['leads.view', 'leads.create', 'leads.edit'],
};

export interface DocPhoto {
  id: string;
  fileName: string;
  url: string | null;
  label: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
}

export async function listDocPhotosAction(
  docType: 'goods_receipt' | 'lead',
  docId: string,
): Promise<{ rows: DocPhoto[]; error?: string }> {
  const ctx = await requireContext();
  if (!CAN_SEE[docType]?.some((p) => ctx.permissions.has(p))) {
    return { rows: [], error: 'You do not have access to these files.' };
  }
  const rows = await listAttachments(ctx.scope, docType, docId);
  return {
    rows: rows.map((r) => ({
      id: r.id, fileName: r.fileName, url: r.url, label: r.label,
      uploadedAt: r.uploadedAt.toISOString(), uploadedByName: r.uploadedByName,
    })),
  };
}
