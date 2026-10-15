import { NextResponse } from 'next/server';
import { getContext } from '@/server/context';
import { readWithAi, ScanError } from '@/server/scan';
import { SCAN_KINDS, type ScanKind } from '@/lib/scan/extraction';

/**
 * Read one photo with the AI reader.
 *
 * A route rather than a server action for the same reason as file uploads:
 * actions cap the body at 1 MB, and a phone photo of an invoice is larger even
 * after the scanner shrinks it. Any signed-in person may use it - the gates
 * that matter (switched on, key present, monthly cap) are in server/scan.
 * Nothing is written here except the usage log; the form it fills is saved by
 * the person, through that form's own permission checks.
 */
export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: 'Your session has expired. Sign in again.' }, { status: 401 });

  try {
    const form = await req.formData();
    const kind = String(form.get('kind') ?? '') as ScanKind;
    const file = form.get('file');
    if (!SCAN_KINDS.includes(kind)) return NextResponse.json({ error: 'Unknown kind of scan.' }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: 'No photo was sent.' }, { status: 400 });

    const result = await readWithAi(
      { organizationId: ctx.organization.id, userId: ctx.user.id },
      { kind, bytes: new Uint8Array(await file.arrayBuffer()), mediaType: file.type },
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ScanError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[scan/read]', err);
    return NextResponse.json({ error: 'Could not read that photo. Please try again.' }, { status: 500 });
  }
}
