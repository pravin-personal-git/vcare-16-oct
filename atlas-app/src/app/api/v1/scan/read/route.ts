import { NextResponse } from 'next/server';
import { mobileContext } from '@/server/auth/mobile-context';
import { readWithAi, ScanError } from '@/server/scan';
import { SCAN_KINDS, type ScanKind } from '@/lib/scan/extraction';
import { accessFor } from '@/server/app-access';

/** Which phone app switch each kind of photo needs (Settings > Roles > Phone app). */
const SCAN_ACTION: Record<ScanKind, string> = {
  visiting_card: 'leads.scanCard', supplier_invoice: 'stock.scanBill', product_label: 'stock.lookup',
};

/**
 * AI reading of a supplier invoice, visiting card or product label, from
 * Vcare. The phone sends the photo as base64 JSON; the same per-business
 * switch and monthly cap as the website apply (server/scan).
 */
export async function POST(req: Request) {
  const ctx = await mobileContext(req);
  if (!ctx) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  try {
    const b = (await req.json().catch(() => ({}))) as { kind?: string; imageBase64?: string; mediaType?: string };
    const kind = String(b.kind ?? '') as ScanKind;
    if (!SCAN_KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown kind of scan.' }, { status: 400 });
    if (!(await accessFor(ctx)).actions[SCAN_ACTION[kind]]) {
      return NextResponse.json({ error: 'Reading this kind of photo is not switched on for you in the app. Ask your admin.' }, { status: 403 });
    }
    if (typeof b.imageBase64 !== 'string' || !b.imageBase64) return NextResponse.json({ error: 'No photo was sent.' }, { status: 400 });
    const bytes = new Uint8Array(Buffer.from(b.imageBase64, 'base64'));
    const result = await readWithAi(
      { organizationId: ctx.organization.id, userId: ctx.user.id },
      { kind, bytes, mediaType: b.mediaType ?? 'image/jpeg' },
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ScanError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[v1/scan/read]', err);
    return NextResponse.json({ error: 'Could not read that photo. Please try again.' }, { status: 500 });
  }
}
