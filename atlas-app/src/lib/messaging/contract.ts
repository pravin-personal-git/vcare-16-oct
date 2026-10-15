/**
 * Sending a message to a customer, through whichever provider the client uses
 * (workstream D, 1 Oct 2026).
 *
 * WHAT WAS THERE BEFORE: email hardcoded to one provider, switched on by a
 * `RESEND_API_KEY` environment variable shared by the whole deployment. That
 * cannot work for the thing Pravin actually sold - "the client picks their
 * provider" - and it cannot work per tenant, because one env var is one
 * account for everybody.
 *
 * WhatsApp did not exist at all beyond a comment saying a provider would be
 * chosen later.
 *
 * Same shape as the attendance capture adapters, deliberately: a registry of
 * providers behind one contract, so adding a provider is one file and
 * changing a client's provider is a setting. That pattern has already proved
 * itself once in F2.5.
 */

export type ChannelKind = 'email' | 'whatsapp';

export interface MessageRecipient {
  name: string;
  email?: string | null;
  /** E.164 where possible. The provider normalises what it can. */
  phone?: string | null;
}

export interface OutgoingMessage {
  subject: string;
  /** Plain text. Every channel can carry it; WhatsApp has nothing else. */
  text: string;
  /** Optional rich body for channels that render it. */
  html?: string;
  /** A link the recipient should open, appended where the channel allows. */
  link?: string;
  /**
   * WhatsApp only. The Cloud API refuses free-form text outside a 24-hour
   * window, so anything we start must be an approved template.
   */
  templateName?: string;
  templateParams?: string[];
  /**
   * A file to send with the message - the document's PDF (A3, 12 Oct 2026).
   * WhatsApp fetches it from `url` itself, so the url must be public (the
   * document's no-login link + /pdf). With a template, it goes in the
   * template's DOCUMENT header; without one it is a plain document message,
   * which only arrives inside the 24-hour window.
   */
  document?: { url: string; filename: string };
  /** Template language code (en, en_US, hi). Default 'en'. */
  templateLanguage?: string;
}

export interface SendResult {
  ok: boolean;
  /** Provider's own id, for chasing a message that did not arrive. */
  providerRef?: string | null;
  /** Why it failed, in words a support call can use. */
  error?: string;
  /** True when nothing was attempted because the channel is not set up. */
  skipped?: boolean;
}

/** What a provider needs from the client, for the settings screen to draw. */
export interface ProviderField {
  key: string;
  label: string;
  /** Stored encrypted and never shown again. */
  secret?: boolean;
  placeholder?: string;
  hint?: string;
  /** Not needed to send; the channel is complete without it. */
  optional?: boolean;
}

export interface ProviderContext {
  /** Decrypted at the edge of the server, never earlier. */
  credentials: Record<string, string | undefined>;
  /** Who the message is from, as the client configured it. */
  fromName?: string | null;
  fromAddress?: string | null;
  fetch?: typeof globalThis.fetch;
}

export interface MessageProvider {
  id: string;
  label: string;
  channel: ChannelKind;
  /** One line for the settings screen. */
  hint: string;
  fields: ProviderField[];
  send(to: MessageRecipient, msg: OutgoingMessage, ctx: ProviderContext): Promise<SendResult>;
}

/** Everything a channel needs to be usable, or the reason it is not. */
export function missingFields(
  provider: MessageProvider, credentials: Record<string, string | undefined>,
): string[] {
  return provider.fields
    .filter((f) => !f.optional && !String(credentials[f.key] ?? '').trim())
    .map((f) => f.label);
}
