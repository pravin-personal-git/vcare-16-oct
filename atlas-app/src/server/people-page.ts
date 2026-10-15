import 'server-only';
import { db } from './db';
import { userInScope, type StoreScope } from './store-scope';
import { accessReport, type AccessChange, type AccessPerson, type AccessReport } from './access-report';

/**
 * PEOPLE - ONE PERSON, ONE PLACE (B3 part 1, 11 Oct 2026). Read only.
 *
 * A person was four screens: User List (login), User store roles (branches),
 * Employees (record) and the menu / phone overrides. This puts them side by
 * side, on top of the Access check report (server/access-report.ts) so "what
 * they can do" here is the same answer as there. Changing anything still
 * happens on the screen that owns it - each tab links to it. The guided
 * "Add a person" and "See as this person" wait on Pravin's OK
 * (09-documentation/03-specs/PEOPLE-PAGE-SPEC.md parts 2 and 3).
 */

export interface PersonExtra {
  mobile: string | null;
  email: string | null;
  department: string | null;
  branches: { name: string; roles: string[] }[];
  phonePaired: { device: string | null; lastUsedAt: string | null }[];
  employee: { joined: string | null; type: string; exited: string | null } | null;
  team: { id: string; name: string }[];
}

export interface PeopleDirectory {
  report: AccessReport;
  extra: Record<string, PersonExtra>;
}

export async function peopleDirectory(
  scope: StoreScope,
  organizationId: string,
  plan: { excludedModules: ReadonlySet<string>; excludedPages: ReadonlySet<string> },
): Promise<PeopleDirectory | null> {
  const report = await accessReport(scope, organizationId, plan);
  if (!report) return null;
  const ids = report.people.map((p) => p.id);
  const now = new Date();

  const [users, roles, phones, employees, team] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids } }, select: { id: true, phone: true, email: true, department: { select: { name: true } } } }),
    db.userStoreRole.findMany({
      where: { userId: { in: ids }, store: { organizationId } },
      select: { userId: true, store: { select: { name: true } }, role: { select: { name: true } } },
    }),
    db.mobileRefreshToken.findMany({
      where: { userId: { in: ids }, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastUsedAt: 'desc' },
      select: { userId: true, deviceLabel: true, lastUsedAt: true },
    }),
    db.employeeProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, dateOfJoining: true, employmentType: true, exitDate: true } }),
    db.user.findMany({ where: { reportsToId: { in: ids }, isActive: true, ...userInScope(scope) }, orderBy: { fullName: 'asc' }, select: { id: true, fullName: true, reportsToId: true } }),
  ]);

  const extra: Record<string, PersonExtra> = {};
  for (const u of users) {
    const byStore = new Map<string, string[]>();
    for (const r of roles.filter((x) => x.userId === u.id)) byStore.set(r.store.name, [...(byStore.get(r.store.name) ?? []), r.role.name]);
    const e = employees.find((x) => x.userId === u.id);
    extra[u.id] = {
      mobile: u.phone,
      email: u.email,
      department: u.department?.name ?? null,
      branches: [...byStore].map(([name, rs]) => ({ name, roles: rs.sort() })).sort((a, b) => a.name.localeCompare(b.name)),
      phonePaired: phones.filter((p) => p.userId === u.id).map((p) => ({ device: p.deviceLabel, lastUsedAt: p.lastUsedAt?.toISOString() ?? null })),
      employee: e ? { joined: e.dateOfJoining?.toISOString() ?? null, type: e.employmentType, exited: e.exitDate?.toISOString() ?? null } : null,
      team: team.filter((t) => t.reportsToId === u.id).map((t) => ({ id: t.id, name: t.fullName })),
    };
  }
  return { report, extra };
}

/** The access changes that name this person. */
export function changesAbout(person: AccessPerson, changes: AccessChange[]): AccessChange[] {
  return changes.filter((c) => c.detail.includes(person.name));
}
