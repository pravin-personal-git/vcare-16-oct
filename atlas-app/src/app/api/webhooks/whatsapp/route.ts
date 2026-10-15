import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { open } from '@/server/secret-box';
import { nextStatus, signatureMatches, statusUpdates } from '@/lib/wa-status';

export const dynamic = 'force-dynamic';

/**
 * Meta's WhatsApp webhook (A3, 12 Oct 2026) - one address for every business
 * on this Atlas: <site>/api/webhooks/whatsapp. Paste it in Meta > WhatsApp >
 * Configuration with the branch's verify token (Settings > Email & WhatsApp).
 *
 * GET  - Meta checks the address: echo the challenge when the verify token
 *        matches a branch's.
 * POST - delivery updates. Each is checked against the signature made with
 *        THAT branch's app secret (found by its phone number ID) before it
 *        touches anything; a branch with no app secret saved is not trusted.
 *        The sent document's status only moves forward (lib/wa-status).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = u.searchParams.get('hub.verify_token') ?? '';
  if (u.searchParams.get('hub.mode') !== 'subscribe' || token.length < 8) return new NextResponse('Forbidden', { status: 403 });
  // The verify token is stored sealed, so each WhatsApp Business channel is
  // opened and compared - a handful of rows, and only when Meta checks the address.
  const channels = await db.messagingChannel.findMany({
    where: { channel: 'whatsapp', provider: 'whatsapp_cloud' },
    select: { credentials: true },
  });
  const match = channels.some((c) => open(((c.credentials ?? {}) as Record<string, string>).verifyToken) === token);
  if (!match) return new NextResponse('Forbidden', { status: 403 });
  return new NextResponse(u.searchParams.get('hub.challenge') ?? '', { status: 200, headers: { 'content-type': 'text/plain' } });
}

export async function POST(req: Request) {
  const raw = await req.text();
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  const signature = req.headers.get('x-hub-signature-256');

  const updates = statusUpdates(body);
  const trusted = new Map<string, string | null>(); // phoneNumberId -> storeId (null = not trusted)
  for (const u of updates) {
    if (!trusted.has(u.phoneNumberId)) {
      const ch = await db.messagingChannel.findFirst({
        where: { channel: 'whatsapp', provider: 'whatsapp_cloud', credentials: { path: ['phoneNumberId'], equals: u.phoneNumberId } },
        select: { storeId: true, credentials: true },
      });
      const secret = open(((ch?.credentials ?? {}) as Record<string, string>).appSecret) ?? '';
      trusted.set(u.phoneNumberId, ch && await signatureMatches(raw, signature, secret) ? ch.storeId : null);
    }
    const storeId = trusted.get(u.phoneNumberId);
    if (!storeId) continue;

    const send = await db.documentSend.findFirst({ where: { storeId, providerRef: u.wamid }, select: { id: true, status: true } });
    if (!send) continue;
    const next = nextStatus(send.status, u.status);
    if (!next) continue;
    await db.documentSend.update({
      where: { id: send.id },
      data: {
        status: next,
        ...(next === 'delivered' ? { deliveredAt: u.at } : {}),
        ...(next === 'read' ? { readAt: u.at } : {}),
        ...(next === 'failed' ? { failedAt: u.at, error: u.error ?? 'WhatsApp could not deliver it.' } : {}),
      },
    });
  }
  // Always 200: Meta retries anything else for days.
  return NextResponse.json({ ok: true });
}
