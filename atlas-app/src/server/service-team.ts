import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { isSalesTeamMember, isServiceTeamMember } from '@/lib/technicians';

/**
 * Which departments are "the service team" (health check CALL-6).
 *
 * The admin ticks them on Service Team Calls. Until they do, the old guess
 * stays as the fallback - any department whose name reads as service work -
 * so nothing goes blank on the day this ships. The guess was fragile:
 * renaming "Service" to "Field Team Durg" silently emptied the screen.
 */
export const SERVICE_WORDS = ['service', 'support', 'field', 'amc', 'maintenance', 'technical'];
/** The same fallback for the sales side (8 Oct 2026). */
export const SALES_WORDS = ['sales', 'marketing', 'business', 'counter', 'showroom', 'crm'];

export interface ServiceDepartments {
  departments: { id: string; name: string; code: string }[];
  serviceIds: string[];
  /** True when the admin chose them; false when guessed from names. */
  chosen: boolean;
}

export async function serviceDepartments(scope: StoreScope): Promise<ServiceDepartments> {
  const [departments, stores] = await Promise.all([
    db.department.findMany({
      where: { ...scopeWhere(scope), isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    }),
    db.store.findMany({
      where: { id: { in: scope.kind === 'single' ? [scope.storeId] : scope.storeIds } },
      select: { serviceDepartmentIds: true },
    }),
  ]);
  const chosenIds = new Set(stores.flatMap((s) => s.serviceDepartmentIds));
  const valid = departments.filter((d) => chosenIds.has(d.id)).map((d) => d.id);
  if (valid.length) return { departments, serviceIds: valid, chosen: true };
  return {
    departments,
    serviceIds: departments.filter((d) => SERVICE_WORDS.some((w) => d.name.toLowerCase().includes(w))).map((d) => d.id),
    chosen: false,
  };
}

export async function setServiceDepartments(scope: StoreScope, ids: string[]): Promise<void> {
  const storeId = scopeForWrite(scope);
  const valid = await db.department.findMany({ where: { storeId, id: { in: ids.slice(0, 100) } }, select: { id: true } });
  await db.store.update({ where: { id: storeId }, data: { serviceDepartmentIds: valid.map((d) => d.id) } });
}

/**
 * Which departments are "the sales team" (8 Oct 2026).
 *
 * The mirror of `serviceDepartments`, written when the Sales menu became
 * "Sales Team Calls". Same shape, same fallback, same reason: until an admin
 * ticks the departments, guess from their names so the screen is not blank
 * on the day it ships - and say in `chosen` which of the two it is, so the
 * screen can offer to make it certain.
 */
export async function salesDepartments(scope: StoreScope): Promise<ServiceDepartments> {
  const [departments, stores] = await Promise.all([
    db.department.findMany({
      where: { ...scopeWhere(scope), isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    }),
    db.store.findMany({
      where: { id: { in: scope.kind === 'single' ? [scope.storeId] : scope.storeIds } },
      select: { salesDepartmentIds: true },
    }),
  ]);
  const chosenIds = new Set(stores.flatMap((s) => s.salesDepartmentIds));
  const valid = departments.filter((d) => chosenIds.has(d.id)).map((d) => d.id);
  if (valid.length) return { departments, serviceIds: valid, chosen: true };
  return {
    departments,
    serviceIds: departments.filter((d) => SALES_WORDS.some((w) => d.name.toLowerCase().includes(w))).map((d) => d.id),
    chosen: false,
  };
}

export async function setSalesDepartments(scope: StoreScope, ids: string[]): Promise<void> {
  const storeId = scopeForWrite(scope);
  const valid = await db.department.findMany({ where: { storeId, id: { in: ids.slice(0, 100) } }, select: { id: true } });
  await db.store.update({ where: { id: storeId }, data: { salesDepartmentIds: valid.map((d) => d.id) } });
}

export async function salesTeamUserIds(scope: StoreScope): Promise<string[]> {
  const depts = new Set((await salesDepartments(scope)).serviceIds);
  const storeIds = scope.kind === 'single' ? [scope.storeId] : scope.storeIds;
  const people = await db.user.findMany({
    where: { isActive: true, storeRoles: { some: { storeId: { in: storeIds } } } },
    select: { id: true, departmentId: true, storeRoles: { where: { storeId: { in: storeIds } }, select: { role: { select: { name: true } } } } },
    take: LIST_MAX_ROWS,
  });
  return people.filter((p) => isSalesTeamMember(p.departmentId, p.storeRoles.map((r) => r.role.name), depts)).map((p) => p.id);
}

/**
 * Everyone on the service team in scope (27 Sep 2026): a service department
 * (above) or a technician-type role - the same test the Assign technician
 * list uses (lib/technicians). Call Logs' "Service team" view reads it.
 */
export async function serviceTeamUserIds(scope: StoreScope): Promise<string[]> {
  const depts = new Set((await serviceDepartments(scope)).serviceIds);
  const storeIds = scope.kind === 'single' ? [scope.storeId] : scope.storeIds;
  const people = await db.user.findMany({
    where: { isActive: true, storeRoles: { some: { storeId: { in: storeIds } } } },
    select: { id: true, departmentId: true, storeRoles: { where: { storeId: { in: storeIds } }, select: { role: { select: { name: true } } } } },
    take: LIST_MAX_ROWS,
  });
  return people.filter((p) => isServiceTeamMember(p.departmentId, p.storeRoles.map((r) => r.role.name), depts)).map((p) => p.id);
}
