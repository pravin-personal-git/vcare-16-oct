import { requireContext } from '@/server/context';
import { templateChoices } from '@/server/document-templates';
import { BUILT_IN_TEMPLATES, DEFAULT_TEMPLATE_ID, parseTemplateOptions } from '@/lib/document-templates';
import { DocumentsClient } from './DocumentsClient';

/** Settings > Document layouts (workstream C). */
export default async function DocumentsSettingsPage() {
  const ctx = await requireContext();

  // Read-only on "All Company" rather than hidden: a client exploring
  // settings should still see what the layouts are.
  if (ctx.scope.kind !== 'single') {
    return (
      <DocumentsClient
        builtIns={[...BUILT_IN_TEMPLATES]}
        custom={parseTemplateOptions(null)}
        chosen={{ quotation: DEFAULT_TEMPLATE_ID, invoice: DEFAULT_TEMPLATE_ID, challan: DEFAULT_TEMPLATE_ID }}
        canEdit={false}
      />
    );
  }

  const { builtIns, custom, chosen } = await templateChoices(ctx.scope.storeId);

  return (
    <DocumentsClient
      builtIns={builtIns}
      custom={custom}
      chosen={chosen}
      canEdit={ctx.permissions.has('settings.edit')}
    />
  );
}
