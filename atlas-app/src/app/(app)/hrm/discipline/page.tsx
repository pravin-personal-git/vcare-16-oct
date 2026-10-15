import { requireContext } from '@/server/context';
import { listActionTypes, listDisciplineEmployees } from '@/server/discipline';
import { DISCIPLINE_LIST, runCardList } from '@/server/card-lists';
import { DisciplineClient } from './DisciplineClient';

/**
 * Policies & Discipline - the DISCIPLINE half (roadmap §4.2). The POLICIES
 * half stays exactly where it already is, Common Hub's "Terms & Policy" -
 * this is a new, separate screen, not a merge.
 */
export default async function DisciplinePage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireContext();
  const { scope } = ctx;
  const scopeIsAll = scope.kind === 'all';

  const [actionTypes, actions, employees] = scopeIsAll
    ? [[], [], []]
    : await Promise.all([
      listActionTypes(scope),
      DISCIPLINE_LIST.load(ctx),
      listDisciplineEmployees(scope),
    ]);

  // One page of records on the wire (F1b server paging, 6 Oct 2026).
  const list = runCardList(DISCIPLINE_LIST, actions, sp, ctx);

  return (
    <DisciplineClient
      listPage={{ server: list.server, chipCounts: list.chipCounts, total: list.all }}
      actionTypes={actionTypes}
      actions={list.rows.map((a) => ({ ...a, startDate: a.startDate.toISOString(), createdAt: a.createdAt.toISOString() }))}
      employees={employees}
      scopeIsAll={scopeIsAll}
      canEdit={ctx.permissions.has('hrm.edit')}
    />
  );
}
