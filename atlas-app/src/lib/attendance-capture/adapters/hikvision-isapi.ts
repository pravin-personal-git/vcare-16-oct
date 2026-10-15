import type { AdapterContext, NormalisedPunch, VendorAdapter } from '../contract';
import { directionFromState, parseVendorTime } from '../normalise';

/**
 * Hikvision, via ISAPI event notification (F2.5).
 *
 * The opposite shape to ZKTeco, which is exactly why it is the second adapter:
 * two vendors that work the same way would not prove the contract holds.
 *
 * Hikvision devices POST an event to a URL you configure on the device itself
 * ("HTTP Listening"), so there is nothing to poll and no LAN problem - the
 * device reaches out. `parsePush` turns one delivered payload into punches and
 * the rest of the pipeline is identical to ZKTeco's.
 *
 * The payload shape varies by firmware, so this reads defensively and accepts
 * either the wrapped `AccessControllerEvent` or a bare event object.
 */

interface HikEvent {
  employeeNoString?: string;
  employeeNo?: number | string;
  /** Some firmware puts the time on the event, some on the envelope. */
  time?: string;
  dateTime?: string;
  /** 1 = entry, 2 = exit on most firmware; absent on plenty of it. */
  attendanceStatus?: string | number;
  doorNo?: number | string;
  serialNo?: number | string;
  currentVerifyMode?: string;
}

interface HikEnvelope {
  dateTime?: string;
  ipAddress?: string;
  macAddress?: string;
  AccessControllerEvent?: HikEvent;
}

const DIRECTION_MAP = {
  in: ['1', 'checkin', 'entry', 'in', 'breakout'],
  out: ['2', 'checkout', 'exit', 'out', 'breakin'],
};

export const hikvisionIsapi: VendorAdapter = {
  vendor: 'hikvision_isapi',
  label: 'Hikvision (ISAPI event push)',
  transport: 'push',
  hint: 'The device posts each punch to a web address you set on it. Nothing to poll, and nothing to install on the office network.',
  fields: [
    { key: 'sharedSecret', label: 'Shared secret (optional)', secret: true, placeholder: 'Leave blank if the device cannot send one' },
  ],
  capabilities: { health: false, employees: false },

  parsePush(body: unknown, ctx: AdapterContext): NormalisedPunch[] {
    if (!body || typeof body !== 'object') return [];

    // One event, a wrapped event, or a list of either.
    const items: unknown[] = Array.isArray(body) ? body : [body];
    const out: NormalisedPunch[] = [];

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const env = item as HikEnvelope & HikEvent;
      const ev: HikEvent = env.AccessControllerEvent ?? (env as HikEvent);

      const code = String(ev.employeeNoString ?? ev.employeeNo ?? '').trim();
      if (!code) continue;

      const stamp = ev.time ?? ev.dateTime ?? env.dateTime;
      if (!stamp) continue;
      const at = parseVendorTime(String(stamp), ctx.clockOffsetMinutes);
      if (!at) continue;

      out.push({
        employeeCode: code,
        atUtc: at,
        direction: directionFromState(ev.attendanceStatus, DIRECTION_MAP),
        verifyType: ev.currentVerifyMode ?? null,
        terminalRef: env.macAddress ?? env.ipAddress ?? (ev.doorNo != null ? `door-${ev.doorNo}` : null),
        // `serialNo` is per-device and monotonic where present, which makes it
        // a sound natural key. Where it is absent, ingest falls back to
        // device + person + second.
        externalId: ev.serialNo != null ? String(ev.serialNo) : null,
        raw: item,
      });
    }

    return out;
  },
};
