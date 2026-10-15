import 'server-only';
import { db } from '../db';
import { scopeWhere, scopeForWrite, type StoreScope } from '../store-scope';
import { AttendanceDeviceError } from '../attendance-devices';
import { requireAdapter, adapterChoices } from '@/lib/attendance-capture/registry';
import type { DirectionMode } from '@/lib/attendance-capture/contract';

/**
 * Setting a machine up, and telling the connector what it needs (F2.5).
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: A VENDOR PASSWORD IS NEVER STORED HERE.
 *
 * It is tempting to put the BioTime login in `AttendanceDevice.config` - the
 * setup form is right there and it would "just work". It must not. AGENTS.md
 * §6 says client credentials live only in the password manager, never in
 * files, commits or logs, and a database column is all three eventually: it
 * lands in a backup, a `SELECT *` in a support session, an audit row.
 *
 * So the split is: everything the adapter marks `secret` goes into the
 * connector agent's own config file on the office PC, where it never leaves
 * the client's network. Everything else - a base URL, CSV column names - is
 * ordinary configuration and lives here. `assertNoSecrets` makes the mistake
 * impossible rather than discouraged.
 */

export { adapterChoices };

/** Non-secret adapter settings, as stored. */
export type DeviceConfig = Record<string, string>;

/**
 * Refuse anything the adapter calls secret.
 *
 * Throws rather than stripping silently: an admin who typed a password into
 * the wrong box must be told, or they will believe it was saved and that the
 * connector is configured when it is not.
 */
export function assertNoSecrets(vendor: string, config: DeviceConfig): void {
  const adapter = requireAdapter(vendor);
  const secret = new Set(adapter.fields.filter((f) => f.secret).map((f) => f.key));
  const offending = Object.keys(config).filter((k) => secret.has(k));
  if (offending.length > 0) {
    throw new AttendanceDeviceError(
      `${offending.join(' and ')} must not be saved here. Put it in the connector's own settings `
      + 'on the office computer - passwords are never stored in Atlas.',
    );
  }
}

const DIRECTION_MODES: readonly DirectionMode[] = ['from_state', 'first_last'];

export interface VendorSetupInput {
  vendor: string;
  directionMode: DirectionMode;
  config: DeviceConfig;
}

export async function setDeviceVendor(
  scope: StoreScope, deviceId: string, input: VendorSetupInput,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const adapter = requireAdapter(input.vendor);

  if (!DIRECTION_MODES.includes(input.directionMode)) {
    throw new AttendanceDeviceError('That in/out setting is not one we know.');
  }
  assertNoSecrets(input.vendor, input.config);

  // Only keys the adapter actually declares, so a stale field from a vendor
  // switch does not sit in the row pretending to mean something.
  const known = new Set(adapter.fields.map((f) => f.key));
  const clean: DeviceConfig = {};
  for (const [k, v] of Object.entries(input.config)) {
    if (known.has(k) && typeof v === 'string' && v.trim()) clean[k] = v.trim();
  }

  const updated = await db.attendanceDevice.updateMany({
    where: { id: deviceId, storeId },
    data: {
      vendor: input.vendor,
      directionMode: input.directionMode,
      config: clean,
      // A vendor change invalidates where the last pull stopped - the new
      // adapter's cursor means something else entirely.
      cursor: null,
    },
  });
  if (updated.count === 0) throw new AttendanceDeviceError('That device is not in your branch.');
}

export interface ConnectorPlan {
  vendor: string;
  label: string;
  transport: string;
  /** What the admin must put in the connector's own config, on the office PC. */
  secretFields: { key: string; label: string }[];
  /** Settings that are stored here and the connector can simply read. */
  storedConfig: DeviceConfig;
  /** Plain-English next steps for whoever is installing it. */
  steps: string[];
}

/**
 * What to do next, once a vendor is chosen.
 *
 * Written as instructions rather than a spec because the person doing this is
 * usually an office admin with a vendor engineer on the phone, not a
 * developer.
 */
export function connectorPlan(vendor: string, config: DeviceConfig): ConnectorPlan {
  const adapter = requireAdapter(vendor);
  const secretFields = adapter.fields.filter((f) => f.secret).map((f) => ({ key: f.key, label: f.label }));

  const steps: string[] = [];
  if (adapter.transport === 'pull') {
    steps.push(
      'Install the Atlas connector on a computer in the office that is left switched on.',
      'Paste the device token above into the connector, along with the vendor password.',
      'The connector reads the attendance software over your own network and sends it out to Atlas. Nothing is opened up on your internet connection, and no firewall change is needed.',
    );
  } else if (adapter.transport === 'push') {
    steps.push(
      'In the device settings, set the HTTP listening address to the Atlas sync URL.',
      'Paste the device token above as the authorisation header.',
      'The device reaches out to Atlas, so there is nothing to install and nothing to poll.',
    );
  } else if (adapter.transport === 'file') {
    steps.push(
      'Ask the vendor to drop the daily export into a folder on an office computer, or to email it.',
      'Point the Atlas connector at that folder or mailbox.',
      'Check the column names below match the file the vendor actually sends - they vary.',
    );
  } else {
    steps.push('Nothing to install. Staff clock in from the Vcare app and it arrives directly.');
  }

  return {
    vendor: adapter.vendor,
    label: adapter.label,
    transport: adapter.transport,
    secretFields,
    storedConfig: config,
    steps,
  };
}

export interface DeviceVendorRow {
  id: string;
  label: string;
  vendor: string | null;
  vendorLabel: string | null;
  transport: string | null;
  directionMode: string;
  config: DeviceConfig;
  clockSkewSeconds: number | null;
  lastSkewCheckedAt: Date | null;
  cursor: string | null;
}

export async function listDeviceVendors(scope: StoreScope): Promise<DeviceVendorRow[]> {
  const rows = await db.attendanceDevice.findMany({
    where: { ...scopeWhere(scope), isActive: true },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, label: true, vendor: true, directionMode: true, config: true,
      clockSkewSeconds: true, lastSkewCheckedAt: true, cursor: true,
    },
  });

  return rows.map((r) => {
    let vendorLabel: string | null = null;
    let transport: string | null = null;
    if (r.vendor) {
      try {
        const a = requireAdapter(r.vendor);
        vendorLabel = a.label;
        transport = a.transport;
      } catch {
        // A vendor removed from the registry should not break the screen -
        // show the raw name so somebody can pick a new one.
        vendorLabel = r.vendor;
      }
    }
    const cfg = (r.config && typeof r.config === 'object' && !Array.isArray(r.config))
      ? (r.config as DeviceConfig) : {};
    return { ...r, vendorLabel, transport, config: cfg };
  });
}
