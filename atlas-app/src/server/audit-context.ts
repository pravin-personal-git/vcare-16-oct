import { AsyncLocalStorage } from 'node:async_hooks';
import { headers } from 'next/headers';

/**
 * Who is making the current request - for the database audit trigger
 * (health check AUD-1, 25 Sep 2026; see AuditEvent in schema.prisma).
 *
 * The actor is set once where the request is identified (getContext for the
 * website, mobileContext / the device token for Vcare, the portal
 * context for customers) and read by the database client just before every
 * write, which hands it to Postgres for the trigger to record.
 *
 * WHY IT IS KEYED ON THE REQUEST'S HEADERS OBJECT.
 * Node's AsyncLocalStorage only flows DOWN an async call chain: setting it
 * inside `getContext()` is invisible to the server action that awaited it.
 * Next keeps one headers object per request and hands the same one to every
 * caller, so a WeakMap on it is a per-request slot that every part of the
 * request can reach, and that disappears with the request.
 */

export interface Actor {
  id: string;
  name?: string | null;
  kind: 'user' | 'party' | 'device';
  via: 'web' | 'Vcare' | 'portal' | 'api';
  ip?: string | null;
  storeId?: string | null;
}

const actors = new WeakMap<object, Actor>();

async function requestKey(): Promise<object | null> {
  try { return (await headers()) as unknown as object; } catch { return null; }
}

export async function setActor(actor: Actor): Promise<void> {
  const key = await requestKey();
  if (key) actors.set(key, actor);
}

export async function currentActor(): Promise<Actor | null> {
  const key = await requestKey();
  return key ? actors.get(key) ?? null : null;
}

export async function requestIp(): Promise<string | null> {
  try { return (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? null; } catch { return null; }
}

/**
 * Set while a transaction started through `db.$transaction` runs: the actor
 * was already handed to Postgres at its start, so writes inside it must not
 * open a second transaction of their own.
 */
export const inAuditedTransaction = new AsyncLocalStorage<true>();
