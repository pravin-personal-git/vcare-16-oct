import { notFound, redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';

/**
 * A complaint ITEM has no page of its own; My Desk links to one (a warranty
 * void is decided per item), so this finds the item's complaint and goes there.
 */
export default async function ComplaintItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const item = await db.complaintItem.findFirst({ where: { id, ...scopeWhere(ctx.scope) }, select: { complaintId: true } });
  if (!item) notFound();
  redirect(`/services/complaints/${item.complaintId}`);
}
