import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { getInstallationPage } from '@/server/installation-page';
import { listAttachments } from '@/server/attachments';
import { documentTrail } from '@/server/document-trail';
import { DocumentTrail } from '@/components/document/DocumentTrail';
import { installationJobChallans } from '@/server/job-challans';
import { catalogueOptions } from '@/server/form-options';
import { InstallationView } from './InstallationView';

/**
 * ONE INSTALLATION (11 Oct 2026, Pravin: "give them individual and detailed
 * pages, exact same layout as the complaints page"). Worked like a complaint -
 * stage, technicians, visits with check-in, the units fitted - but built for
 * new fitting: site survey, material used, testing, handover. No faulty parts.
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
    canEdit ? catalogueOptions(ctx.scope) : Promise.resolve([]),
  ]);
  return (
    <>
    <DocumentTrail steps={trail} />
    <InstallationView
      data={data}
      files={files}
      canEdit={canEdit}
      parts={{
        challans: challans.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
        catalogue,
        canIssue: ctx.permissions.has('stock.adjust'),
      }}
    />
    </>
  );
}
