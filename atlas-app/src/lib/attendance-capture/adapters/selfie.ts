import type { NormalisedPunch, VendorAdapter } from '../contract';

/**
 * The phone's own front camera (F2.5, decision D14).
 *
 * NOT A FACE SCAN, AND THE DIFFERENCE IS THE WHOLE POINT.
 *
 * A photo is taken at clock-in, stamped with the GPS fix the app already
 * captures, and shown to the supervisor beside the attendance row. There is no
 * enrolment, no template, and no matching - so Atlas stores no biometric data
 * at all.
 *
 * That is a decision, not a shortcut. Under DPDP 2023 a face template is
 * sensitive personal data; holding one for twenty clients would make us its
 * processor, with consent, purpose-limitation and breach duties attached. A
 * timestamped photo inside a geofence delivers most of the deterrence for none
 * of that exposure - and unlike a matcher it cannot lock a genuine employee
 * out because the light was bad.
 *
 * It also works with no vendor at all, which makes it the answer when a
 * biometric company says no. That is why it is in this registry rather than
 * living off on its own: from the ingest pipeline's point of view a selfie
 * punch and a ZKTeco punch are the same thing.
 */
export const selfie: VendorAdapter = {
  vendor: 'selfie',
  label: 'Phone selfie + location',
  transport: 'device',
  hint: 'Staff clock in on their phone; it takes a photo and checks they are at the office or the job. No machine, no vendor, no face data stored.',
  fields: [],
  capabilities: { health: false, employees: false },

  /**
   * The phone posts one punch at a time through the existing paired-device
   * route, so this only has to shape what arrived. The geofence and the
   * mock-location check have already run in `server/attendance-mobile.ts` -
   * they are not repeated here, because two implementations of a location rule
   * is how the two drift apart.
   */
  parsePush(body: unknown): NormalisedPunch[] {
    if (!body || typeof body !== 'object') return [];
    const o = body as Record<string, unknown>;

    const code = String(o.employeeCode ?? o.userCode ?? '').trim();
    const at = typeof o.at === 'number' ? new Date(o.at)
      : typeof o.at === 'string' ? new Date(o.at)
        : null;
    if (!code || !at || Number.isNaN(at.getTime())) return [];

    const dir = o.direction === 'out' ? 'out' : o.direction === 'in' ? 'in' : null;

    return [{
      employeeCode: code,
      atUtc: at,
      direction: dir,
      verifyType: 'selfie',
      terminalRef: typeof o.deviceId === 'string' ? o.deviceId : null,
      // The phone's own queue id, so a punch sent twice after a flaky
      // connection is recognised rather than counted twice.
      externalId: typeof o.clientId === 'string' ? o.clientId : null,
      raw: body,
    }];
  },
};
