import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { deviceFromToken } from '@/server/attendance-devices';
import { ingestNormalisedPunches } from '@/server/attendance-capture/ingest';
import type { DirectionMode, NormalisedPunch } from '@/lib/attendance-capture/contract';
import { cleanAgentSettings, compareVersions } from '@/lib/attendance-capture/agent-protocol';
import { AGENT_RELEASE } from '@/lib/attendance-capture/agent-release';

/**
 * Where the connector agent delivers punches (F2.5).
 *
 * WHY THIS EXISTS BESIDE `/api/attendance/devices/sync`.
 *
 * That route predates the adapter framework and speaks the older
 * `ingestPunches` shape. This one speaks `NormalisedPunch` and goes through
 * `ingestNormalisedPunches`, which is the hardened path: sorted before
 * applying, punch-level natural key so a replay writes nothing, bulk code
 * lookup rather than a query per row, and unmapped codes KEPT and queued
 * rather than dropped. The old route is left alone so anything already
 * pointed at it keeps working.
 *
 * OUTBOUND ONLY, AND THAT IS THE WHOLE POINT.
 *
 * BioTime sits on a private LAN address that Vercel cannot reach. Rather than
 * port-forwarding an unpatched attendance server to the internet - plain HTTP,
 * admin credentials, no firewall change the client's IT would ever approve -
 * the agent runs on a PC inside that LAN and posts here. Nothing inbound.
 *
 * Authenticated by the device's bearer token, not a session: this runs
 * unattended for months and there is nobody to log in again.
 */

const MAX_PUNCHES = 5_000;

function bearer(req: Request): string {
  const h = req.headers.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

/** A revoked agent needs a way to find out it is dead, not post into a 401 forever. */
export async function GET(req: Request) {
  const device = await deviceFromToken(bearer(req));
  if (!device) {
    return NextResponse.json(
      { error: 'This device is not paired, or has been revoked.', paired: false },
      { status: 401 },
    );
  }

  /*
   * THE CHECK-IN (9 Oct 2026). Every poll starts here, so this is where a
   * connector is known to be alive - recorded whether or not it then finds
   * any punches. Before this, a connector getting nothing from BioTime never
   * posted and looked exactly like one that was not running.
   */
  const version = (req.headers.get('x-agent-version') ?? '').trim().slice(0, 32) || null;
  const row = await db.attendanceDevice.update({
    where: { id: device.id },
    data: { agentSeenAt: new Date(), ...(version ? { agentVersion: version } : {}) },
    select: {
      vendor: true, cursor: true, directionMode: true, config: true,
      agentSettings: true, testRequestedAt: true,
    },
  });

  // An older connector than the one Atlas holds is offered the new one, with
  // the hash it must match. One that sent no version (pre-1.1) cannot update
  // itself and is left alone.
  const release = AGENT_RELEASE && version && compareVersions(AGENT_RELEASE.version, version) > 0
    ? { version: AGENT_RELEASE.version, sha256: AGENT_RELEASE.sha256, url: new URL(AGENT_RELEASE.path, req.url).toString() }
    : null;

  return NextResponse.json({
    paired: true,
    serverTime: new Date().toISOString(),
    settings: cleanAgentSettings(row.agentSettings),
    release,
    testRequested: row.testRequestedAt !== null,
    vendor: row?.vendor ?? null,
    /**
     * The cursor lives on the server, not only on the office PC. A reinstalled
     * agent, or one whose disk was wiped, resumes where the last one stopped
     * instead of replaying from the beginning or - far worse - starting from
     * now and silently losing everything in between.
     */
    cursor: row?.cursor ?? null,
    directionMode: row?.directionMode ?? 'first_last',
    config: row?.config ?? null,
  });
}

/** One punch as it arrives over the wire - every field still untrusted. */
function parsePunch(v: unknown): NormalisedPunch | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const code = typeof o.employeeCode === 'string' ? o.employeeCode.trim() : '';
  if (!code) return null;

  const at = typeof o.atUtc === 'string' ? new Date(o.atUtc) : null;
  if (!at || Number.isNaN(at.getTime())) return null;

  const dir = o.direction === 'in' || o.direction === 'out' ? o.direction : null;
  return {
    employeeCode: code,
    atUtc: at,
    direction: dir,
    externalId: typeof o.externalId === 'string' ? o.externalId : null,
    terminalRef: typeof o.terminalRef === 'string' ? o.terminalRef : null,
    raw: o.raw && typeof o.raw === 'object' ? (o.raw as Record<string, unknown>) : undefined,
  } as NormalisedPunch;
}

export async function POST(req: Request) {
  const device = await deviceFromToken(bearer(req));
  if (!device) {
    return NextResponse.json(
      { error: 'This device is not paired, or has been revoked.', paired: false },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !Array.isArray(body.punches)) {
    return NextResponse.json({ error: 'Send { "punches": [...] }.' }, { status: 400 });
  }
  if (body.punches.length > MAX_PUNCHES) {
    return NextResponse.json(
      { error: `Send at most ${MAX_PUNCHES} punches per call.` },
      { status: 413 },
    );
  }

  const row = await db.attendanceDevice.findUnique({
    where: { id: device.id },
    select: { directionMode: true },
  });

  const punches = body.punches.map(parsePunch).filter((p): p is NormalisedPunch => p !== null);

  try {
    const result = await ingestNormalisedPunches(
      {
        id: device.id,
        storeId: device.storeId,
        directionMode: (row?.directionMode ?? 'first_last') as DirectionMode,
        defaultZone: device.defaultZone,
      },
      punches,
    );

    /**
     * The cursor is saved only AFTER the punches are safely stored. Saving it
     * first, or in the same breath, would step the agent past a batch that
     * then failed to write - and those punches would never be asked for again.
     * A replayed batch is harmless (the natural key refuses it); a skipped one
     * is somebody's missing day.
     */
    await db.attendanceDevice.update({
      where: { id: device.id },
      data: {
        lastCalledAt: new Date(),
        ...(typeof body.cursor === 'string' && body.cursor ? { cursor: body.cursor } : {}),
      },
    });

    return NextResponse.json({ ...result, serverTime: new Date().toISOString() });
  } catch (err) {
    console.error('[v1/attendance/capture]', err);
    // No cursor is saved on failure, so the agent re-sends this batch.
    return NextResponse.json({ error: 'Could not store that batch. It will be retried.' }, { status: 500 });
  }
}
