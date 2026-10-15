import { field, jsonBody, requireAction, str, V1Error } from '@/server/auth/v1-staff';
import { inScope } from '@/lib/app-access';
import { teamIds } from '@/server/team-reach';
import { createLead, listLeads, type LeadInput } from '@/server/leads';

/**
 * A salesperson's leads - their own open ones by default, `?all=1` for the
 * branch. Follow-ups due today or overdue come first.
 */
export async function GET(req: Request) {
  return field(req, ['leads.view', 'leads.edit', 'leads.create'], 'leads', async (ctx, access) => {
    // The owner's "Leads they see" setting; ?all=1 only within it.
    const scope = access.scope.leads;
    const all = scope === 'branch' && new URL(req.url).searchParams.get('all') === '1';
    // "Mine + my team" (B4 step 2) - the same reach as the website.
    const team = scope === 'team' ? await teamIds(ctx.scope, ctx.user.id) : undefined;
    const rows = (await listLeads(ctx.scope)).filter((l) => !l.isClosed
      && (all || inScope(scope === 'branch' ? 'mine' : scope, [l.assignedToUserId], ctx.user.id, team)));
    const due = (l: { nextActionAt: Date | null }) => (l.nextActionAt ? l.nextActionAt.getTime() : Number.MAX_SAFE_INTEGER);
    rows.sort((a, b) => due(a) - due(b));
    return { leads: rows.slice(0, 300), canCreate: access.actions['leads.create'], scope };
  });
}

/** Add a lead from the phone - assigned to whoever added it. */
export async function POST(req: Request) {
  return field(req, 'leads.create', 'leads', async (ctx, access) => {
    requireAction(access, 'leads.create', 'Adding leads');
    const b = await jsonBody(req);
    const firstName = str(b.firstName, 80);
    const mobile = String(b.mobile ?? '').replace(/\D/g, '').slice(-10);
    if (!firstName) throw new V1Error('Name is required.');
    if (!/^\d{10}$/.test(mobile)) throw new V1Error('Mobile must be a 10-digit number.');
    const lat = Number(b.latitude), lng = Number(b.longitude);
    const input: LeadInput = {
      businessName: str(b.businessName, 160), gstin: null, title: null, firstName,
      lastName: str(b.lastName, 80), designation: str(b.designation, 80), mobile,
      altMobile: null, email: str(b.email, 160), addressLine1: str(b.address, 240), addressLine2: null,
      state: null, city: str(b.city, 80), pincode: null, refCode: null,
      dealStageId: null, stageId: null, sourceId: null, assignedToUserId: ctx.user.id,
      requirement: str(b.requirement, 2000), notes: str(b.notes, 4000), potentialPaise: 0,
      lastTalkAt: null, nextActionAt: typeof b.nextActionAt === 'string' ? new Date(b.nextActionAt) : null,
      tags: [], latitude: Number.isFinite(lat) ? lat : null, longitude: Number.isFinite(lng) ? lng : null,
      locationNote: null,
    };
    const r = await createLead(ctx.scope, input);
    if (r.rejected) throw new V1Error(`This mobile number is already lead ${r.duplicateOf}.`, 409);
    return { ok: true, id: r.lead?.id ?? null, duplicateOf: r.duplicateOf ?? null };
  });
}
