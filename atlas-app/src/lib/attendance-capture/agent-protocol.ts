/**
 * WHAT ATLAS AND THE OFFICE CONNECTOR SAY TO EACH OTHER (9 Oct 2026).
 *
 * The connector runs on a client's back-office PC that nobody should have to
 * touch twice. Vcare's first install showed why: a clock offset left at 0 and
 * a startup task that could not find its own config, and the only way to see
 * either was to ask the client for their PC again. So everything that can
 * change after install lives in Atlas and travels to the connector on every
 * check-in:
 *
 *   - SETTINGS  (clock offset, how often to poll, how far back to re-read)
 *   - UPDATES   (a newer connector, with a SHA-256 the connector verifies)
 *   - TEST NOW  (a flag; the connector runs a test poll and reports back)
 *
 * and everything Atlas needs to see comes back as a STATUS REPORT after each
 * poll - alive, version, punches BioTime returned, the exact error if any.
 *
 * Pure and shared: the connector bundles this file, the server imports it.
 * The vendor password is NOT part of any of this - it stays in the config
 * file on the client's PC (AGENTS.md section 6).
 */

export interface AgentSettings {
  /**
   * How far the reader's clock is off real time, in minutes - 0 for a clock
   * that is right. NOT the timezone: India time is applied by the adapter
   * both ways (`parseVendorTime`, `vendorStamp`). Putting 330 here would move
   * every punch five and a half hours.
   */
  clockOffsetMinutes: number;
  /** Seconds between polls. */
  pollSeconds: number;
  /** How far before the cursor to re-read, for a reader that was offline. */
  overlapMinutes: number;
}

/** A device with no saved settings gets these. */
export const AGENT_SETTINGS_DEFAULTS: AgentSettings = {
  clockOffsetMinutes: 0,
  pollSeconds: 300,
  overlapMinutes: 2880,
};

export const AGENT_SETTINGS_LIMITS = {
  clockOffsetMinutes: { min: -720, max: 840 },
  pollSeconds: { min: 60, max: 3600 },
  overlapMinutes: { min: 0, max: 10_080 },
} as const;

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

/** Whatever was stored or sent, as settings the connector can safely use. */
export function cleanAgentSettings(v: unknown): AgentSettings {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const L = AGENT_SETTINGS_LIMITS;
  const D = AGENT_SETTINGS_DEFAULTS;
  return {
    clockOffsetMinutes: clampInt(o.clockOffsetMinutes, L.clockOffsetMinutes.min, L.clockOffsetMinutes.max, D.clockOffsetMinutes),
    pollSeconds: clampInt(o.pollSeconds, L.pollSeconds.min, L.pollSeconds.max, D.pollSeconds),
    overlapMinutes: clampInt(o.overlapMinutes, L.overlapMinutes.min, L.overlapMinutes.max, D.overlapMinutes),
  };
}

/** A connector build Atlas offers. `url` is absolute in the check-in reply. */
export interface AgentRelease {
  version: string;
  sha256: string;
  /** Path under Atlas's public folder, e.g. /attendance-agent/agent-1.1.0.js */
  path: string;
}

/** What the connector sends after every poll (and after a requested test). */
export interface AgentStatusReport {
  version: string;
  /** When the poll finished, ISO. */
  at: string;
  ok: boolean;
  /** Punches the vendor returned this poll. */
  received: number;
  stored: number;
  applied: number;
  unmapped: number;
  /** The exact failure, in one line, when `ok` is false. */
  error: string | null;
  /** Present only when this report answers a "Test now". */
  test?: AgentTestResult;
}

export interface AgentTestResult {
  ok: boolean;
  /** Could it log in to the vendor at all. */
  vendorReachable: boolean;
  /** Punches the vendor holds for the last seven days. */
  punchesLast7Days: number | null;
  /** The newest punch it saw, ISO. */
  newestPunchAt: string | null;
  terminals: { serial: string; alias: string | null; lastSeenAt: string | null }[];
  error: string | null;
}

/** "1.10.0" > "1.9.2". Non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

/** A status report from the wire - every field still untrusted. */
export function parseStatusReport(v: unknown): AgentStatusReport | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const version = str(o.version, 32);
  if (!version) return null;
  const at = typeof o.at === 'string' && !Number.isNaN(Date.parse(o.at)) ? new Date(o.at).toISOString() : new Date().toISOString();
  const report: AgentStatusReport = {
    version,
    at,
    ok: o.ok === true,
    received: int(o.received),
    stored: int(o.stored),
    applied: int(o.applied),
    unmapped: int(o.unmapped),
    error: str(o.error, 500),
  };
  if (o.test && typeof o.test === 'object') {
    const t = o.test as Record<string, unknown>;
    report.test = {
      ok: t.ok === true,
      vendorReachable: t.vendorReachable === true,
      punchesLast7Days: typeof t.punchesLast7Days === 'number' ? int(t.punchesLast7Days) : null,
      newestPunchAt: typeof t.newestPunchAt === 'string' && !Number.isNaN(Date.parse(t.newestPunchAt)) ? t.newestPunchAt : null,
      terminals: Array.isArray(t.terminals)
        ? t.terminals.slice(0, 50).flatMap((x) => {
          if (!x || typeof x !== 'object') return [];
          const r = x as Record<string, unknown>;
          const serial = str(r.serial, 64);
          return serial ? [{ serial, alias: str(r.alias, 100), lastSeenAt: str(r.lastSeenAt, 40) }] : [];
        })
        : [],
      error: str(t.error, 500),
    };
  }
  return report;
}
