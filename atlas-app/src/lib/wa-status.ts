/**
 * What a WhatsApp delivery update does to a sent document (A3, 12 Oct 2026).
 * Pure - the webhook and the tests share it.
 *
 * Meta's updates can arrive out of order (a "delivered" after the "read"),
 * so a status only ever moves forward: sent -> delivered -> read. "failed"
 * wins over sent and delivered (the message did not get there), never over
 * read (it plainly did).
 */
export type SendStatus = 'sent' | 'delivered' | 'read' | 'failed';

const RANK: Record<SendStatus, number> = { sent: 0, delivered: 1, read: 2, failed: 1.5 };

export function nextStatus(current: string, incoming: string): SendStatus | null {
  const cur = (current in RANK ? current : 'sent') as SendStatus;
  if (!(incoming in RANK)) return null;
  const inc = incoming as SendStatus;
  if (cur === inc) return null;
  if (cur === 'read') return null;
  return RANK[inc] > RANK[cur] ? inc : null;
}

/** sha256=<hex> of the raw body with the app secret - Meta's X-Hub-Signature-256. */
export async function signatureMatches(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !header.startsWith('sha256=') || !appSecret) return false;
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const want = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const got = header.slice('sha256='.length);
  if (got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(want, 'hex'));
}

export interface StatusUpdate { phoneNumberId: string; wamid: string; status: string; at: Date; error: string | null }

/** The status updates in one webhook body, whatever else it carries (incoming messages are ignored for now). */
export function statusUpdates(body: unknown): StatusUpdate[] {
  const out: StatusUpdate[] = [];
  const entries = (body as { entry?: unknown[] })?.entry ?? [];
  for (const e of entries as { changes?: { value?: Record<string, unknown> }[] }[]) {
    for (const ch of e.changes ?? []) {
      const v = ch.value ?? {};
      const phoneNumberId = String((v.metadata as { phone_number_id?: string } | undefined)?.phone_number_id ?? '');
      for (const s of (v.statuses as { id?: string; status?: string; timestamp?: string; errors?: { title?: string; message?: string }[] }[] | undefined) ?? []) {
        if (!s.id || !s.status || !phoneNumberId) continue;
        const ts = Number(s.timestamp);
        out.push({
          phoneNumberId, wamid: s.id, status: s.status,
          at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
          error: s.errors?.[0] ? (s.errors[0].message ?? s.errors[0].title ?? 'Failed') : null,
        });
      }
    }
  }
  return out;
}
