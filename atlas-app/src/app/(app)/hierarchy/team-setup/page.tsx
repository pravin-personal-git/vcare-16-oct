import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { listTeamSetup } from '@/server/team-setup';
import { TeamSetupClient } from './TeamSetupClient';

/**
 * Designation, reporting manager and branch, per person, with history.
 *
 * Organisation-wide, not store-scoped - a reporting line runs across
 * branches, the same reasoning the Hierarchy screen's own reporting-line
 * card already follows.
 */
export default async function TeamSetupPage() {
  const ctx = await requireContext();

  const [rows, designations] = await Promise.all([
    listTeamSetup(ctx.organization.id),
    db.role.findMany({
      where: { store: { organizationId: ctx.organization.id }, designationCode: { not: null } },
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, designationCode: true, level: true, store: { select: { name: true } } },
    }),
  ]);

  return (
    <TeamSetupClient
      rows={rows.map((r) => ({
        ...r,
        current: r.current ? { ...r.current, effectiveFrom: r.current.effectiveFrom.toISOString() } : null,
        history: r.history.map((h) => ({
          ...h,
          effectiveFrom: h.effectiveFrom.toISOString(),
          effectiveTo: h.effectiveTo?.toISOString() ?? null,
        })),
      }))}
      designations={designations.map((d) => ({
        id: d.id,
        label: `${d.designationCode} - ${d.name} (${d.store.name})`,
      }))}
      stores={ctx.stores}
      canEdit={ctx.permissions.has('users.edit')}
    />
  );
}
