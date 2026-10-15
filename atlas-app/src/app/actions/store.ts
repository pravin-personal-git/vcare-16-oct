'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db } from '@/server/db';
import { getContext, ACTIVE_STORE_COOKIE } from '@/server/context';
import { ALL_COMPANY_CHOICE } from '@/server/store-scope';

/**
 * Switch the active store, or pass null for All Company.
 * Saved on the person (User.lastStoreChoice) so it survives a new login, a
 * business switch and a second person using the same browser. The cookie is
 * kept only for Access Tenant (impersonation), which has no saved choice.
 * The requested store is validated against the user's own assignments - a
 * client cannot scope itself into a store it has no role in.
 */
export async function setActiveStore(storeId: string | null) {
  const ctx = await getContext();
  if (!ctx) return;

  const jar = await cookies();

  if (storeId === null) {
    jar.delete(ACTIVE_STORE_COOKIE);
  } else {
    const allowed = ctx.stores.some((s) => s.id === storeId);
    if (!allowed) return;
    jar.set(ACTIVE_STORE_COOKIE, storeId, {
      httpOnly: true, sameSite: 'lax', path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  if (!ctx.impersonation) {
    await db.user.update({
      where: { id: ctx.user.id },
      data: { lastStoreChoice: storeId ?? ALL_COMPANY_CHOICE },
    });
  }

  await db.activityLog.create({
    data: {
      storeId: storeId ?? ctx.stores[0].id,
      userId: ctx.user.id,
      activityType: 'Store Switch',
      entityType: 'Store',
      entityId: storeId,
      description: storeId
        ? `Switched to ${ctx.stores.find((s) => s.id === storeId)?.name}`
        : 'Switched to All Company',
    },
  }).catch(() => undefined);

  revalidatePath('/', 'layout');
}
