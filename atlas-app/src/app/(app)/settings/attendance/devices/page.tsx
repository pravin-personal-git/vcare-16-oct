import { requireContext } from '@/server/context';
import { listDevices } from '@/server/attendance-devices';
import { listZones } from '@/server/attendance-policy';
import { adapterChoices, listDeviceVendors } from '@/server/attendance-capture/setup';
import { captureHealth, mappingQueue } from '@/server/attendance-capture/mapping';
import { ADAPTERS } from '@/lib/attendance-capture/registry';
import { DevicesClient } from './DevicesClient';
import { CaptureSetup } from './CaptureSetup';

export default async function AttendanceDevicesPage() {
  const ctx = await requireContext();
  const { scope } = ctx;
  const scopeIsAll = scope.kind === 'all';
  const canManage = ctx.permissions.has('attendance.edit') && !scopeIsAll;

  const [devices, zones] = await Promise.all([
    listDevices(scope),
    scopeIsAll ? Promise.resolve([]) : listZones(scope.storeId),
  ]);

  /**
   * The capture half only exists once a branch is chosen - a machine, its
   * employee codes and its health all belong to one branch, and "All Company"
   * has no sensible answer for any of them.
   */
  const [vendors, health, queue] = scopeIsAll
    ? [[], [], { codes: [], users: [], mappedCount: 0 }]
    : await Promise.all([listDeviceVendors(scope), captureHealth(scope), mappingQueue(scope)]);

  return (
    <div className="grid gap-4">
      <DevicesClient
        devices={devices.map((d) => ({
          ...d,
          lastPunchAt: d.lastPunchAt?.toISOString() ?? null,
          lastCalledAt: d.lastCalledAt?.toISOString() ?? null,
          createdAt: d.createdAt.toISOString(),
        }))}
        zones={zones.map((z) => ({ id: z.id, label: z.label }))}
        canManage={canManage}
        scopeIsAll={scopeIsAll}
      />

      {!scopeIsAll && (
        <CaptureSetup
          devices={vendors.map((v) => ({
            id: v.id, label: v.label, vendor: v.vendor, vendorLabel: v.vendorLabel,
            transport: v.transport, directionMode: v.directionMode, config: v.config,
          }))}
          choices={adapterChoices()}
          /**
           * Field definitions travel to the client so the form can be drawn
           * from the registry rather than hard-coded per vendor - the same
           * reason Settings > Customisation is generated. Only labels and
           * placeholders cross; no value ever does.
           */
          fieldsByVendor={Object.fromEntries(
            ADAPTERS.map((a) => [a.vendor, a.fields.map((f) => ({
              key: f.key, label: f.label, secret: f.secret ?? false, placeholder: f.placeholder,
            }))]),
          )}
          health={health.map((h) => ({
            ...h,
            lastPunchAt: h.lastPunchAt?.toISOString() ?? null,
            lastCalledAt: h.lastCalledAt?.toISOString() ?? null,
            agent: {
              ...h.agent,
              seenAt: h.agent.seenAt?.toISOString() ?? null,
              testRequestedAt: h.agent.testRequestedAt?.toISOString() ?? null,
            },
          }))}
          queue={{
            codes: queue.codes.map((c) => ({
              ...c,
              firstSeen: c.firstSeen.toISOString(),
              lastSeen: c.lastSeen.toISOString(),
            })),
            users: queue.users,
            mappedCount: queue.mappedCount,
          }}
          canManage={canManage}
        />
      )}
    </div>
  );
}
