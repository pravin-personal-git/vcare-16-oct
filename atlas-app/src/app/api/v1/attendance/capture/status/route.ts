import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { deviceFromToken } from '@/server/attendance-devices';
import { parseStatusReport } from '@/lib/attendance-capture/agent-protocol';

/**
 * The office connector's report after every poll (9 Oct 2026).
 *
 * What BioTime returned, how much was stored, and - the reason this exists -
 * the exact error when something failed. Vcare's first install failed
 * silently for days because the only place an error appeared was a log file
 * on a PC we could not see. Now it appears on the Attendance devices screen.
 *
 * A report that answers a "Test now" carries the test result and clears the
 * request, so the button returns to idle.
 *
 * Same bearer-token trust as the capture route beside it.
 */

function bearer(req: Request): string {
  const h = req.headers.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

export async function POST(req: Request) {
  const device = await deviceFromToken(bearer(req));
  if (!device) {
    return NextResponse.json(
      { error: 'This device is not paired, or has been revoked.', paired: false },
      { status: 401 },
    );
  }

  const report = parseStatusReport(await req.json().catch(() => null));
  if (!report) return NextResponse.json({ error: 'Send a status report with a version.' }, { status: 400 });

  const { test, ...status } = report;
  await db.attendanceDevice.update({
    where: { id: device.id },
    data: {
      agentSeenAt: new Date(),
      agentVersion: report.version,
      agentStatus: status as object,
      ...(test ? { agentTest: { ...test, at: report.at } as object, testRequestedAt: null } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
