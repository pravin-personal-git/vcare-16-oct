import { NextResponse } from 'next/server';

/**
 * Retired with the old Atlas Call Sync app (health check CALL-4, 25 Sep 2026).
 * Vcare pairs through /api/v1/device/pair and clocks in through
 * /api/v1/attendance. Kept as a clear answer rather than a 404, so a phone
 * still running the old app says why it stopped working.
 */
const GONE = {
  error: 'The Atlas Call Sync app has been replaced by Vcare. Install Vcare and pair the phone again.',
  retired: true,
};

export function GET() { return NextResponse.json(GONE, { status: 410 }); }
export function POST() { return NextResponse.json(GONE, { status: 410 }); }
