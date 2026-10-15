import { field, V1Error } from '@/server/auth/v1-staff';
import { customer360 } from '@/server/customer-360';
import { salesReach } from '@/server/sales-reach';
import { configFor } from '@/server/config';

type Params = { params: Promise<{ id: string }> };

/**
 * One customer on the phone (13 Oct 2026, native admin app part 4): the
 * website's customer page (server/customer-360) - what they owe and how late,
 * their documents, jobs, the items they hold (warranty, AMC) and recent
 * activity. "Whose documents they see" and "show customer phone" apply as on
 * the website.
 */
export async function GET(req: Request, { params }: Params) {
  const { id } = await params;
  return field(req, ['customers.view', 'customers.create', 'customers.edit'], null, async (ctx) => {
    const c = await customer360(ctx.scope, id, undefined, new Date(), await salesReach(ctx));
    if (!c) throw new V1Error('That customer is not in this branch.', 404);
    const showPhone = (await configFor(ctx)).on('web.show.customerPhone');
    return {
      customer: {
        id: c.party.id, code: c.party.partyCode, name: c.party.name, company: c.party.companyName,
        phone: showPhone ? `${c.party.phoneCc} ${c.party.phone}` : '', phoneDial: `${c.party.phoneCc}${c.party.phone}`.replace(/[^\d+]/g, ''),
        email: c.party.email, gstin: c.party.gstin, address: c.party.address, since: c.party.customerSince,
        creditLimitPaise: c.party.creditLimitPaise, managerName: c.party.managerName,
      },
      figures: {
        lifetimePaise: c.figures.lifetimePaise, invoiceCount: c.figures.invoiceCount, overduePaise: c.figures.overduePaise,
        oldestDays: c.figures.oldestDays, paidFyPaise: c.figures.paidFyPaise, lastPaymentAt: c.figures.lastPaymentAt,
        openJobs: c.figures.openJobs, nextVisit: c.figures.nextVisit, inWarranty: c.figures.inWarranty,
        activeAmc: c.figures.activeAmc ? { contractNo: (c.figures.activeAmc as { contractNo?: string }).contractNo ?? null, endDate: c.figures.activeAmc.endDate } : null,
        aging: c.figures.aging,
      },
      docs: c.docs.slice(0, 60).map((d) => ({ id: d.id, type: d.type, no: d.no, at: d.at, amountPaise: d.amountPaise, duePaise: d.duePaise ?? null, status: d.status, note: d.note })),
      jobs: c.jobs.slice(0, 40).map((j) => ({ id: j.id, no: j.no, at: j.at, item: j.item, status: j.status, tone: j.tone, techName: j.techName, nextVisit: j.nextVisit })),
      items: c.items.slice(0, 60).map((u) => ({ id: u.id, serial: u.serial, product: u.product, status: u.status, warrantyUntil: u.warrantyUntil, amc: u.amc, invoiceNo: u.invoice?.no ?? null })),
      activity: c.activity.slice(0, 30).map((a) => ({ id: a.id, kind: a.kind, title: a.title, detail: a.detail, at: a.at, byName: a.byName })),
    };
  });
}
