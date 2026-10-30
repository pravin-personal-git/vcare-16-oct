import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { getInstallationPage } from '@/server/installation-page';
import { listAttachments } from '@/server/attachments';
import { documentTrail } from '@/server/document-trail';
import { DocumentTrail } from '@/components/document/DocumentTrail';
import { installationJobChallans } from '@/server/job-challans';
import { cachedCatalogueOptions } from '@/server/form-options';
import { InstallationView } from './InstallationView';
import { OldSystemRemarks } from '@/components/document/OldSystemRemarks';

/**
 * ONE INSTALLATION (11 Oct 2026, Pravin: "give them individual and detailed
 * pages, exact same layout as the complaints page"). Rebuilt like a complaint
 * on 27 Oct 2026: stages that move by themselves, items editable until
 * billed, material only through the Parts card, Bill this installation.
 */
export default async function InstallationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const data = await getInstallationPage(ctx.scope, id);
  if (!data) notFound();
  const canEdit = ctx.permissions.has('installations.edit') && ctx.scope.kind === 'single';
  const [files, trail, challans, catalogue] = await Promise.all([
    listAttachments(ctx.scope, 'installation_challan', id),
    // Its order, quotation, invoice and payments, both ways (G1, 11 Oct 2026).
    documentTrail(ctx.scope, 'installation', id),
    // Cable, clamps - material not on the order (R3, 22 Oct 2026).
    installationJobChallans(ctx.scope, id),
    canEdit ? cachedCatalogueOptions(ctx.scope) : Promise.resolve([]),
  ]);
  return (
    <>
    <DocumentTrail steps={trail} />
    <InstallationView
      data={data}
      files={files}
      canEdit={canEdit}
      canBill={ctx.permissions.has('invoice.create') && ctx.scope.kind === 'single'}
      parts={{
        challans: challans.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
        catalogue,
        canIssue: ctx.permissions.has('stock.adjust'),
      }}
    />
    {/* What the old software said on this challan's job (29 Oct 2026). */}
    <OldSystemRemarks table="InstallationChallan" rowId={id} />
    </>
  );
}
