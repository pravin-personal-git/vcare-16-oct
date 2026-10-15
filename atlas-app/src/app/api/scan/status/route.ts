import { NextResponse } from 'next/server';
import { getContext } from '@/server/context';
import { aiScanStatus } from '@/server/scan';

/**
 * Whether the camera scanner may offer "Read with AI" to this person right
 * now. Asked once when a scanner opens, so a button is never offered that
 * would only fail. Barcode scanning needs none of this.
 */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ enabled: false, configured: false, used: 0, limit: 0, remaining: 0 });
  try {
    return NextResponse.json(await aiScanStatus(ctx.organization.id));
  } catch (err) {
    console.error('[scan/status]', err);
    return NextResponse.json({ enabled: false, configured: false, used: 0, limit: 0, remaining: 0 });
  }
}
