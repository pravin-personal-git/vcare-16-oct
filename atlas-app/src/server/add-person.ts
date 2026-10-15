import 'server-only';
import { randomInt } from 'node:crypto';
import { db } from './db';
import { scopeForWrite, scopeWhere, userInScope, type StoreScope } from './store-scope';
import { AdminError, createUser } from './administration';
import { EMPLOYMENT_TYPES } from './employees';
import { setTeamAssignment } from './team-setup';
import { generatePassword } from '@/lib/password-policy';

/**
 * ADD A PERSON - ONE FORM, ONE RECORD (B3 part 2, 11 Oct 2026).
 *
 * Adding a technician was three forms in three places (User List, User store
 * roles, Employees), and nothing stopped a login being made without an
 * employee record. Pravin's P3: every login is an employee. So the login,
 * the role(s) in this branch and the employee record are written in ONE
 * transaction (createUser's `alsoInside`) - all of it or none of it.
 *
 * The manager is set straight after, through Team Setup's own function, so
 * the reporting history and its cycle checks stay in one place. If that
 * step fails the person exists and the reason is returned to show.
 *
 * Passwords follow User List (9 Oct 2026, Vcare): Atlas picks one if the
 * admin leaves it blank, an admin-readable copy is kept, and the person is
 * not forced to change it.
 */

export interface AddPersonInput {
  fullName: string;
  username: string;
  phone: string | null;
  email: string | null;
  departmentId: string | null;
  roleIds: string[];
  managerId: string | null;
  employmentType: string;
  /** YYYY-MM-DD, India time. */
  dateOfJoining: string | null;
  /** Blank = Atlas picks a strong one. */
  password: string | null;
}

export async function addPerson(
  scope: StoreScope, organizationId: string, input: AddPersonInput, actorId: string,
): Promise<{ userId: string; username: string; password: string; warning: string | null }> {
  const storeId = scopeForWrite(scope);
  if (!(EMPLOYMENT_TYPES as readonly string[]).includes(input.employmentType)) throw new AdminError('Choose an employment type.');
  if (input.roleIds.length === 0) throw new AdminError('Pick at least one role - a person with none can sign in but sees nothing.');
  if (input.phone && !/^[+\d][\d\s-]{6,}$/.test(input.phone.trim())) throw new AdminError('Check the mobile number.');

  const roles = await db.role.findMany({ where: { id: { in: input.roleIds }, storeId }, select: { id: true } });
  if (roles.length !== new Set(input.roleIds).size) throw new AdminError('One of those roles is not in this branch.');
  if (input.departmentId) {
    const dep = await db.department.findFirst({ where: { id: input.departmentId, ...scopeWhere(scope) }, select: { id: true } });
    if (!dep) throw new AdminError('That department is not in this branch.');
  }
  let joined: Date | null = null;
  if (input.dateOfJoining) {
    joined = new Date(`${input.dateOfJoining}T00:00:00+05:30`);
    if (Number.isNaN(joined.getTime())) throw new AdminError('The joining date is not a real date.');
  }

  const password = input.password?.trim() || generatePassword((max) => randomInt(max));
  const user = await createUser(organizationId, {
    fullName: input.fullName,
    username: input.username,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    departmentId: input.departmentId,
    password,
    isSeatLicensed: true,
    assignments: input.roleIds.map((roleId) => ({ storeId, roleId })),
  }, async (tx, userId) => {
    await tx.employeeProfile.create({ data: { userId, employmentType: input.employmentType, dateOfJoining: joined } });
  });

  let warning: string | null = null;
  if (input.managerId) {
    try {
      await setTeamAssignment(organizationId, user.id, { managerId: input.managerId, designationRoleId: input.roleIds[0]!, storeId }, actorId);
    } catch (e) {
      warning = `Added, but the manager was not set: ${e instanceof Error ? e.message : 'unknown error'}. Set it in Team Setup.`;
    }
  }
  return { userId: user.id, username: user.username, password, warning };
}

/** What the form offers: this branch's roles, departments and possible managers. */
export async function addPersonOptions(scope: StoreScope) {
  if (scope.kind !== 'single') return null;
  const [roles, departments, managers] = await Promise.all([
    db.role.findMany({ where: { storeId: scope.storeId }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.department.findMany({ where: { ...scopeWhere(scope), isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.user.findMany({ where: { isActive: true, ...userInScope(scope) }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true } }),
  ]);
  return { roles, departments, managers: managers.map((m) => ({ id: m.id, name: m.fullName })) };
}
