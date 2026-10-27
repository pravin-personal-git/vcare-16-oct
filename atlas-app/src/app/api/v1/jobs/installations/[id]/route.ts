import { field, jsonBody, str, V1Error } from '@/server/auth/v1-staff';
import { db } from '@/server/db';
import { scanUnitOntoChallan, technicianInstallation } from '@/server/field-app';
import { markInstallationWorkDone, setInstallationStage, updateInstallationItems } from '@/server/installation-page';
import { requestInstallationReturn } from '@/server/installation-returns';
import { editJobChallan, INSTALL_WORK_STAGES, phoneInstallationParts, raiseInstallationChallan, requestPartsReturn, withdrawJobChallan } from '@/server/job-challans';
import type { ResolvedAccess } from '@/lib/app-access';

type Params = { params: Promise<{ id: string }> };

/**
 * The Parts card's switch (Settings > Roles > Phone app > Layout > Job: Parts),
 * checked here so a role with it off never receives parts or sends them.
 */
const partsOn = (access: ResolvedAccess) => access.layout.preset !== 'simple' || access.layout.job.parts;

/**
 * The permission is installations.* as on the website, or orders.* as before
 * (22 Oct 2026: Vcare's Technician role has installations.edit but not
 * orders.edit, so the phone refused every scan, stage and return).
 */
const VIEW = ['orders.view', 'orders.edit', 'installations.view', 'installations.edit'];
const EDIT = ['orders.edit', 'installations.edit'];
const mayEdit = (p: Set<string>) => EDIT.some((k) => p.has(k));

/** One fitting: the site, what goes in, and what has been scanned so far. */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, VIEW, 'installations', async (ctx, access) => {
    const c = await technicianInstallation(ctx.scope, id);
    if (!c) throw new V1Error('That job is not in your scope.', 404);
    const canEdit = mayEdit(ctx.permissions);
    /*
      Unused goods back, and material challans (22 Oct 2026, R2/R3). `onTeam`
      and `working` say whether this person may send goods back and ask for
      material; the server checks both again. Older builds ignore the fields.
    */
    const team = await db.installationChallanAssignee.findMany({ where: { challanId: id }, select: { userId: true } });
    const store = await db.installationChallan.findUnique({ where: { id }, select: { storeId: true } });
    return {
      installation: c,
      canEdit,
      onTeam: team.some((t) => t.userId === ctx.user.id),
      working: (INSTALL_WORK_STAGES as readonly string[]).includes(c.stage),
      parts: canEdit && partsOn(access) && store ? await phoneInstallationParts(ctx.scope, id, store.storeId, ctx.user.id) : null,
    };
  });
}

/**
 * What a technician does on site: scan an item as it goes in, say the work is
 * done, move the stage, mark an item - and (22 Oct 2026) send unused goods
 * back, ask for material, and send unused material back.
 *
 * `scan` is per item rather than per job on purpose. A fitting runs for hours
 * and a phone loses signal in a basement; scanning six cameras in one request
 * means losing all six because the last one failed.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, EDIT, 'installations', async (ctx, access) => {
    const b = await jsonBody(req);
    // `op` is what the shared Parts card sends (22 Oct 2026).
    const action = str(b.action ?? b.op, 40);

    if (action === 'scan') {
      const challanItemId = str(b.challanItemId, 60);
      const serialNo = str(b.serialNo, 120);
      if (!challanItemId || !serialNo) throw new V1Error('Scan a number first.', 400);
      const unit = await scanUnitOntoChallan(ctx.scope, { challanItemId, serialNo });
      return { ok: true, challanItemId: unit.id };
    }

    if (action === 'workDone') {
      // The same transition the office uses, so the approval rules, the
      // activity log and the status vocabulary cannot drift apart between the
      // two screens.
      // Optional "received by" from builds 1.0.33 on (27 Oct 2026): who took it over on site.
      await markInstallationWorkDone(ctx.scope, id, ctx.user.id, str(b.receivedBy, 120) || null);
      return { ok: true };
    }

    // G2 (11 Oct 2026): the website's stage and item controls, from site.
    // Same server functions as the installation page, so the activity log and
    // the rules (no going back without a reason, handover only on the website)
    // are one set.
    if (action === 'stage') {
      const to = str(b.to, 40);
      if (!to) throw new V1Error('Which stage?', 400);
      await setInstallationStage(ctx.scope, id, to, ctx.user.id, str(b.reason, 500) || null);
      return { ok: true };
    }

    if (action === 'item') {
      const challanItemId = str(b.challanItemId, 60);
      if (!challanItemId) throw new V1Error('Which item?', 400);
      const fitStatus = str(b.fitStatus, 20) || undefined;
      const placement = typeof b.placement === 'string' ? str(b.placement, 120) : undefined;
      await updateInstallationItems(ctx.scope, id, [{ id: challanItemId, fitStatus, placement }], ctx.user.id);
      return { ok: true };
    }

    // ---- unused goods and material (R2/R3) - the installation's team only
    if (['return_unused', 'raise_challan', 'unused_parts', 'edit_challan', 'withdraw_challan'].includes(action ?? '')) {
      if (!partsOn(access)) throw new V1Error('Parts are switched off for your role - ask the office (Settings > Roles > Phone app).', 403);
      const onTeam = await db.installationChallanAssignee.count({ where: { challanId: id, userId: ctx.user.id } });
      if (!onTeam) throw new V1Error('You are not on this installation\'s team.', 403);
    }

    if (action === 'return_unused') {
      // Goods from the order coming back: a request - the store receives them.
      const challanItemId = str(b.challanItemId, 60);
      if (!challanItemId) throw new V1Error('Which item?', 400);
      const item = await db.installationChallanItem.count({ where: { id: challanItemId, challanId: id } });
      if (!item) throw new V1Error('That item is not on this installation.', 400);
      await requestInstallationReturn(ctx.scope, challanItemId, Number(b.qty ?? 0), ctx.user.id);
      return { ok: true };
    }

    if (action === 'raise_challan') {
      const lines = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]).map((l) => ({ productId: String(l?.productId ?? ''), qty: Number(l?.qty ?? 0) })) : [];
      const r = await raiseInstallationChallan(ctx.scope, id, { type: String(b.type ?? ''), lines, note: str(b.note, 1000) }, ctx.user.id, 'technician');
      return { ok: true, challanNo: r.challanNo };
    }

    // A material challan not yet issued, put right by whoever raised it (22 Oct 2026).
    if (action === 'edit_challan') {
      const lines = Array.isArray(b.lines) ? (b.lines as Record<string, unknown>[]).map((l) => ({ productId: String(l?.productId ?? ''), qty: Number(l?.qty ?? 0) })) : [];
      const r = await editJobChallan(ctx.scope, str(b.challanId, 60) ?? '', { installationChallanId: id }, { type: str(b.type, 20), lines, note: str(b.note, 1000) }, ctx.user.id, 'technician');
      return { ok: true, challanNo: r.challanNo };
    }

    if (action === 'withdraw_challan') {
      const r = await withdrawJobChallan(ctx.scope, str(b.challanId, 60) ?? '', { installationChallanId: id }, str(b.reason, 500), ctx.user.id, 'technician');
      return { ok: true, challanNo: r.challanNo };
    }

    if (action === 'unused_parts') {
      // Material from a challan coming back - the same request as a complaint's.
      await requestPartsReturn(ctx.scope, str(b.lineId, 60) ?? '', Number(b.qty ?? 0), ctx.user.id, { installationChallanId: id });
      return { ok: true };
    }

    throw new V1Error(`Unknown action "${action}".`, 400);
  });
}
