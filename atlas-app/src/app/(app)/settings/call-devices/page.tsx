import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { getCaptureMode, listDevices } from '@/server/call-logs';
import { checkPhoneHealth } from '@/server/phone-health';
import { scopeWhere } from '@/server/store-scope';
import { DevicesClient } from './DevicesClient';
import { canPairPhones } from '@/lib/device-trust';

export default async function CallDevicesPage() {
  const ctx = await requireContext();
  // Records phones that went quiet or came back (CALL-5) before listing.
  await checkPhoneHealth(ctx.scope).catch(() => null);

  const scopeIsAll = ctx.scope.kind === 'all';

  const [devices, users, captureMode] = await Promise.all([
    listDevices(ctx.scope),
    db.user.findMany({
      where: { storeRoles: { some: { ...scopeWhere(ctx.scope) } }, isActive: true },
      select: { id: true, fullName: true, username: true },
      orderBy: { fullName: 'asc' },
    }),
    // Capture mode is a per-store setting, so All Company has no answer.
    scopeIsAll ? Promise.resolve('crm_only' as const) : getCaptureMode(ctx.scope),
  ]);

  return (
    <DevicesClient
      devices={devices.map((d) => ({
        ...d,
        lastSyncedAt: d.lastSyncedAt?.toISOString() ?? null,
        lastCallAt: d.lastCallAt?.toISOString() ?? null,
        pairedAt: d.pairedAt.toISOString(),
        pairingExpiresAt: d.pairingExpiresAt?.toISOString() ?? null,
      }))}
      users={users.map((u) => ({ id: u.id, name: u.fullName, username: u.username }))}
      captureMode={captureMode}
      canManage={!scopeIsAll && canPairPhones(ctx.permissions)}
      scopeIsAll={scopeIsAll}
    />
  );
}
