import type { MessageProvider, ProviderContext, SendResult } from '../contract';
import { defaultHtml } from './resend';

/**
 * Brevo (formerly Sendinblue).
 *
 * The second provider exists for a reason beyond choice: with only one, the
 * contract is shaped by that one and the next provider needs the interface
 * changed. Two proves the shape is actually general - the same argument F2.5
 * made for building four attendance adapters rather than one.
 *
 * Brevo specifically because it has a usable free tier and is common with
 * Indian small businesses, which is the market this product serves.
 */
export const brevo: MessageProvider = {
  id: 'brevo',
  label: 'Brevo (Sendinblue)',
  channel: 'email',
  hint: 'Free tier available. Common with Indian small businesses.',
  fields: [
    { key: 'apiKey', label: 'API key', secret: true, placeholder: 'xkeysib-...' },
  ],

  async send(to, msg, ctx: ProviderContext): Promise<SendResult> {
    const f = ctx.fetch ?? globalThis.fetch;
    const key = (ctx.credentials.apiKey ?? '').trim();
    if (!key) return { ok: false, skipped: true, error: 'Email is not set up.' };
    if (!to.email) return { ok: false, skipped: true, error: 'No email address for this customer.' };

    try {
      const res = await f('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: {
            name: ctx.fromName || 'Atlas',
            email: ctx.fromAddress || 'notify@nairsolutions.org',
          },
          to: [{ email: to.email, name: to.name || undefined }],
          subject: msg.subject,
          htmlContent: msg.html ?? defaultHtml(to, msg),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string };
      return res.ok
        ? { ok: true, providerRef: json.messageId ?? null }
        : { ok: false, error: json.message ?? `Brevo refused it (HTTP ${res.status}).` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};
