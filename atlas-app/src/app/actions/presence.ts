'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getContext } from '@/server/context';
import { db } from '@/server/db';
import { markLeaving, markPresent, type BrowserFix, type PresenceState } from '@/server/presence';
import { friendlyError } from '@/lib/friendly-error';

async function requestIp(): Promise<string | null> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

/**
 * The Present button's two writes.
 *
 * NO PERMISSION GATE, DELIBERATELY. Marking yourself present is not an
 * administrative act - it is the one thing every signed-in person is entitled
 * to do about their own day. `attendance.edit` guards changing somebody else's
 * record, which is a different question and lives on the attendance screens.
 *
 * The user id is taken from the session and never from the client. A browser
 * that could name the person it was marking present would be a way to clock in
 * a colleague who is still at home.
 */

export interface PresenceActionResult {
  ok: boolean;
  error?: string;
  warning?: string | null;
  /** Serialised for the client boundary - dates cross it as ISO strings. */
  state?: {
    clockInAt: string;
    clockOutAt: string | null;
    workedMinutes: number | null;
    hasLocation: boolean;
  };
}

function shape(state: PresenceState): PresenceActionResult['state'] {
  return {
    clockInAt: state.clockInAt.toISOString(),
    clockOutAt: state.clockOutAt ? state.clockOutAt.toISOString() : null,
    workedMinutes: state.workedMinutes,
    hasLocation: state.hasLocation,
  };
}

function fail(e: unknown): PresenceActionResult {
  return { ok: false, error: friendlyError(e, true) };
}

export async function markPresentAction(fix: BrowserFix): Promise<PresenceActionResult> {
  const ctx = await getContext();
  if (!ctx) return { ok: false, error: 'Your session has expired. Sign in again.' };

  /*
    A presence row belongs to a store, and "All Company" is not one.

    Rather than refuse, it falls back to the store the person is actually
    assigned to. Somebody looking at the company-wide view is still a person
    who works somewhere, and making them switch store before they can mark
    themselves present would be a needless step at the start of every day.
  */
  const storeId = ctx.activeStoreId ?? ctx.stores[0]?.id;
  if (!storeId) return { ok: false, error: 'You are not assigned to a store.' };

  try {
    const ipAddress = await requestIp();
    const { state, warning } = await markPresent({ userId: ctx.user.id, storeId, fix, ipAddress });

    await db.activityLog
      .create({
        data: {
          storeId,
          userId: ctx.user.id,
          activityType: 'Present',
          entityType: 'AttendanceDay',
          entityId: state.id,
          description: state.hasLocation
            ? `Marked present from the web, with a location${state.inAccuracyM ? ` accurate to ${state.inAccuracyM} m` : ''}`
            : 'Marked present from the web, without a location',
        },
      })
      .catch((e) => console.error('[presence] audit write failed (non-fatal)', e));

    revalidatePath('/', 'layout');
    return { ok: true, warning, state: shape(state) };
  } catch (e) {
    return fail(e);
  }
}

export async function markLeavingAction(fix: BrowserFix): Promise<PresenceActionResult> {
  const ctx = await getContext();
  if (!ctx) return { ok: false, error: 'Your session has expired. Sign in again.' };

  try {
    const { state, warning } = await markLeaving({ userId: ctx.user.id, fix });

    const storeId = ctx.activeStoreId ?? ctx.stores[0]?.id;
    if (storeId) {
      await db.activityLog
        .create({
          data: {
            storeId,
            userId: ctx.user.id,
            activityType: 'Finished',
            entityType: 'AttendanceDay',
            entityId: state.id,
            description: `Finished for the day from the web${
              state.workedMinutes !== null ? ` after ${Math.floor(state.workedMinutes / 60)}h ${state.workedMinutes % 60}m` : ''
            }`,
          },
        })
        .catch((e) => console.error('[presence] audit write failed (non-fatal)', e));
    }

    revalidatePath('/', 'layout');
    return { ok: true, warning, state: shape(state) };
  } catch (e) {
    return fail(e);
  }
}
