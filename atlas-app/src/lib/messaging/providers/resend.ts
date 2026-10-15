import type {
  MessageProvider, MessageRecipient, OutgoingMessage, ProviderContext, SendResult,
} from '../contract';

/** Minimal HTML escape - the same rule server/notify.ts already applies. */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
  ));

/** Build a readable HTML body when the caller only gave us text. */
export function defaultHtml(to: MessageRecipient, msg: OutgoingMessage): string {
  return `<p>Hello ${esc(to.name || 'there')},</p>`
    + `<p>${esc(msg.text).replace(/\n/g, '<br>')}</p>`
    + (msg.link ? `<p><a href="${esc(msg.link)}">Open</a></p>` : '');
}

/**
 * Resend.
 *
 * Kept because it is what the product already used, and a client already on it
 * should not be migrated to make a refactor tidy. The difference now is that
 * the key is the CLIENT's, stored against their branch, rather than one
 * deployment-wide environment variable shared by every tenant.
 */
export const resend: MessageProvider = {
  id: 'resend',
  label: 'Resend',
  channel: 'email',
  hint: 'Simple to set up. Needs a verified sending domain.',
  fields: [
    { key: 'apiKey', label: 'API key', secret: true, placeholder: 're_...' },
  ],

  async send(to, msg, ctx: ProviderContext): Promise<SendResult> {
    const f = ctx.fetch ?? globalThis.fetch;
    const key = (ctx.credentials.apiKey ?? '').trim();
    if (!key) return { ok: false, skipped: true, error: 'Email is not set up.' };
    if (!to.email) return { ok: false, skipped: true, error: 'No email address for this customer.' };

    const from = ctx.fromAddress
      ? `${ctx.fromName || 'Atlas'} <${ctx.fromAddress}>`
      : 'Atlas <notify@nairsolutions.org>';

    try {
      const res = await f('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from, to: [to.email], subject: msg.subject,
          html: msg.html ?? defaultHtml(to, msg),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      return res.ok
        ? { ok: true, providerRef: json.id ?? null }
        : { ok: false, error: json.message ?? `Resend refused it (HTTP ${res.status}).` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};
