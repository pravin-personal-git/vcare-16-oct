import type {
  MessageProvider, MessageRecipient, OutgoingMessage, ProviderContext, SendResult,
} from '../contract';

/**
 * WhatsApp Business Cloud API - the official one (workstream D, decision 1 Oct 2026).
 *
 * WHY ONLY THE OFFICIAL API.
 *
 * The cheap alternative is a library that drives WhatsApp Web with a scanned
 * QR code. Those are explicitly rejected here: Meta bans the NUMBER, not the
 * software, and for Vcare that number is the one their customers already have
 * saved. Losing it is not an outage, it is losing the channel permanently.
 *
 * THE 24-HOUR WINDOW, WHICH IS THE WHOLE REASON THIS LOOKS ODD.
 *
 * WhatsApp will not let a business send free-form text to someone who has not
 * messaged them in the last 24 hours. Outside that window only a TEMPLATE
 * approved by Meta in advance may be sent, with its variables filled in. So:
 *
 *   - `templateName` given  -> send the template (works any time)
 *   - no template           -> send text, which only arrives if the customer
 *                              messaged us recently
 *
 * This is a property of WhatsApp, not of Atlas, and it is the single thing
 * that surprises people setting it up. Hence it being written here rather
 * than discovered through a 400.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * Indian numbers arrive as "9827563406", "+91 98275 63406" or
 * "098275-63406". The Cloud API wants digits with the country code and no
 * punctuation.
 */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (!d) return null;
  // A leading 0 is the Indian trunk prefix and is never part of the number.
  d = d.replace(/^0+/, '');
  // Ten digits means a bare Indian mobile; anything longer already carries a
  // country code. Defaulting to 91 is right for this product's market and is
  // stated rather than assumed silently.
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/**
 * A PDF (A3). With a template: the template's DOCUMENT header carries the
 * file and the body its words - this works at any time. Without one: a plain
 * document message with a caption, which WhatsApp only delivers within 24
 * hours of the customer writing to the business.
 */
export function documentBody(number: string, msg: OutgoingMessage, lang: string) {
  const doc = { link: msg.document!.url, filename: msg.document!.filename };
  if (msg.templateName) {
    return {
      messaging_product: 'whatsapp',
      to: number,
      type: 'template',
      template: {
        name: msg.templateName,
        language: { code: lang },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: doc }] },
          ...(msg.templateParams?.length
            ? [{ type: 'body', parameters: msg.templateParams.map((t) => ({ type: 'text', text: t })) }]
            : []),
        ],
      },
    };
  }
  return {
    messaging_product: 'whatsapp',
    to: number,
    type: 'document',
    document: { ...doc, caption: msg.text.slice(0, 1000) },
  };
}

export const whatsappCloud: MessageProvider = {
  id: 'whatsapp_cloud',
  label: 'WhatsApp Business (Cloud API)',
  channel: 'whatsapp',
  hint: 'Meta’s official API. Needs a Business number, a phone number ID and a permanent access token.',
  fields: [
    {
      key: 'phoneNumberId', label: 'Phone number ID',
      placeholder: '1234567890',
      hint: 'From Meta Business > WhatsApp > API Setup. Not the phone number itself.',
    },
    {
      key: 'accessToken', label: 'Permanent access token', secret: true,
      hint: 'Create a System User token. A temporary token expires in 24 hours and the channel stops.',
    },
    // ---- documents as PDF (A3, 12 Oct 2026) - optional until used ----
    {
      key: 'docTemplate', label: 'Document template name', optional: true,
      placeholder: 'document_attached',
      hint: 'An approved Utility template with a DOCUMENT header and body {{1}} = customer name, {{2}} = document and number, {{3}} = business. Lets Atlas send a PDF at any time.',
    },
    {
      key: 'templateLanguage', label: 'Template language code', optional: true,
      placeholder: 'en',
      hint: 'As approved in Meta, e.g. en, en_US or hi.',
    },
    {
      key: 'appSecret', label: 'App secret', secret: true, optional: true,
      hint: 'Meta app > Settings > Basic. Atlas checks every delivery update with it, so a stranger cannot fake "delivered".',
    },
    {
      key: 'verifyToken', label: 'Webhook verify token', secret: true, optional: true,
      placeholder: 'any long random word',
      hint: 'Make one up (8+ characters) and paste the same word in Meta > WhatsApp > Configuration with the webhook address shown below. Stored sealed, like the token.',
    },
  ],

  async send(
    to: MessageRecipient, msg: OutgoingMessage, ctx: ProviderContext,
  ): Promise<SendResult> {
    const f = ctx.fetch ?? globalThis.fetch;
    const id = (ctx.credentials.phoneNumberId ?? '').trim();
    const token = (ctx.credentials.accessToken ?? '').trim();
    if (!id || !token) return { ok: false, skipped: true, error: 'WhatsApp is not set up.' };

    const number = toWhatsAppNumber(to.phone);
    if (!number) return { ok: false, skipped: true, error: 'No usable WhatsApp number for this customer.' };

    const lang = (msg.templateLanguage || ctx.credentials.templateLanguage || 'en').trim();
    const body = msg.document
      ? documentBody(number, msg, lang)
      : msg.templateName
      ? {
        messaging_product: 'whatsapp',
        to: number,
        type: 'template',
        template: {
          name: msg.templateName,
          language: { code: lang },
          ...(msg.templateParams?.length
            ? {
              components: [{
                type: 'body',
                parameters: msg.templateParams.map((t) => ({ type: 'text', text: t })),
              }],
            }
            : {}),
        },
      }
      : {
        messaging_product: 'whatsapp',
        to: number,
        type: 'text',
        text: { body: msg.link ? `${msg.text}\n\n${msg.link}` : msg.text },
      };

    try {
      const res = await f(`${GRAPH}/${encodeURIComponent(id)}/messages`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = (await res.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
        error?: { message?: string; code?: number };
      };

      if (!res.ok) {
        /**
         * 131047 is "message outside the 24 hour window". It is the commonest
         * failure by a distance, and the raw text Meta returns does not say
         * what to do about it.
         */
        const code = json.error?.code;
        const message = code === 131047
          ? 'WhatsApp only allows free text within 24 hours of the customer messaging you. '
            + 'Use an approved template for this message.'
          : json.error?.message ?? `WhatsApp refused it (HTTP ${res.status}).`;
        return { ok: false, error: message };
      }

      return { ok: true, providerRef: json.messages?.[0]?.id ?? null };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};
