import { requireContext } from '@/server/context';
import { challansToIssue, faultyPartsFor, returnsToReceive, stockShortfall } from '@/server/job-challans';
import { getJobSettings } from '@/server/job-settings';
import { JobPartsQueue } from './JobPartsQueue';

/**
 * Inventory > Parts counter (workflow slice 4; renamed from "Job parts to
 * issue" and laid out as the flow, 15 Oct 2026): the store's queue of job
 * challans - waiting for approval, approved but held (serial items to pick,
 * or stock short), issued as a GDN (stock and cost moved then) and to hand
 * over, and what is coming back - unused parts (stock moves only when
 * received here, 28 Sep 2026) and faulty / replaced old units.
 */
export default async function JobPartsPage() {
  const ctx = await requireContext();
  const [challans, faulty, returns] = await Promise.all([challansToIssue(ctx.scope), faultyPartsFor(ctx.scope, { pendingOnly: true }), returnsToReceive(ctx.scope)]);

  // Why an approved challan is still here (15 Oct 2026): with the automatic
  // GDN on, the only reasons are serial items to pick and stock that is short
  // - and the second was invisible, so a challan just sat there.
  const single = ctx.scope.kind === 'single' ? ctx.scope.storeId : null;
  const held = challans.filter((c) => c.status === 'approved');
  const short = single
    ? Object.fromEntries(await Promise.all(held.map(async (c) => [c.id, await stockShortfall(single, c.id)] as const)))
    : {};
  const autoGdn = single ? (await getJobSettings(single)).autoIssueGdn : true;

  return (
    <JobPartsQueue
      challans={challans.map((c) => ({ ...c, createdAt: c.createdAt.toISOString(), short: short[c.id] ?? [] }))}
      faulty={faulty.map((f) => ({
        id: f.id, complaintId: f.complaintId, complaintNo: f.complaint.complaintNo, description: f.description,
        serialNo: f.serialNo, productName: f.product?.productName ?? null, loggedAt: f.loggedAt.toISOString(),
      }))}
      returns={returns}
      canIssue={ctx.permissions.has('stock.adjust')}
      autoGdn={autoGdn}
    />
  );
}
