'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createCourier, updateCourier, setCourierActive, CourierError, type CourierInput,
} from '@/server/couriers';
import { friendlyError } from '@/lib/friendly-error';

export interface ActionState {
  error?: string;
  ok?: boolean;
}

async function guard(run: () => Promise<void>): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    if (!ctx.permissions.has('settings.edit')) {
      return { error: 'You do not have permission to change couriers.' };
    }
    await run();
    revalidatePath('/courier');
    return { ok: true };
  } catch (err) {
    if (err instanceof CourierError) return { error: err.message };
    console.error('[courier] action failed', err);
    return { error: friendlyError(err) };
  }
}

export async function saveCourier(id: string | null, input: CourierInput) {
  return guard(async () => {
    const ctx = await requireContext();
    if (id) await updateCourier(ctx.scope, id, input);
    else await createCourier(ctx.scope, input);
  });
}

export async function toggleCourierActive(id: string, isActive: boolean) {
  return guard(async () => {
    const ctx = await requireContext();
    await setCourierActive(ctx.scope, id, isActive);
  });
}
