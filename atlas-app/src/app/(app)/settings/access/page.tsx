import { requireContext } from '@/server/context';
import { accessReport } from '@/server/access-report';
import { EmptyState } from '@/components/ui/Layout';
import { AccessClient } from './AccessClient';

/**
 * Access check (B2, 11 Oct 2026): who can do what in this branch, in plain
 * words, and what looks wrong. Read only - every fix links to the screen
 * that makes it. See server/access-report.ts.
 */
export default async function AccessCheckPage() {
  const ctx = await requireContext();
  const report = await accessReport(ctx.scope, ctx.organization.id, {
    excludedModules: ctx.excludedModules, excludedPages: ctx.excludedPages,
  });
  if (!report) {
    return (
      <div className="mx-auto mt-16 max-w-md">
        <EmptyState icon="users" title="Pick a branch first" hint="Access is set per branch. Choose one in the top bar to see who can do what there." />
      </div>
    );
  }
  return <AccessClient report={report} />;
}
