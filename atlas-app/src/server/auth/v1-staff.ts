import 'server-only';
import { isExcluded, isPageHidden, moduleOfApi, pageOfApi } from '@/lib/modules';
import { NextResponse } from 'next/server';
import { mobileContext } from './mobile-context';
import { db } from '../db';
import type { AppContext } from '../context';
import { StoreScopeError } from '../store-scope';
import { ComplaintError } from '../complaints';
import { GrnError } from '../goods-receipt';
import { FlowGateError } from '../flow-gate';
import { InstallationChallanError } from '../installation-challans';
import { accessFor } from '../app-access';
import { redact, type ResolvedAccess } from '@/lib/app-access';

/**
 * The shape every Vcare staff route shares: resolve the phone's bearer
 * token into the website's own context, require the same permission the
 * website's screen requires, and turn a known business error into a
 * sentence. Routes stay thin adapters over the server/* functions the
 * website already uses - no second implementation of any rule.
 */

/** A refusal written for the person holding the phone. */
export class V1Error extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

// FlowGateError carries a sentence written for the person holding the phone
// ("In this business somebody else does ..."). Without it here, a step the
// client switched off came back as a blank 500.
// InstallationChallanError added 11 Oct 2026 (G2): the phone's stage / item
// actions say why they refused (e.g. "say why it is going back a step").
const FRIENDLY = [V1Error, StoreScopeError, ComplaintError, GrnError, FlowGateError, InstallationChallanError];

export function friendlyScopeMessage(e: StoreScopeError): string {
  return e.message.includes('All Company')
    ? 'Choose a branch first.'
    : 'This business is in read-only mode. Contact your account manager.';
}

export async function staff(
  req: Request,
  need: string | string[] | null,
  run: (ctx: AppContext) => Promise<unknown>,
): Promise<Response> {
  const ctx = await mobileContext(req);
  if (!ctx) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  // A module the platform owner switched off for this business answers nobody
  // on the phone either (F-01, 5 Oct 2026) - and since 10 Oct, neither does an
  // area whose web page was switched off on its own. `pageOfApi` is the map;
  // taking Call Logs off the website and leaving /api/v1/calls answering is
  // exactly the kind of half-closed door F-01 was opened for.
  const apiPath = new URL(req.url).pathname;
  if (isExcluded(moduleOfApi(apiPath), ctx.excludedModules)
    || isPageHidden(pageOfApi(apiPath), ctx.excludedPages)) {
    return NextResponse.json({ error: 'This is not part of your plan. Contact your Atlas provider.' }, { status: 403 });
  }
  const needed = need === null ? [] : Array.isArray(need) ? need : [need];
  // Any one of the listed permissions is enough.
  if (needed.length && !needed.some((p) => ctx.permissions.has(p))) {
    return NextResponse.json({ error: 'You do not have permission for this.' }, { status: 403 });
  }
  /**
   * APPLIED ONCE (F-13, 13 Oct 2026). A change from the phone's offline outbox
   * carries `x-op-id`. The first arrival is applied and its answer kept
   * (PhoneOp); if it arrives again - the signal dropped after we had already
   * done it, so the phone never heard - the kept answer is sent back and
   * nothing is done twice. Refusals are kept too (the same refusal again);
   * server errors are not, so a retry can still succeed.
   */
  const opId = req.method === 'POST' ? req.headers.get('x-op-id') : null;
  const validOp = !!opId && /^[\w-]{8,80}$/.test(opId);
  if (validOp) {
    const seen = await db.phoneOp.findUnique({ where: { opId: opId! }, select: { userId: true, status: true, result: true } });
    if (seen && seen.userId === ctx.user.id) {
      return NextResponse.json({ ...(seen.result as object ?? {}), replayed: true }, { status: seen.status });
    }
  }
  const keep = async (status: number, body: unknown) => {
    if (!validOp || status >= 500) return;
    await db.phoneOp.create({
      data: { opId: opId!, userId: ctx.user.id, path: new URL(req.url).pathname.slice(0, 300), status, result: (body ?? { ok: true }) as object },
    }).catch(() => undefined); // a parallel arrival got there first - fine
  };
  try {
    const out = await run(ctx);
    if (out instanceof Response) return out;
    await keep(200, out ?? { ok: true });
    return NextResponse.json(out ?? { ok: true });
  } catch (err) {
    if (FRIENDLY.some((k) => err instanceof k)) {
      const message = err instanceof StoreScopeError ? friendlyScopeMessage(err) : (err as Error).message;
      const status = err instanceof V1Error ? err.status : 400;
      await keep(status, { error: message });
      return NextResponse.json({ error: message }, { status });
    }
    console.error(`[v1] ${new URL(req.url).pathname}`, err);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}

export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

export const str = (v: unknown, max = 2000): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

type AppSection = keyof ResolvedAccess['sections'];

/**
 * `staff`, plus the owner's phone app settings (Settings > Roles > Phone app,
 * 26 Sep 2026): the section must be switched on for this person, the route
 * gets their resolved access (scope, actions), and hidden details are taken
 * out of whatever it returns - see lib/app-access `redact`.
 */
export async function field(
  req: Request,
  need: string | string[] | null,
  section: AppSection | null,
  run: (ctx: AppContext, access: ResolvedAccess) => Promise<unknown>,
): Promise<Response> {
  return staff(req, need, async (ctx) => {
    const access = await accessFor(ctx);
    if (section && !access.sections[section]) {
      throw new V1Error(`${SECTION_NAME[section]} is not switched on for you in the app. Ask your admin.`, 403);
    }
    const out = await run(ctx, access);
    return out instanceof Response ? out : redact(out ?? { ok: true }, access.hide);
  });
}

const SECTION_NAME: Record<AppSection, string> = {
  attendance: 'Attendance', complaints: 'Complaints', stock: 'Stock', leads: 'Leads', tasks: 'Tasks',
  installations: 'Installations', van: 'Van stock',
};

/** Refuse an action the owner switched off for this person. */
export function requireAction(access: ResolvedAccess, action: string, what: string) {
  if (!access.actions[action]) throw new V1Error(`${what} is not switched on for you in the app. Ask your admin.`, 403);
}
