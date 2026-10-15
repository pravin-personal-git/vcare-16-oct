/**
 * Who goes at the top of an "Assign technician" list (27 Sep 2026).
 *
 * The list used to hold ONLY people in a service department. Someone with the
 * Technician role but no department (Deepak) could not be picked at all, and
 * Vcare's old app offered everyone. Now everyone active in the branch can be
 * picked, like most field-service tools; the service team is listed first:
 * people in a service department OR holding a technician-type role.
 */
export const TECHNICIAN_ROLE_WORDS = ['technician', 'engineer', 'field', 'service', 'mechanic', 'installer'];

export function isServiceTeamMember(
  departmentId: string | null,
  roleNames: string[],
  serviceDepartmentIds: ReadonlySet<string>,
): boolean {
  if (departmentId && serviceDepartmentIds.has(departmentId)) return true;
  return roleNames.some((r) => TECHNICIAN_ROLE_WORDS.some((w) => r.toLowerCase().includes(w)));
}

/**
 * The sales side of the same question (8 Oct 2026).
 *
 * Added when Pravin asked for the Sales menu to say "Sales Team Calls".
 * A screen with that name over everybody's calls would be a worse lie than
 * the vague "Call Logs" it replaced, so the sales team is answered the same
 * way the service team already is: a chosen department, or failing that a
 * role whose name says what the person does.
 *
 * The two lists are deliberately disjoint in spirit but not enforced to be.
 * Somebody can genuinely sit in both - a working owner sells and attends
 * site - and a rule that forced a choice would make one of the two screens
 * wrong about them.
 */
export const SALES_ROLE_WORDS = ['sales', 'business development', 'bd', 'marketing', 'counter', 'telecaller'];

export function isSalesTeamMember(
  departmentId: string | null,
  roleNames: string[],
  salesDepartmentIds: ReadonlySet<string>,
): boolean {
  if (departmentId && salesDepartmentIds.has(departmentId)) return true;
  return roleNames.some((r) => SALES_ROLE_WORDS.some((w) => r.toLowerCase().includes(w)));
}

export interface AssignablePerson { id: string; fullName: string; serviceTeam: boolean }

/** Service team first, then everyone else; each part by name. */
export function orderAssignable<T extends AssignablePerson>(people: T[]): T[] {
  return [...people].sort((a, b) =>
    a.serviceTeam === b.serviceTeam ? a.fullName.localeCompare(b.fullName) : a.serviceTeam ? -1 : 1);
}
