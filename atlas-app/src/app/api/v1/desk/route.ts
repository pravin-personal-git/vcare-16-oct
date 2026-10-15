import { jsonBody, staff, V1Error } from '@/server/auth/v1-staff';
import { StoreScopeError } from '@/server/store-scope';
import { DESK_KINDS, myDeskOptions, myDeskRequests, raiseDeskRequest, type DeskKind, type DeskRequestInput } from '@/server/my-desk';

/**
 * My Desk on the phone (27 Sep 2026, streamline S2): the person's own
 * requests and the New request form's choices; POST raises one. Everyone -
 * no admin permission, no phone-app section: it is their own request.
 */
export async function GET(req: Request) {
  return staff(req, null, async (ctx) => {
    const [requests, options] = await Promise.all([myDeskRequests(ctx.scope, ctx.user.id), myDeskOptions(ctx.scope, ctx.user.id)]);
    return { requests, options };
  });
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() ? Number(v) : undefined);
const s = (v: unknown) => (typeof v === 'string' ? v.slice(0, 2000) : undefined);

export async function POST(req: Request) {
  return staff(req, null, async (ctx) => {
    const b = await jsonBody(req);
    const kind = String(b.kind ?? '') as DeskKind;
    if (!DESK_KINDS.includes(kind)) throw new V1Error('Choose what you are asking for.');
    const input: DeskRequestInput = {
      kind, leaveTypeId: s(b.leaveTypeId) || null, fromDate: s(b.fromDate), toDate: s(b.toDate), days: num(b.days),
      amountRupees: num(b.amountRupees), category: s(b.category), expenseDate: s(b.expenseDate), assetType: s(b.assetType),
      noticeDays: num(b.noticeDays), lastWorkingDay: s(b.lastWorkingDay), reason: s(b.reason) ?? null,
    };
    try {
      await raiseDeskRequest(ctx.scope, ctx.user.id, input);
    } catch (e) {
      // Each module's own error is written for people (dates, balances, amounts).
      if (!(e instanceof StoreScopeError) && e instanceof Error && e.message && e.message.length < 200 && !/prisma|\binvalid\b.*\binvocation\b/i.test(e.message)) {
        throw new V1Error(e.message);
      }
      throw e;
    }
    return { ok: true, message: 'Request sent. You will be notified when it is decided.' };
  });
}
