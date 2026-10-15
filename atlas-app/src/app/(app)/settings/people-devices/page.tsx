import { redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { peopleAndDevices } from '@/server/people-devices';
import { PeopleDevicesClient } from './PeopleDevicesClient';

/**
 * Settings &gt; People &amp; devices (workstream I).
 *
 * Gated on `users.edit` rather than a view-only permission: the screen exists
 * to act on a lost phone, and its headline control revokes access. Somebody
 * who may not do that has no reason to be reading a list of everybody's
 * devices - that is a surveillance surface, not a report.
 */
export default async function PeopleDevicesPage() {
  const ctx = await requireContext();

  if (!ctx.permissions.has('users.edit')) redirect('/settings/hub');

  if (ctx.scope.kind !== 'single') {
    // Devices belong to a branch. "All Company" has no honest answer for
    // whose phone should appear, and revoking across branches from one button
    // is not something to offer by accident.
    return (
      <PeopleDevicesClient people={[]} canManage={false} />
    );
  }

  const people = await peopleAndDevices(ctx.scope);

  return (
    <PeopleDevicesClient
      canManage
      people={people.map((p) => ({
        ...p,
        lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
        devices: p.devices.map((d) => ({
          ...d,
          lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        })),
      }))}
    />
  );
}
