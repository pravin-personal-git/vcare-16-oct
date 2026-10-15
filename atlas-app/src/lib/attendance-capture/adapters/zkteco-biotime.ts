import type {
  AdapterContext, NormalisedPunch, PunchBatch, TerminalHealth, VendorAdapter, VendorEmployee,
} from '../contract';
import { directionFromState, parseVendorTime } from '../normalise';
import { BUSINESS_TZ } from '../../shift';

/**
 * ZKTeco BioTime 8.0 (F2.5).
 *
 * Source: "ETP API User Manual 3", ZKTeco CO., LTD, supplied by Vcare on
 * 29 Sep 2026. Filed in `08-reference/`.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * This is the API of BioTime 8.0 - the WINDOWS SOFTWARE that sits behind the
 * readers - not of a reader. The readers push to BioTime over ZK's own
 * protocol and we read BioTime. So:
 *
 *   - no fingerprint or face template ever reaches us; they stay in BioTime;
 *   - the server is normally a PC on the office LAN (192.168.x.x:8090), which
 *     Vercel cannot reach - hence the connector agent, which runs on that LAN
 *     and pushes outward;
 *   - there is NO WEBHOOK anywhere in the manual. §10 is a GET and nothing
 *     else. This vendor must be polled, and anyone who "adds a callback" later
 *     has misread the document.
 *
 * `punch_time` carries no timezone - it is the BioTime server's wall clock -
 * and `punch_time` is not `upload_time`: a reader offline for a day uploads
 * yesterday's punches today. Both are handled, and both would silently lose
 * attendance if they were not.
 */

interface BioTimeTransaction {
  id?: number;
  emp_code?: string;
  punch_time?: string;
  punch_state?: string;
  verify_type?: number | string;
  terminal_sn?: string;
  upload_time?: string;
}

/** §2: `POST /api-token-auth/` -> `Authorization: Token <t>`. JWT is the same shape. */
async function authHeader(ctx: AdapterContext): Promise<Record<string, string>> {
  const f = ctx.fetch ?? globalThis.fetch;
  const base = (ctx.credentials.baseUrl ?? '').replace(/\/+$/, '');

  if (ctx.credentials.token) {
    return { 'Content-Type': 'application/json', Authorization: `Token ${ctx.credentials.token}` };
  }

  const res = await f(`${base}/api-token-auth/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ctx.credentials.username, password: ctx.credentials.password }),
  });
  if (!res.ok) throw new Error(`BioTime refused the login (HTTP ${res.status}).`);

  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error('BioTime accepted the login but returned no token.');
  return { 'Content-Type': 'application/json', Authorization: `Token ${body.token}` };
}

/**
 * BioTime wants `YYYY-MM-DD HH:MM:SS` in its own local time.
 *
 * The exact inverse of `parseVendorTime`: the business timezone, then the
 * reader's skew. Until 9 Oct 2026 this wrote UTC, so every window asked for
 * ended five and a half hours before "now" - a connector polling every five
 * minutes never asked for the morning's punches until the afternoon, and
 * Vcare's single test poll found nothing at all.
 */
export function vendorStamp(at: Date, offsetMinutes: number): string {
  const shifted = new Date(at.getTime() + offsetMinutes * 60_000);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(shifted);
  const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${v('year')}-${v('month')}-${v('day')} ${v('hour')}:${v('minute')}:${v('second')}`;
}

export const zktecoBioTime: VendorAdapter = {
  vendor: 'zkteco_biotime',
  label: 'ZKTeco BioTime 8.0',
  transport: 'pull',
  hint: 'The BioTime server on the office network - usually http://<pc-ip>:8090. Needs a login; a read-only one is enough.',
  fields: [
    { key: 'baseUrl', label: 'BioTime address', placeholder: 'http://192.168.1.50:8090' },
    { key: 'username', label: 'Username' },
    { key: 'password', label: 'Password', secret: true },
  ],
  capabilities: { health: true, employees: true },

  async fetchPunches(ctx: AdapterContext): Promise<PunchBatch> {
    const f = ctx.fetch ?? globalThis.fetch;
    const base = (ctx.credentials.baseUrl ?? '').replace(/\/+$/, '');
    const headers = await authHeader(ctx);

    /**
     * Window start. The cursor is a timestamp, pulled back by `overlapMinutes`
     * - a reader that was offline uploads punches stamped BEFORE the cursor,
     * and a strict `>` would step over them and lose them permanently.
     * Re-reading a window is free because ingest de-duplicates.
     */
    const from = ctx.cursor
      ? new Date(Date.parse(ctx.cursor) - ctx.overlapMinutes * 60_000)
      : new Date(Date.now() - 7 * 86_400_000);
    const to = new Date(Date.now() + 60_000);

    const params = new URLSearchParams({
      start_time: vendorStamp(from, ctx.clockOffsetMinutes),
      end_time: vendorStamp(to, ctx.clockOffsetMinutes),
      page_size: '500',
    });

    const res = await f(`${base}/iclock/api/transactions/?${params}`, { headers });
    if (!res.ok) throw new Error(`BioTime would not give us punches (HTTP ${res.status}).`);

    const body = (await res.json()) as { data?: BioTimeTransaction[]; next?: string | null };
    const rows = body.data ?? [];

    const punches: NormalisedPunch[] = [];
    let newest = ctx.cursor ? new Date(ctx.cursor) : from;

    for (const r of rows) {
      if (!r.emp_code || !r.punch_time) continue;
      const at = parseVendorTime(r.punch_time, ctx.clockOffsetMinutes);
      if (!at) continue;
      if (at > newest) newest = at;

      punches.push({
        employeeCode: String(r.emp_code).trim(),
        atUtc: at,
        // 0 = check-in, 1 = check-out by ZK convention. Trusted only when the
        // device is set to `from_state`; most sites are not.
        direction: directionFromState(r.punch_state),
        verifyType: r.verify_type != null ? String(r.verify_type) : null,
        terminalRef: r.terminal_sn ? String(r.terminal_sn) : null,
        externalId: r.id != null ? String(r.id) : null,
        raw: r,
      });
    }

    return {
      punches,
      nextCursor: newest.toISOString(),
      hasMore: Boolean(body.next),
    };
  },

  /** §5: `GET /iclock/api/terminals/` - device health, free. */
  async listTerminals(ctx: AdapterContext): Promise<TerminalHealth[]> {
    const f = ctx.fetch ?? globalThis.fetch;
    const base = (ctx.credentials.baseUrl ?? '').replace(/\/+$/, '');
    const res = await f(`${base}/iclock/api/terminals/`, { headers: await authHeader(ctx) });
    if (!res.ok) throw new Error(`BioTime would not list its readers (HTTP ${res.status}).`);

    const body = (await res.json()) as {
      data?: { sn?: string; alias?: string; state?: number; last_activity?: string | null; transaction_count?: number | null }[];
    };

    return (body.data ?? []).map((t) => ({
      ref: String(t.sn ?? ''),
      name: t.alias ?? null,
      online: t.state === 1,
      lastSeenAt: t.last_activity ? parseVendorTime(t.last_activity, ctx.clockOffsetMinutes) : null,
      punchCount: t.transaction_count ?? null,
    }));
  },

  /** §6: `GET /personnel/api/employees/` - the mapping screen's left column. */
  async listEmployees(ctx: AdapterContext): Promise<VendorEmployee[]> {
    const f = ctx.fetch ?? globalThis.fetch;
    const base = (ctx.credentials.baseUrl ?? '').replace(/\/+$/, '');
    const res = await f(`${base}/personnel/api/employees/?page_size=500`, { headers: await authHeader(ctx) });
    if (!res.ok) throw new Error(`BioTime would not list its people (HTTP ${res.status}).`);

    const body = (await res.json()) as {
      data?: { emp_code?: string; first_name?: string; last_name?: string; dept_name?: string }[];
    };

    return (body.data ?? [])
      .filter((e) => e.emp_code)
      .map((e) => ({
        employeeCode: String(e.emp_code),
        name: [e.first_name, e.last_name].filter(Boolean).join(' ').trim() || null,
        department: e.dept_name ?? null,
      }));
  },
};
