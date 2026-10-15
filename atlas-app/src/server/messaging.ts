import 'server-only';
import { db } from './db';
import { open, seal, maskSecret, canStoreSecrets } from './secret-box';
import { requireProvider, findProvider } from '@/lib/messaging/registry';
import type {
  ChannelKind, MessageRecipient, OutgoingMessage, SendResult,
} from '@/lib/messaging/contract';

/**
 * Sending to a customer, through the provider this branch chose
 * (workstream D, 1 Oct 2026).
 *
 * The old path hardcoded one email provider behind a deployment-wide
 * environment variable. This one asks the branch.
 *
 * NOTHING HERE EVER THROWS AT THE CALLER.
 *
 * A quotation must still save when the client's email key has expired. Every
 * failure comes back as `{ ok: false }` with a sentence, and the caller
 * decides - which is the same rule the clock-in photo follows in F2.5.
 */

export interface ChannelConfig {
  channel: ChannelKind;
  provider: string;
  providerLabel: string;
  /** Plain values only. Secrets are never returned in readable form. */
  values: Record<string, string>;
  /** Per secret field: a description like "Set, ending 4f2a". */
  secretState: Record<string, string | null>;
  fromName: string | null;
  fromAddress: string | null;
  isActive: boolean;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestNote: string | null;
}

export async function listChannels(storeId: string): Promise<ChannelConfig[]> {
  const rows = await db.messagingChannel.findMany({
    where: { storeId },
    orderBy: { channel: 'asc' },
  });

  return rows.map((r) => {
    const provider = findProvider(r.provider);
    const stored = (r.credentials ?? {}) as Record<string, string>;
    const values: Record<string, string> = {};
    const secretState: Record<string, string | null> = {};

    for (const f of provider?.fields ?? []) {
      if (f.secret) secretState[f.key] = maskSecret(stored[f.key]);
      else values[f.key] = stored[f.key] ?? '';
    }

    return {
      channel: r.channel as ChannelKind,
      provider: r.provider,
      providerLabel: provider?.label ?? r.provider,
      values,
      secretState,
      fromName: r.fromName,
      fromAddress: r.fromAddress,
      isActive: r.isActive,
      lastTestedAt: r.lastTestedAt,
      lastTestOk: r.lastTestOk,
      lastTestNote: r.lastTestNote,
    };
  });
}

export interface SaveChannelInput {
  storeId: string;
  channel: ChannelKind;
  provider: string;
  /** Only the fields the admin actually typed. */
  values: Record<string, string>;
  fromName?: string | null;
  fromAddress?: string | null;
  isActive?: boolean;
  userId: string | null;
}

export class MessagingError extends Error {}

/**
 * Save a channel's settings.
 *
 * A BLANK SECRET MEANS "LEAVE IT ALONE", NOT "CLEAR IT".
 *
 * The screen cannot show a stored key, so the box is always empty when the
 * page loads. Treating empty as "delete" would wipe a working channel every
 * time somebody changed the From name - which is the sort of bug that is only
 * noticed when a customer says they stopped getting invoices.
 */
export async function saveChannel(input: SaveChannelInput): Promise<void> {
  const provider = requireProvider(input.provider);
  if (provider.channel !== input.channel) {
    throw new MessagingError(`${provider.label} is not a ${input.channel} provider.`);
  }

  const existing = await db.messagingChannel.findUnique({
    where: { storeId_channel: { storeId: input.storeId, channel: input.channel } },
    select: { credentials: true, provider: true },
  });

  // Changing provider discards the old credentials: they belong to a
  // different account and silently keeping them would send through the wrong
  // one if the admin switched back.
  const previous = existing && existing.provider === input.provider
    ? ((existing.credentials ?? {}) as Record<string, string>)
    : {};

  const credentials: Record<string, string> = {};
  for (const f of provider.fields) {
    const typed = String(input.values[f.key] ?? '').trim();

    if (!f.secret) {
      credentials[f.key] = typed;
      continue;
    }

    if (typed) {
      if (!canStoreSecrets()) {
        throw new MessagingError(
          'This Atlas cannot store credentials yet. Set ATLAS_SECRET_KEY on the server, '
          + 'then save again.',
        );
      }
      credentials[f.key] = seal(typed);
    } else if (previous[f.key]) {
      credentials[f.key] = previous[f.key]!;
    }
  }

  await db.messagingChannel.upsert({
    where: { storeId_channel: { storeId: input.storeId, channel: input.channel } },
    create: {
      storeId: input.storeId, channel: input.channel, provider: input.provider,
      credentials: credentials as unknown as object,
      fromName: input.fromName ?? null, fromAddress: input.fromAddress ?? null,
      isActive: input.isActive ?? true, updatedBy: input.userId,
    },
    update: {
      provider: input.provider,
      credentials: credentials as unknown as object,
      fromName: input.fromName ?? null, fromAddress: input.fromAddress ?? null,
      isActive: input.isActive ?? true, updatedBy: input.userId,
      // A changed key has not been tested yet, and saying it passed yesterday
      // would be worse than saying nothing.
      lastTestedAt: null, lastTestOk: null, lastTestNote: null,
    },
  });
}

/**
 * Send one message on one channel.
 *
 * Returns `skipped` rather than failing when the channel is not set up: a
 * business with no WhatsApp has not done anything wrong, and the caller
 * falls back to another channel or to the portal link.
 */
export async function sendOn(
  storeId: string, channel: ChannelKind,
  to: MessageRecipient, msg: OutgoingMessage,
): Promise<SendResult> {
  const row = await db.messagingChannel.findUnique({
    where: { storeId_channel: { storeId, channel } },
  });
  if (!row || !row.isActive) {
    return { ok: false, skipped: true, error: `${channel} is not set up for this branch.` };
  }

  const provider = findProvider(row.provider);
  if (!provider) {
    return { ok: false, skipped: true, error: `Provider "${row.provider}" is no longer available.` };
  }

  // Decrypted here, at the last possible moment, and never returned anywhere.
  const stored = (row.credentials ?? {}) as Record<string, string>;
  const credentials: Record<string, string | undefined> = {};
  for (const f of provider.fields) {
    credentials[f.key] = f.secret ? (open(stored[f.key]) ?? undefined) : stored[f.key];
  }

  try {
    return await provider.send(to, msg, {
      credentials,
      fromName: row.fromName,
      fromAddress: row.fromAddress,
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Try the channels a customer can actually be reached on, best first.
 *
 * WhatsApp before email when both are configured: in this market a WhatsApp
 * message is read and an email often is not. Falls through on `skipped` -
 * "no WhatsApp number" should try email, not give up.
 */
export async function sendToCustomer(
  storeId: string, to: MessageRecipient, msg: OutgoingMessage,
): Promise<{ channel: ChannelKind | null; result: SendResult }> {
  for (const channel of ['whatsapp', 'email'] as const) {
    const result = await sendOn(storeId, channel, to, msg);
    if (result.ok) return { channel, result };
    if (!result.skipped) return { channel, result };
  }
  return {
    channel: null,
    result: { ok: false, skipped: true, error: 'No channel is set up to reach this customer.' },
  };
}

/** Record what a test send did, so the screen can show it later. */
export async function recordTest(
  storeId: string, channel: ChannelKind, result: SendResult,
): Promise<void> {
  await db.messagingChannel.updateMany({
    where: { storeId, channel },
    data: {
      lastTestedAt: new Date(),
      lastTestOk: result.ok,
      lastTestNote: result.ok ? null : (result.error ?? 'Failed').slice(0, 300),
    },
  });
}
