import type { AssignablePerson } from '@/lib/technicians';

/**
 * The options of an "Assign technician" select: the service team first, then
 * everyone else (lib/technicians). A group with nobody in it is left out;
 * with no service team at all, the list is simply everyone.
 */
export function TechnicianOptions({ technicians }: { technicians: AssignablePerson[] }) {
  const team = technicians.filter((t) => t.serviceTeam);
  const others = technicians.filter((t) => !t.serviceTeam);
  const opts = (list: AssignablePerson[]) => list.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>);
  if (team.length === 0) return <>{opts(others)}</>;
  return (
    <>
      <optgroup label="Service team">{opts(team)}</optgroup>
      {others.length > 0 && <optgroup label="Other staff">{opts(others)}</optgroup>}
    </>
  );
}
