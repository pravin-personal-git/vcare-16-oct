import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { changesAbout, peopleDirectory } from '@/server/people-page';
import { EmptyState } from '@/components/ui/Layout';
import { PersonClient } from './PersonClient';

/** One person (B3 part 1, 11 Oct 2026): login, employee, branches, manager, overrides, what they can do. Read only. */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const dir = await peopleDirectory(ctx.scope, ctx.organization.id, {
    excludedModules: ctx.excludedModules, excludedPages: ctx.excludedPages,
  });
  if (!dir) {
    return (
      <div className="mx-auto mt-16 max-w-md">
        <EmptyState icon="users" title="Pick a branch first" hint="A person's access is per branch. Choose one in the top bar." />
      </div>
    );
  }
  const person = dir.report.people.find((p) => p.id === id);
  if (!person) notFound();
  return (
    <PersonClient
      storeName={dir.report.storeName}
      person={person}
      extra={dir.extra[id]!}
      capabilities={dir.report.capabilities.filter((c) => person.capabilities.includes(c.key)).map((c) => ({ key: c.key, sentence: c.sentence, group: c.group }))}
      changes={changesAbout(person, dir.report.changes)}
      canSeeEmployee={ctx.permissions.has('hrm.view') || ctx.permissions.has('hrm.edit')}
    />
  );
}
