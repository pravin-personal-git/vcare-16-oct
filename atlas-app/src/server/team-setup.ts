import 'server-only';
import { db } from './db';
import { setReportsTo, HierarchyError } from './hierarchy';

/**
 * A dated history of designation/manager/branch assignments, alongside
 * `User.reportsToId` rather than instead of it - see the model comment on
 * `ReportingAssignment` in schema.prisma for why. `setReportsTo`'s existing
 * cycle-detection is reused as-is rather than duplicated here.
 */

export interface TeamSetupRow {
  userId: string;
  fullName: string;
  isActive: boolean;
  current: {
    id: string;
    managerId: string | null;
    managerName: string | null;
    designationRoleId: string | null;
    designationLabel: string | null;
    storeId: string | null;
    storeName: string | null;
    effectiveFrom: Date;
  } | null;
  history: {
    id: string;
    managerName: string | null;
    designationLabel: string | null;
    storeName: string | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }[];
}

export async function listTeamSetup(organizationId: string): Promise<TeamSetupRow[]> {
  const [users, assignments] = await Promise.all([
    db.user.findMany({
      where: { organizationId },
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
      select: { id: true, fullName: true, isActive: true },
    }),
    db.reportingAssignment.findMany({
      where: { organizationId },
      orderBy: { effectiveFrom: 'desc' },
      select: {
        id: true, userId: true, effectiveFrom: true, effectiveTo: true,
        manager: { select: { fullName: true } },
        designationRole: { select: { name: true, designationCode: true } },
        store: { select: { name: true } },
        managerId: true, designationRoleId: true, storeId: true,
      },
    }),
  ]);

  const byUser = new Map<string, typeof assignments>();
  for (const a of assignments) byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), a]);

  const designationLabel = (r: { name: string; designationCode: string | null } | null) =>
    r ? (r.designationCode ? `${r.designationCode} - ${r.name}` : r.name) : null;

  return users.map((u) => {
    const rows = byUser.get(u.id) ?? [];
    const current = rows.find((r) => r.effectiveTo === null) ?? null;
    const past = rows.filter((r) => r.effectiveTo !== null);
    return {
      userId: u.id,
      fullName: u.fullName,
      isActive: u.isActive,
      current: current ? {
        id: current.id,
        managerId: current.managerId,
        managerName: current.manager?.fullName ?? null,
        designationRoleId: current.designationRoleId,
        designationLabel: designationLabel(current.designationRole),
        storeId: current.storeId,
        storeName: current.store?.name ?? null,
        effectiveFrom: current.effectiveFrom,
      } : null,
      history: past.map((r) => ({
        id: r.id,
        managerName: r.manager?.fullName ?? null,
        designationLabel: designationLabel(r.designationRole),
        storeName: r.store?.name ?? null,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
      })),
    };
  });
}

export interface TeamAssignmentInput {
  managerId: string | null;
  designationRoleId: string | null;
  storeId: string | null;
}

/**
 * Close whatever assignment was open, open a new one, and keep
 * `User.reportsToId` pointed the same way - one transaction, one source of
 * truth for "who does this person report to right now."
 */
export async function setTeamAssignment(
  organizationId: string,
  userId: string,
  input: TeamAssignmentInput,
  createdBy: string,
): Promise<void> {
  const user = await db.user.findFirst({ where: { id: userId, organizationId } });
  if (!user) throw new HierarchyError('User not found.');

  if (input.designationRoleId) {
    const role = await db.role.findFirst({
      where: { id: input.designationRoleId, store: { organizationId } },
      select: { id: true },
    });
    if (!role) throw new HierarchyError('That designation is not in this organisation.');
  }
  if (input.storeId) {
    const store = await db.store.findFirst({ where: { id: input.storeId, organizationId } });
    if (!store) throw new HierarchyError('That branch is not in this organisation.');
  }

  // Reuses the existing cycle-detection rules - a designation change must
  // not silently skip the same checks a plain manager change already gets.
  await setReportsTo(organizationId, userId, input.managerId);

  const now = new Date();
  await db.$transaction([
    db.reportingAssignment.updateMany({
      where: { organizationId, userId, effectiveTo: null },
      data: { effectiveTo: now },
    }),
    db.reportingAssignment.create({
      data: {
        organizationId, userId,
        managerId: input.managerId,
        designationRoleId: input.designationRoleId,
        storeId: input.storeId,
        effectiveFrom: now,
        createdBy,
      },
    }),
  ]);
}
