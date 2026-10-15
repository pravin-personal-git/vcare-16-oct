import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { getRepairChallanDetail } from '@/server/complaints';
import { RepairChallanView } from './RepairChallanView';
import { DocumentActivity } from '@/components/document/DocumentActivity';

/** One repair challan, on its own page, correctable after saving (health check I2 / SVC-3). */
export default async function RepairChallanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const c = await getRepairChallanDetail(ctx.scope, id);
  if (!c) notFound();
  return (
    <>
    <RepairChallanView
      challan={{ ...c, dispatchedAt: c.dispatchedAt.toISOString(), createdAt: c.createdAt.toISOString() }}
      canEdit={ctx.scope.kind === 'single' && ctx.permissions.has('complaints.edit')}
    />
      <DocumentActivity table="RepairChallan" rowId={id} />
    </>
  );
}
