import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { listTeamSetup, setTeamAssignment } from './team-setup';
import { HierarchyError } from './hierarchy';

/**
 * The employee record, in Atlas (health check HR-2, 25 Sep 2026). Atlas-HRNS
 * is retired; Settings → Employees was a signpost to it. The data was already
 * here - User, EmployeeProfile, the Team Setup assignment - with no screen that
 * listed it. This reads it for one page and saves it back.
 */

export class EmployeeError extends Error {}

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'] as const;

export interface EmployeeRow {
  id: string;
  userCode: string;
  fullName: string;
  username: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  departmentId: string | null;
  departmentName: string | null;
  designationRoleId: string | null;
  designationLabel: string | null;
  managerId: string | null;
  managerName: string | null;
  branchId: string | null;
  branchName: string | null;
  roles: string[];
  phonePaired: boolean;
  lastLoginAt: string | null;
  profile: {
    dateOfJoining: string | null;
    dateOfBirth: string | null;
    employmentType: string;
    personalEmail: string | null;
    address: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    /** Only filled for people who may see pay details. */
    bankAccountNumber: string | null;
    bankIfsc: string | null;
    exitDate: string | null;
  };
}

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function listEmployees(scope: StoreScope, organizationId: string, canSeeBank: boolean): Promise<EmployeeRow[]> {
  const where = scopeWhere(scope);
  const [users, team, devices] = await Promise.all([
    db.user.findMany({
      where: { organizationId, storeRoles: { some: { ...where } } },
      include: {
        department: { select: { name: true } },
        profile: true,
        storeRoles: { where, include: { role: { select: { name: true } } } },
      },
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    }),
    listTeamSetup(organizationId),
    db.callSyncDevice.findMany({ where: { ...where, isActive: true }, select: { userId: true } }),
  ]);
  const teamBy = new Map(team.map((t) => [t.userId, t.current]));
  const paired = new Set(devices.map((d) => d.userId));
  return users.map((u) => {
    const t = teamBy.get(u.id) ?? null;
    const p = u.profile;
    return {
      id: u.id, userCode: u.userCode, fullName: u.fullName, username: u.username, phone: u.phone, email: u.email,
      isActive: u.isActive, departmentId: u.departmentId, departmentName: u.department?.name ?? null,
      designationRoleId: t?.designationRoleId ?? null, designationLabel: t?.designationLabel ?? null,
      managerId: t?.managerId ?? null, managerName: t?.managerName ?? null,
      branchId: t?.storeId ?? null, branchName: t?.storeName ?? null,
      roles: [...new Set(u.storeRoles.map((r) => r.role.name))],
      phonePaired: paired.has(u.id),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      profile: {
        dateOfJoining: day(p?.dateOfJoining), dateOfBirth: day(p?.dateOfBirth),
        employmentType: p?.employmentType ?? 'full_time',
        personalEmail: p?.personalEmail ?? null, address: p?.address ?? null,
        emergencyContactName: p?.emergencyContactName ?? null, emergencyContactPhone: p?.emergencyContactPhone ?? null,
        bankAccountNumber: canSeeBank ? p?.bankAccountNumber ?? null : null,
        bankIfsc: canSeeBank ? p?.bankIfsc ?? null : null,
        exitDate: day(p?.exitDate),
      },
    };
  });
}

export interface EmployeeInput {
  fullName: string;
  phone: string | null;
  email: string | null;
  departmentId: string | null;
  managerId: string | null;
  designationRoleId: string | null;
  branchId: string | null;
  dateOfJoining: string | null;
  dateOfBirth: string | null;
  employmentType: string;
  personalEmail: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
}

const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const asDate = (v: string | null) => {
  if (!v) return null;
  const d = new Date(`${v}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) throw new EmployeeError('One of the dates is not a real date.');
  return d;
};

/**
 * Save an employee's details. Every change is kept by the audit trail
 * (AUD-1); a change of manager, designation or branch also closes the old
 * Team Setup assignment and opens a new one, so the reporting history stays.
 */
export async function updateEmployee(
  scope: StoreScope, organizationId: string, userId: string, input: EmployeeInput, actorId: string, canEditBank: boolean,
): Promise<void> {
  const user = await db.user.findFirst({
    where: { id: userId, organizationId, storeRoles: { some: { ...scopeWhere(scope) } } },
    select: { id: true },
  });
  if (!user) throw new EmployeeError('That person is not in this branch.');
  if (!clean(input.fullName)) throw new EmployeeError('Name is required.');
  if (input.phone && !/^[+\d][\d\s-]{6,}$/.test(input.phone.trim())) throw new EmployeeError('Check the phone number.');
  if (!(EMPLOYMENT_TYPES as readonly string[]).includes(input.employmentType)) throw new EmployeeError('Choose an employment type.');
  if (input.departmentId) {
    const dep = await db.department.findFirst({ where: { id: input.departmentId, ...scopeWhere(scope) }, select: { id: true } });
    if (!dep) throw new EmployeeError('That department is not in this branch.');
  }
  if (input.bankIfsc && canEditBank && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(input.bankIfsc.trim().toUpperCase())) {
    throw new EmployeeError('IFSC is 11 characters, like SBIN0001234.');
  }

  const profile = {
    dateOfJoining: asDate(input.dateOfJoining), dateOfBirth: asDate(input.dateOfBirth),
    employmentType: input.employmentType, personalEmail: clean(input.personalEmail), address: clean(input.address),
    emergencyContactName: clean(input.emergencyContactName), emergencyContactPhone: clean(input.emergencyContactPhone),
    ...(canEditBank ? { bankAccountNumber: clean(input.bankAccountNumber), bankIfsc: clean(input.bankIfsc)?.toUpperCase() ?? null } : {}),
  };
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { fullName: input.fullName.trim(), phone: clean(input.phone), email: clean(input.email)?.toLowerCase() ?? null, departmentId: input.departmentId },
    });
    await tx.employeeProfile.upsert({ where: { userId }, create: { userId, ...profile }, update: profile });
  });

  const current = (await listTeamSetup(organizationId)).find((t) => t.userId === userId)?.current ?? null;
  const changed = (current?.managerId ?? null) !== input.managerId
    || (current?.designationRoleId ?? null) !== input.designationRoleId
    || (current?.storeId ?? null) !== input.branchId;
  if (changed) {
    try {
      await setTeamAssignment(organizationId, userId, { managerId: input.managerId, designationRoleId: input.designationRoleId, storeId: input.branchId }, actorId);
    } catch (e) {
      if (e instanceof HierarchyError) throw new EmployeeError(e.message);
      throw e;
    }
  }
}
