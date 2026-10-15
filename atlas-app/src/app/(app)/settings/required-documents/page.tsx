import { requireContext } from '@/server/context';
import { requiredRulesFor } from '@/server/attachments';
import { RequiredDocsClient } from './RequiredDocsClient';

/**
 * Settings › Required documents (11 Oct 2026, ops-pages demo tab 4): which
 * files each document needs. Warn shows amber on the document; Block stops
 * the one step it is tied to. Every business starts on four rules, all Warn.
 */
export default async function RequiredDocumentsPage() {
  const ctx = await requireContext();
  const rules = await requiredRulesFor(ctx.scope);
  return <RequiredDocsClient initial={rules} canEdit={ctx.permissions.has('settings.edit') && ctx.scope.kind === 'single'} />;
}
