import { field, jsonBody, requireAction, str, V1Error } from '@/server/auth/v1-staff';
import { inScope, type ResolvedAccess } from '@/lib/app-access';
import { teamIds } from '@/server/team-reach';
import type { AppContext } from '@/server/context';

import { getLeadDetail } from '@/server/lead-detail';
import { addLeadNote, LEAD_CHANNELS, logLeadActivity, setLeadNextAction, type LeadChannel } from '@/server/lead-activity';

type Params = { params: Promise<{ id: string }> };

/** Inside the person's "Leads they see" - with their team when that is the setting (B4 step 2). */
async function mayOpen(ctx: AppContext, access: ResolvedAccess, assignee: string | null) {
  const team = access.scope.leads === 'team' ? await teamIds(ctx.scope, ctx.user.id) : undefined;
  return inScope(access.scope.leads, [assignee], ctx.user.id, team);
}

export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['leads.view', 'leads.edit', 'leads.create'], 'leads', async (ctx, access) => {
    const lead = await getLeadDetail(ctx.scope, id);
    if (!lead || !(await mayOpen(ctx, access, lead.assignedToUserId))) throw new V1Error('That lead is not in your list.', 404);
    return { lead };
  });
}

/** `op`: activity (a call, WhatsApp, meeting or visit) | note | next (follow-up date, or null to clear). */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['leads.edit', 'leads.create'], 'leads', async (ctx, access) => {
    requireAction(access, 'leads.log', 'Logging calls and follow-ups');
    const current = await getLeadDetail(ctx.scope, id);
    if (!current || !(await mayOpen(ctx, access, current.assignedToUserId))) throw new V1Error('That lead is not in your list.', 404);
    const b = await jsonBody(req);
    if (b.op === 'activity') {
      const channel = str(b.channel, 20);
      if (!channel || !(LEAD_CHANNELS as readonly string[]).includes(channel)) throw new V1Error('Choose call, WhatsApp, meeting or visit.');
      await logLeadActivity(ctx.scope, ctx.user.id, id, { channel: channel as LeadChannel, outcome: str(b.outcome, 80), note: str(b.note, 2000) });
    } else if (b.op === 'note') {
      await addLeadNote(ctx.scope, ctx.user.id, id, String(b.body ?? ''));
    } else if (b.op === 'next') {
      await setLeadNextAction(ctx.scope, id, typeof b.at === 'string' ? new Date(b.at) : null);
    } else {
      throw new V1Error('Unknown action.');
    }
    return { ok: true, lead: await getLeadDetail(ctx.scope, id) };
  });
}
