/**
 * ONE SHAPE FOR EVERY ATTENDANCE MACHINE (F2.5, ATTENDANCE-CAPTURE-SPEC.md).
 *
 * WHY A CONTRACT AND NOT A ZKTECO INTEGRATION.
 *
 * Vcare handed us a ZKTeco BioTime manual. The next client will have eSSL, or
 * Hikvision, or a Matrix box somebody's cousin installed, and D8 plans for 20+
 * clients in six months. A ZKTeco integration would be rewritten four times.
 *
 * So the vendor lives in an adapter and nothing else knows its name. An adapter
 * turns whatever the machine's software offers into `NormalisedPunch[]`, and
 * from that point the code is identical for every brand. Adding a vendor is one
 * file - a config object and a function - never a project.
 *
 * WHAT THE MACHINE IS NOT.
 *
 * We never talk to the reader itself. The reader talks to its own software
 * (BioTime, eTimeTrack, ISAPI on the device) and we talk to THAT. So we never
 * hold a fingerprint or a face template, and cannot: those never leave the
 * vendor's system. Under DPDP 2023 that keeps Atlas out of the business of
 * processing biometric data for twenty clients, which is a legal position
 * worth protecting deliberately rather than by luck.
 */

/** How a vendor's data reaches us. */
export type Transport =
  /** We ask, on a schedule. ZKTeco BioTime: `GET /iclock/api/transactions/`. */
  | 'pull'
  /** It tells us, as it happens. Hikvision ISAPI event push. */
  | 'push'
  /** Somebody drops a file, or the vendor emails one nightly. */
  | 'file'
  /** Our own phone app. No vendor at all. */
  | 'device';

/**
 * How to decide whether a punch is an arrival or a departure.
 *
 * `from_state` trusts the vendor's own in/out flag. `first_last` ignores it and
 * treats the first punch of a person's day as arrival and the last as
 * departure.
 *
 * THE SECOND ONE IS NOT A FALLBACK, IT IS THE COMMON CASE. At most Indian
 * sites nobody presses IN or OUT - they touch the reader and walk. Every punch
 * then arrives with the same state code, and a system that trusts the flag
 * records forty arrivals and no departures. The old `ingestPunches` rejected an
 * unrecognised direction outright, which on such a site would have dropped
 * 100% of punches.
 */
export type DirectionMode = 'from_state' | 'first_last';

export type PunchDirection = 'in' | 'out';

/** What every adapter must produce, whatever it was given. */
export interface NormalisedPunch {
  /**
   * The employee code as the VENDOR knows it. Mapped to a person later - a
   * punch for somebody we cannot place is kept and queued, never dropped,
   * because the alternative is attendance that silently disappears.
   */
  employeeCode: string;

  /** UTC. Adapters convert; nothing downstream guesses a timezone. */
  atUtc: Date;

  /**
   * Null means "the vendor did not say, or we do not trust what it said" -
   * resolved later by `first_last`. Deliberately nullable rather than defaulted
   * to `in`: a wrong guess here is a wrong day's hours.
   */
  direction: PunchDirection | null;

  /** Fingerprint, face, card, password... free text; vendors do not agree. */
  verifyType?: string | null;

  /** The reader, as the vendor identifies it - a serial number, usually. */
  terminalRef?: string | null;

  /**
   * The vendor's own id for this punch, where it has one.
   *
   * This is what makes re-sending a batch safe. Without it the only natural key
   * is (device, employee, time), which is almost always right and is wrong for
   * exactly the case that matters: two people punching in the same second on
   * the same reader.
   */
  externalId?: string | null;

  /** Everything the vendor sent, kept for when a punch is disputed. */
  raw?: unknown;
}

/** A page of punches, plus where to resume. */
export interface PunchBatch {
  punches: NormalisedPunch[];
  /**
   * Opaque to everything except the adapter that made it. An id for vendors
   * with a monotonic key, a timestamp for those without.
   */
  nextCursor: string | null;
  /** More waiting right now - keep pulling rather than waiting for the timer. */
  hasMore: boolean;
}

/** One reader, as the vendor describes it. Free health monitoring. */
export interface TerminalHealth {
  ref: string;
  name?: string | null;
  online?: boolean | null;
  lastSeenAt?: Date | null;
  punchCount?: number | null;
}

/** A person in the vendor's system, for mapping against Atlas users. */
export interface VendorEmployee {
  employeeCode: string;
  name?: string | null;
  department?: string | null;
}

/** What a vendor needs to be talked to. Never stored in the repo. */
export interface VendorCredentials {
  baseUrl?: string;
  username?: string;
  password?: string;
  token?: string;
  [key: string]: string | undefined;
}

export interface AdapterContext {
  credentials: VendorCredentials;
  /**
   * The reader's clock offset from real time, in minutes.
   *
   * Punch machines are set once at install and almost never NTP-synced again -
   * the `AttendanceDevice.timezoneOffsetMinutes` comment has said so since
   * September. Recorded and applied, not silently corrected, so a reader that
   * is forty minutes fast is visible rather than absorbed.
   */
  clockOffsetMinutes: number;
  /** Where the last pull stopped. */
  cursor: string | null;
  /**
   * Re-read this far back as well as from the cursor.
   *
   * A reader that lost network yesterday uploads today: its punches carry
   * YESTERDAY's time but arrive now. A cursor on punch time alone would step
   * straight over them and they would be lost for good.
   */
  overlapMinutes: number;
  fetch?: typeof globalThis.fetch;
}

export interface VendorAdapter {
  vendor: string;
  label: string;
  transport: Transport;
  /** One line for the device-setup screen. */
  hint: string;
  /** What setup must collect. `secret: true` never renders in plain sight. */
  fields: { key: string; label: string; secret?: boolean; placeholder?: string }[];
  /** What this adapter can do beyond punches - drives what the UI offers. */
  capabilities: { health: boolean; employees: boolean };

  /** `pull` and `file` only. */
  fetchPunches?(ctx: AdapterContext): Promise<PunchBatch>;
  /** `push` only: turn one delivered payload into punches. */
  parsePush?(body: unknown, ctx: AdapterContext): NormalisedPunch[];
  listTerminals?(ctx: AdapterContext): Promise<TerminalHealth[]>;
  listEmployees?(ctx: AdapterContext): Promise<VendorEmployee[]>;
}

/**
 * A punch's natural key, for refusing a duplicate.
 *
 * Prefers the vendor's own id. Falls back to device + person + second, which is
 * right except when two people punch the same reader in the same second - so
 * `externalId` is used wherever a vendor provides one.
 */
export function punchKey(deviceId: string, p: NormalisedPunch): string {
  return p.externalId
    ? `${deviceId}:x:${p.externalId}`
    : `${deviceId}:t:${p.employeeCode}:${Math.floor(p.atUtc.getTime() / 1000)}`;
}
