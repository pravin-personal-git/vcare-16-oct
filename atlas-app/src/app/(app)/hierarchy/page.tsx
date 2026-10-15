import { requireContext } from '@/server/context';
import { orgChart } from '@/server/hierarchy';
import { HierarchyClient } from './HierarchyClient';

/**
 * WHO REPORTS TO WHOM.
 *
 * Until 5 Oct 2026 this page also carried a per-branch "Approval chain"
 * (document -> role, with from / up-to amounts). It was a second place to set
 * approvals that lost to Settings > Approval Rules whenever a rule was saved,
 * only ever applied to sales orders (nothing asks quotations, purchase bills,
 * credit notes or sales returns for approval), and its amount boxes were never
 * read. Approvals are set in Settings only now. Existing chain rows are kept,
 * not deleted: where no rule is saved they still route, and the Approval
 * Rules page names them as the current behaviour.
 */
export default async function HierarchyPage() {
  const ctx = await requireContext();
  const chart = await orgChart(ctx.organization.id);
  return <HierarchyClient chart={chart} canEdit={ctx.permissions.has('users.edit')} />;
}
