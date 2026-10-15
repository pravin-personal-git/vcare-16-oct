import { requireContext } from '@/server/context';
import { peopleDirectory } from '@/server/people-page';
import { addPersonOptions } from '@/server/add-person';
import { EmptyState } from '@/components/ui/Layout';
import { PeopleClient } from './PeopleClient';

/** People (B3 part 1, 11 Oct 2026): one row per person in this branch. Read only. */
export default async function PeoplePage() {
  const ctx = await requireContext();
  const dir = await peopleDirectory(ctx.scope, ctx.organization.id, {
    excludedModules: ctx.excludedModules, excludedPages: ctx.excludedPages,
  });
  const options = ctx.permissions.has('users.edit') && !ctx.readOnly ? await addPersonOptions(ctx.scope) : null;
  if (!dir) {
    return (
      <div className="mx-auto mt-16 max-w-md">
        <EmptyState icon="users" title="Pick a branch first" hint="People are listed per branch. Choose one in the top bar." />
      </div>
    );
  }
  return <PeopleClient storeName={dir.report.storeName} people={dir.report.people} extra={dir.extra} roles={dir.report.roles.map((r) => r.name)} addOptions={options} />;
}
