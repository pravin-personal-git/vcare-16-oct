import { notFound } from 'next/navigation';
import { visibleComplaintFilter } from '@/server/complaint-visibility';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { getComplaintDetail, listTechnicians } from '@/server/complaints';
import { resolveSplitCoverFor } from '@/server/amc';
import { complaintItems, jobCoverFromItems } from '@/server/complaint-items';
import { ComplaintView } from './ComplaintView';
import { callsWithParty } from '@/server/call-logs';
import { faultyPartsFor, jobChallansFor } from '@/server/job-challans';
import { catalogueOptions } from '@/server/form-options';
import { getJobSettings } from '@/server/job-settings';
import { documentTrail } from '@/server/document-trail';
import { listAttachments } from '@/server/attachments';
import { repairPricePaise } from '@/lib/rma';
import { handBackOptions } from '@/server/item-handback';
import { jobBillDraft } from '@/server/job-billing';

/**
 * One complaint, on its own page (health check SVC-2) - replacing the
 * Complaint Tracker's list-plus-panel, which re-filtered all 3,548 complaints
 * on every keystroke (B1) and gave labels and values the same weight (I3).
 * Legacy fields are labelled and the old-system technician id shows the
 * person's name (I1); repair challans link to their own page (I2).
 */
export default async function ComplaintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const detail = await getComplaintDetail(ctx.scope, id);
  if (!detail) notFound();
  {
    const visible = await visibleComplaintFilter(ctx);
    if (visible && !visible({ id: detail.id, assignedTechnicianId: detail.assignedTechnicianId })) notFound();
  }

  const legacyTechId = typeof detail.customFields.legacyAssignedTechnicianId === 'string'
    ? detail.customFields.legacyAssignedTechnicianId : null;

  const canEdit = ctx.permissions.has('complaints.edit');
  const [coverage, technicians, legacyTech, calls, challans, faulty, catalogue, items] = await Promise.all([
    resolveSplitCoverFor(ctx.scope, { customerId: detail.customerId, productId: detail.productId, onDate: detail.createdAt }),
    listTechnicians(ctx.scope),
    legacyTechId ? db.user.findFirst({ where: { legacyRef: legacyTechId }, select: { fullName: true } }) : Promise.resolve(null),
    // From a day before it was raised: the call that led to the complaint counts too.
    callsWithParty(ctx.scope, detail.customerId, new Date(detail.createdAt.getTime() - 86_400_000)).catch(() => []),
    jobChallansFor(ctx.scope, detail.id),
    faultyPartsFor(ctx.scope, { complaintId: detail.id }),
    // The product list only when this person can raise a challan or log a part.
    canEdit ? catalogueOptions(ctx.scope) : Promise.resolve([]),
    complaintItems(ctx.scope, { id: detail.id, customerId: detail.customerId, createdAt: detail.createdAt }),
  ]);
  // The job's answer: from its items when it has them (stage 2), else its one product.
  const byItems = jobCoverFromItems(items);
  const labourFree = byItems ? byItems.labourFree : coverage.labour.free;
  const partsFree = byItems ? byItems.partsFree : coverage.parts.free;
  const jobStore = await db.complaint.findUnique({ where: { id: detail.id }, select: { storeId: true } });

  // The sale this equipment came from - the warranty is counted from it, so the
  // links column shows it under "Sale & cover" (layout A, 9 Oct 2026). The same
  // rule the coverage check uses: the latest issued invoice line for it.
  const saleLine = detail.productId
    ? await db.invoiceItem.findFirst({
      where: { productId: detail.productId, invoice: { storeId: jobStore!.storeId, partyId: detail.customerId, lifecycle: { not: 'draft' } } },
      orderBy: { invoice: { invoiceDate: 'desc' } },
      select: { invoice: { select: { id: true, invoiceNo: true, invoiceDate: true } } },
    })
    : null;
  const jobSettings = await getJobSettings(jobStore!.storeId);
  // Back from the supplier and ready for the customer (stage 6) - only read when something is.
  const handBack = items.some((i) => i.status === 'back' || i.status === 'supplier_closed') ? await handBackOptions(ctx.scope, detail.id) : [];

  // The whole paper trail of this job - visits, challans, GDNs, replacements,
  // then the invoice and what was paid (F1b / D18). Every link goes to the
  // record itself, never to a list.
  const trail = await documentTrail(ctx.scope, 'complaint', detail.id);

  /**
   * JOB PHOTOS (3 Oct 2026). The portal has had a "Show job photos" switch since
   * F1a with nothing behind it - no model, no upload, no screen. A photo of a job
   * is a document attached to that job, so it reuses `DocumentAttachment` and
   * inherits its storage, signed links, size and type limits, audit trigger and
   * tombstone behaviour rather than getting a table of its own.
   */
  const photos = await listAttachments(ctx.scope, 'complaint', detail.id).catch(() => []);

  const iso = (d: Date | null) => (d ? d.toISOString() : null);

  return (
    <ComplaintView
      trail={trail}
      handBack={handBack}
      bill={!detail.invoice && detail.billingStatus !== 'waived' ? await jobBillDraft(ctx.scope, detail.id, { items }) : null}
      items={items.map((i) => ({ ...i, cover: {
        labour: { ...i.cover.labour, until: i.cover.labour.until?.toISOString() ?? null },
        parts: { ...i.cover.parts, until: i.cover.parts.until?.toISOString() ?? null },
        uncertain: i.cover.uncertain,
      } }))}
      sale={saleLine ? { id: saleLine.invoice.id, invoiceNo: saleLine.invoice.invoiceNo, date: saleLine.invoice.invoiceDate.toISOString() } : null}
      photos={photos.map((f) => ({
        id: f.id, fileName: f.fileName, fileSize: f.fileSize, mimeType: f.mimeType,
        url: f.url, label: f.label, uploadedAt: f.uploadedAt.toISOString(),
        uploadedByName: f.uploadedByName,
        tag: f.tag, visibleToCustomer: f.visibleToCustomer, extracted: f.extracted, olderVersions: f.olderVersions,
      }))}
      detail={{
        ...detail,
        createdAt: detail.createdAt.toISOString(),
        acceptedAt: iso(detail.acceptedAt),
        closedAt: iso(detail.closedAt),
        activities: detail.activities.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
        visits: detail.visits.map((v) => ({
          ...v, scheduledAt: v.scheduledAt.toISOString(), completedAt: iso(v.completedAt), checkedInAt: iso(v.checkedInAt),
          changes: v.changes.map((ch) => ({ ...ch, fromAt: ch.fromAt.toISOString(), toAt: iso(ch.toAt), createdAt: ch.createdAt.toISOString() })),
        })),
        challans: detail.challans.map((c) => ({ ...c, dispatchedAt: c.dispatchedAt.toISOString() })),
      }}
      coverage={coverage}
      technicians={technicians}
      legacyTechnicianName={legacyTech?.fullName ?? null}
      canEdit={ctx.permissions.has('complaints.edit')}
      calls={calls.map((c) => ({ ...c, startedAt: c.startedAt.toISOString() }))}
      estimateSeed={[
        // Two switches (10 Oct 2026): visits charged only without an AMC - per
        // visit - and parts only when the warranty does not cover them.
        ...(jobSettings.visitChargePaise > 0 && !labourFree ? [{ description: 'Visit charge', qty: Math.max(1, detail.visits.filter((v) => v.status !== 'cancelled').length), unitPaise: jobSettings.visitChargePaise, taxRatePct: 18 }] : []),
        // Parts at the selling price (DLP), quantity = what was really used
        // (issued minus returned), with the product and its GST (28 Sep 2026).
        ...(partsFree ? [] : challans).filter((c) => c.status !== 'rejected').flatMap((c) => c.lines.flatMap((l) => {
          const qty = l.qtyIssued > 0 ? l.qtyIssued - l.qtyReturned : l.qty;
          const p = catalogue.find((x) => x.id === l.productId);
          return qty > 0 ? [{ description: l.productName, qty, unitPaise: p?.dlpPaise ?? 0, productId: l.productId, taxRatePct: p?.taxRatePct ?? 18 }] : [];
        })),
        // A supplier's repair the warranty does not pay for (stage 5, decision
        // 5): their quote plus the markup, per item, before GST.
        ...items.filter((i) => i.status !== 'cancelled' && !i.cover.parts.free && i.rma?.supplierQuotePaise).map((i) => ({
          description: `Repair - ${i.equipmentName}${i.serialNo ? ` (S/N ${i.serialNo})` : ''}`,
          qty: 1, unitPaise: repairPricePaise(i.rma!.supplierQuotePaise!, jobSettings.repairMarkupPct), taxRatePct: 18,
        })),
      ]}
      closeNeedsApproval={jobSettings.approvalToClose}
      canBill={ctx.permissions.has('invoice.create')}
      parts={{
        challans: challans.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
        faulty: faulty.map((f) => ({
          id: f.id, description: f.description, serialNo: f.serialNo, productName: f.product?.productName ?? null,
          loggedAt: f.loggedAt.toISOString(), receivedAt: f.receivedAt ? f.receivedAt.toISOString() : null,
          caseNo: f.replacementCase?.caseNo ?? null,
          caseId: f.replacementCaseId ?? null,
        })),
        catalogue,
        canIssue: ctx.permissions.has('stock.adjust'),
      }}
    />
  );
}
