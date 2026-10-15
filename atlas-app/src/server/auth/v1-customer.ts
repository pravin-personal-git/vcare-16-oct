import 'server-only';
import { NextResponse } from 'next/server';
import { db } from '../db';
import { requestIp, setActor } from '../audit-context';
import { requireApiCaller } from './api-caller';
import { ComplaintError } from '../complaints';
import { V1Error } from './v1-staff';

/**
 * The customer side of Vcare: a portal token (kind 'party') resolves to
 * exactly one customer of one branch, and every read is filtered by both -
 * the same pairing the website portal uses (server/portal.ts).
 */
export interface CustomerCtx { partyId: string; storeId: string; firstName: string }

export async function customer(req: Request, run: (c: CustomerCtx) => Promise<unknown>): Promise<Response> {
  const caller = await requireApiCaller(req);
  if (!caller || caller.kind !== 'party') return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  const party = await db.party.findUnique({ where: { id: caller.partyId }, select: { id: true, storeId: true, firstName: true, portalEnabled: true } });
  if (!party || !party.portalEnabled) return NextResponse.json({ error: 'Your account is switched off. Contact the business.' }, { status: 401 });
  await setActor({ id: party.id, name: party.firstName, kind: 'party', via: 'Vcare', ip: await requestIp(), storeId: party.storeId });
  try {
    const out = await run({ partyId: party.id, storeId: party.storeId, firstName: party.firstName });
    return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
  } catch (err) {
    if (err instanceof V1Error) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof ComplaintError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error(`[v1 customer] ${new URL(req.url).pathname}`, err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
