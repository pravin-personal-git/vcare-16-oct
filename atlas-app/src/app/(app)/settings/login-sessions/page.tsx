import { requireContext } from '@/server/context';
import { getSessionToken } from '@/server/auth/session';
import { listSessions, listPairedDevices } from '@/server/administration';
import { SessionsClient } from './SessionsClient';

export default async function LoginSessionsPage() {
  const ctx = await requireContext();
  const token = await getSessionToken();
  const [sessions, devices] = await Promise.all([
    listSessions(ctx.organization.id, token),
    listPairedDevices(ctx.organization.id),
  ]);

  return (
    <SessionsClient
      sessions={sessions}
      devices={devices.map((d) => ({ ...d, pairedAt: d.pairedAt.toISOString(), lastSyncedAt: d.lastSyncedAt?.toISOString() ?? null }))}
      canEdit={ctx.permissions.has('users.edit')}
    />
  );
}
