import 'server-only';
import { db } from '../db';
import { HANDOFF_TTL_MS, hashHandoffCode, newHandoffCode } from '@/lib/web-handoff';

/** Issue a single-use code for this person (and the store they are working in). */
export async function createWebHandoff(userId: string, storeId: string | null): Promise<string> {
  const code = newHandoffCode();
  await db.mobileWebHandoff.create({
    data: { userId, storeId, codeHash: hashHandoffCode(code), expiresAt: new Date(Date.now() + HANDOFF_TTL_MS) },
  });
  return code;
}

/**
 * Spend a code. The update is conditional (unused AND unexpired) and must
 * touch exactly one row, so two requests racing with the same code cannot
 * both succeed - the second finds it already used.
 */
export async function consumeWebHandoff(code: string): Promise<{ userId: string; storeId: string | null } | null> {
  const codeHash = hashHandoffCode(code);
  const now = new Date();
  const spent = await db.mobileWebHandoff.updateMany({
    where: { codeHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (spent.count !== 1) return null;
  const row = await db.mobileWebHandoff.findUnique({ where: { codeHash }, select: { userId: true, storeId: true } });
  return row;
}
