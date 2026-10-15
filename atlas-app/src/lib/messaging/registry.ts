import type { ChannelKind, MessageProvider } from './contract';
import { resend } from './providers/resend';
import { brevo } from './providers/smtp-http';
import { whatsappCloud } from './providers/whatsapp-cloud';

/**
 * Every provider a client may choose (workstream D).
 *
 * Adding one is this file plus its own module - nothing else in Atlas knows
 * a provider's name. Same shape as the attendance adapter registry, which has
 * already proved the pattern once.
 */
export const PROVIDERS: readonly MessageProvider[] = [resend, brevo, whatsappCloud];

export class UnknownProviderError extends Error {}

export const providersFor = (channel: ChannelKind): MessageProvider[] =>
  PROVIDERS.filter((p) => p.channel === channel);

export function findProvider(id: string): MessageProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function requireProvider(id: string): MessageProvider {
  const p = findProvider(id);
  if (!p) {
    throw new UnknownProviderError(
      `No messaging provider called "${id}". Known: ${PROVIDERS.map((x) => x.id).join(', ')}.`,
    );
  }
  return p;
}

/** For the settings screen, so it can draw a field per provider. */
export const providerChoices = (channel: ChannelKind) =>
  providersFor(channel).map((p) => ({
    id: p.id,
    label: p.label,
    hint: p.hint,
    fields: p.fields.map((f) => ({
      key: f.key, label: f.label, secret: f.secret ?? false,
      placeholder: f.placeholder, hint: f.hint,
    })),
  }));
