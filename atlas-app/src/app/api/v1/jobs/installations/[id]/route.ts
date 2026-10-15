import { field, jsonBody, str, V1Error } from '@/server/auth/v1-staff';
import { scanUnitOntoChallan, technicianInstallation } from '@/server/field-app';
import { setInstallationChallanStatus } from '@/server/installation-challans';
import { setInstallationStage, updateInstallationItems } from '@/server/installation-page';

type Params = { params: Promise<{ id: string }> };

/** One fitting: the site, what goes in, and what has been scanned so far. */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['orders.view', 'orders.edit'], 'installations', async (ctx) => {
    const c = await technicianInstallation(ctx.scope, id);
    if (!c) throw new V1Error('That job is not in your scope.', 404);
    return { installation: c, canEdit: ctx.permissions.has('orders.edit') };
  });
}

/**
 * Two things a technician does on site: scan an item as it goes in, and say the
 * work is done.
 *
 * `scan` is per item rather than per job on purpose. A fitting runs for hours
 * and a phone loses signal in a basement; scanning six cameras in one request
 * means losing all six because the last one failed.
 */
export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['orders.edit'], 'installations', async (ctx) => {
    const b = await jsonBody(req);
    const action = str(b.action, 40);

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
      await setInstallationChallanStatus(ctx.scope, { id, to: 'work_done' }, ctx.user.id);
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

    throw new V1Error(`Unknown action "${action}".`, 400);
  });
}
