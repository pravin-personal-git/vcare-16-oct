'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import { MessagingError, recordTest, saveChannel, sendOn } from '@/server/messaging';
import { canStoreSecrets } from '@/server/secret-box';
import { friendlyError } from '@/lib/friendly-error';
import type { ChannelKind } from '@/lib/messaging/contract';

/** Settings > Email & WhatsApp (workstream D). */

export async function saveChannelAction(input: {
  channel: ChannelKind;
  provider: string;
  values: Record<string, string>;
  fromName: string;
  fromAddress: string;
  isActive: boolean;
}): Promise<{ ok?: true; error?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return { error: 'You do not have permission to change how messages are sent.' };
    }
    if (ctx.scope.kind !== 'single') {
      return { error: 'Pick a branch first (top bar). Each branch sends from its own account.' };
    }

    await saveChannel({
      storeId: ctx.scope.storeId,
      channel: input.channel,
      provider: input.provider,
      values: input.values,
      fromName: input.fromName.trim() || null,
      fromAddress: input.fromAddress.trim() || null,
      isActive: input.isActive,
      userId: ctx.user.id,
    });

    revalidatePath('/settings/messaging');
    return { ok: true };
  } catch (e) {
    if (e instanceof MessagingError) return { error: e.message };
    return { error: friendlyError(e) };
  }
}

/**
 * Send a real message to the person setting it up.
 *
 * WHY A TEST BUTTON IS NOT OPTIONAL HERE.
 *
 * Every part of this can be saved correctly and still not deliver: a key with
 * the wrong permissions, an unverified sending domain, a WhatsApp number that
 * is registered but has no approved template. Without a test, the first
 * person to discover that is a customer who never got their invoice - and
 * nobody will connect it back to a settings page saved three weeks earlier.
 */
export async function testChannelAction(
  channel: ChannelKind, to: string,
): Promise<{ ok?: true; message?: string; error?: string }> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return { error: 'You do not have permission to send a test.' };
    }
    if (ctx.scope.kind !== 'single') return { error: 'Pick a branch first (top bar).' };

    const target = to.trim();
    if (!target) {
      return {
        error: channel === 'email'
          ? 'Enter an email address to send the test to.'
          : 'Enter a WhatsApp number to send the test to.',
      };
    }

    const result = await sendOn(
      ctx.scope.storeId,
      channel,
      {
        name: ctx.user.fullName,
        email: channel === 'email' ? target : null,
        phone: channel === 'whatsapp' ? target : null,
      },
      {
        subject: 'Atlas test message',
        text: 'This is a test from Atlas. If you are reading it, this channel works.',
      },
    );

    await recordTest(ctx.scope.storeId, channel, result);
    revalidatePath('/settings/messaging');

    if (result.ok) return { ok: true, message: 'Sent. Check that it arrived.' };
    return { error: result.error ?? 'It did not go through.' };
  } catch (e) {
    return { error: friendlyError(e) };
  }
}

/** Whether this deployment can store a credential at all. */
export async function secretsAvailableAction(): Promise<boolean> {
  return canStoreSecrets();
}
