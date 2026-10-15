'use server';

import { requireContext } from '@/server/context';
import { jobGdnDocument } from '@/server/job-challans';

/**
 * One job GDN, as a document.
 *
 * Gated on `stock.view` rather than on a complaint permission: this is a note
 * about goods leaving a warehouse, and the storeman who needs to reconcile it
 * is not necessarily anybody's idea of a service user.
 */
export async function loadJobGdn(id: string) {
  const ctx = await requireContext();
  if (!ctx.permissions.has('stock.view')) return null;
  return jobGdnDocument(ctx.scope, id);
}
