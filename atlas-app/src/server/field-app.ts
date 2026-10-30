import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { applyMovements } from './stock';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { INSTALL_STAGES, stageLabel } from '@/lib/installation-stages';
import { settleOrderUnit } from './serial-links';

/**
 * What a technician sees on their phone.
 *
 * Three things Pravin asked for after clicking through the archetype, all of
 * which turn out to be screens rather than systems:
 *
 *   1. Installations get their own list, separate from complaints. A complaint
 *      is something that broke; an installation is work that was sold. Sharing
 *      one list made somebody read past four repairs to find the fitting they
 *      were standing outside.
 *
 *   2. A visit shows the CALLS made to that site. `CallLog` has synced every
 *      phone's call log for weeks and matches the number to a customer; what it
 *      has never done is show those calls next to the visit they were about.
 *
 *   3. The van the technician is carrying, and marking stock used from the
 *      site rather than from the office.
 */

/* -------------------------------------------------------------------------- */
/*  Installations                                                             */
/* -------------------------------------------------------------------------- */

export interface FieldInstallationRow {
  id: string;
  challanNo: string;
  status: string;
  dispatchedAt: Date;
  orderNo: string | null;
  customerName: string;
  siteAddress: string | null;
  itemCount: number;
  totalQty: number;
  /** How many lines still need a unit scanned against them. */
  unscanned: number;
}

/**
 * Installation challans this technician is on.
 *
 * Assignment is the filter, not the branch. A technician's list is their own
 * work; a list of every fitting in the branch is a report, and a report on a
 * phone is a scroll nobody reads to the bottom of.
 */
export async function technicianInstallations(
  scope: StoreScope,
  userId: string,
  opts: { all?: boolean } = {},
): Promise<FieldInstallationRow[]> {
  const rows = await db.installationChallan.findMany({
    where: {
      ...scopeWhere(scope),
      // Rejected work is somebody else's problem until it comes back.
      status: { notIn: ['rejected'] },
      ...(opts.all ? {} : { assignees: { some: { userId } } }),
    },
    orderBy: { dispatchedAt: 'desc' },
    take: LIST_MAX_ROWS,
    select: {
      id: true, challanNo: true, status: true, stage: true, dispatchedAt: true, siteLocation: true,
      salesOrder: {
        select: {
          orderNo: true, customerName: true, organizationName: true,
          shippingAddress: true, billingAddress: true,
        },
      },
      customer: { select: { firstName: true, lastName: true, companyName: true, phone: true, phoneCc: true, addressLine1: true } },
      items: { select: { qty: true, stockUnitId: true, product: { select: { trackingMode: true } } } },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    challanNo: c.challanNo,
    status: c.status,
    // The working stage the website shows (G2, 11 Oct 2026). Added, never
    // replacing `status` - older app versions read status.
    stage: c.stage,
    stageLabel: stageLabel(c.stage),
    dispatchedAt: c.dispatchedAt,
    orderNo: c.salesOrder?.orderNo ?? null,
    customerName: (c.customer && (c.customer.companyName || [c.customer.firstName, c.customer.lastName].filter(Boolean).join(' '))) || c.salesOrder?.organizationName || c.salesOrder?.customerName || 'No customer',
    siteAddress: c.siteLocation ?? c.salesOrder?.shippingAddress ?? c.salesOrder?.billingAddress ?? c.customer?.addressLine1 ?? null,
    itemCount: c.items.length,
    totalQty: c.items.reduce((t, i) => t + i.qty, 0),
    // Only serial lines can be scanned. Counting a cable line as "unscanned"
    // would leave a job that can never show as finished.
    unscanned: c.items.filter((i) => i.product?.trackingMode === 'serial' && !i.stockUnitId).length,
  }));
}

/**
 * Stages move by themselves since 27 Oct 2026, so the phone is never offered
 * one to tap. Builds before 1.0.33 read `nextStage`; null hides their button.
 */
const phoneNextStage = (_stage: string, _status: string): string | null => null;

export async function technicianInstallation(scope: StoreScope, challanId: string) {
  const c = await db.installationChallan.findFirst({
    where: { id: challanId, ...scopeWhere(scope) },
    select: {
      id: true, challanNo: true, status: true, stage: true, priority: true, dispatchedAt: true,
      technicianRemark: true, note: true, physicalChallanNo: true, isInvoiced: true, siteLocation: true,
      customer: { select: { firstName: true, lastName: true, companyName: true, phone: true, phoneCc: true, addressLine1: true } },
      salesOrder: {
        select: {
          id: true, orderNo: true, customerName: true, organizationName: true,
          phone: true, shippingAddress: true, billingAddress: true,
          items: { select: { dispatchedQty: true } },
        },
      },
      items: {
        orderBy: { srNo: 'asc' },
        select: {
          id: true, productId: true, productName: true, qty: true, unit: true, qtyReturned: true, qtyReturnPending: true,
          barcode: true, stockUnitId: true, placement: true, fitStatus: true, serialNo: true,
          stockUnit: { select: { serialNo: true } },
          product: { select: { productCode: true, trackingMode: true } },
        },
      },
      assignees: { select: { user: { select: { id: true, fullName: true } } } },
    },
  });
  if (!c) return null;

  return {
    id: c.id,
    challanNo: c.challanNo,
    status: c.status,
    // G2 (11 Oct 2026): the website's working stage, and the one a person can
    // move it to from the phone. Handover and approval are not offered - they
    // record who received it and start the warranty (website).
    stage: c.stage,
    stageLabel: stageLabel(c.stage),
    nextStage: phoneNextStage(c.stage, c.status),
    nextStageLabel: phoneNextStage(c.stage, c.status) ? stageLabel(phoneNextStage(c.stage, c.status)!) : null,
    stages: INSTALL_STAGES.map((x) => ({ key: x.key, label: x.label })),
    priority: c.priority,
    dispatchedAt: c.dispatchedAt,
    isInvoiced: c.isInvoiced,
    technicianRemark: c.technicianRemark,
    note: c.note,
    physicalChallanNo: c.physicalChallanNo,
    orderId: c.salesOrder?.id ?? null,
    orderNo: c.salesOrder?.orderNo ?? null,
    customerName: (c.customer && (c.customer.companyName || [c.customer.firstName, c.customer.lastName].filter(Boolean).join(' '))) || c.salesOrder?.organizationName || c.salesOrder?.customerName || 'No customer',
    phone: c.customer?.phone ? [c.customer.phoneCc, c.customer.phone].filter(Boolean).join(' ') : c.salesOrder?.phone ?? null,
    siteAddress: c.siteLocation ?? c.salesOrder?.shippingAddress ?? c.salesOrder?.billingAddress ?? c.customer?.addressLine1 ?? null,
    team: c.assignees.map((a) => a.user.fullName),
    items: c.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.productName,
      productCode: i.product?.productCode ?? null,
      qty: i.qty,
      unit: i.unit,
      // `barcode` is the text that was on the paper slip; `serialNo` is the
      // unit it is linked to. They are not the same fact and both are shown.
      barcode: i.barcode,
      serialNo: i.stockUnit?.serialNo ?? i.serialNo ?? null,
      // Where it goes on site and whether it is in (G2) - the same fields the
      // website's "What is being installed" table edits.
      placement: i.placement,
      fitStatus: i.fitStatus,
      scannable: i.product?.trackingMode === 'serial',
      scanned: !!i.stockUnitId,
      // Unused, back against the order's GDN (R2, 22 Oct 2026).
      qtyReturned: i.qtyReturned,
      qtyReturnPending: i.qtyReturnPending,
    })),
    // The order's goods have left on its GDN - before that nothing can come back.
    dispatched: (c.salesOrder?.items ?? []).some((i) => i.dispatchedQty > 0),
  };
}

/**
 * Scan a unit against a challan line, from the site.
 *
 * The unit must be one the technician could actually be holding: in stock, of
 * the right product, and not already on another line. Checked rather than
 * trusted, because a scanner at a customer's premises reads whatever barcode
 * is nearest and a wrong link here is a wrong warranty for the next five years.
 */
export async function scanUnitOntoChallan(
  scope: StoreScope,
  input: { challanItemId: string; serialNo: string },
  userId: string,
) {
  const item = await db.installationChallanItem.findFirst({
    where: { id: input.challanItemId, challan: { ...scopeWhere(scope) } },
    select: {
      id: true, productId: true, productName: true, stockUnitId: true,
      challan: { select: { id: true, challanNo: true, storeId: true, salesOrderId: true } },
    },
  });
  if (!item) throw new Error('That line is not in your scope.');
  if (!item.productId) throw new Error(`${item.productName} is not linked to a product, so it cannot be scanned.`);

  const serial = input.serialNo.trim();
  if (!serial) throw new Error('Nothing was scanned.');

  const unit = await db.stockUnit.findFirst({
    where: { ...scopeWhere(scope), serialNo: { equals: serial, mode: 'insensitive' } },
    select: { id: true, productId: true, status: true, serialNo: true, warehouseId: true },
  });
  if (!unit) throw new Error(`No item on record with the number ${serial}.`);
  if (unit.productId !== item.productId) {
    throw new Error(`${serial} is a different product from ${item.productName}.`);
  }

  const already = await db.installationChallanItem.findFirst({
    // Scoped through the challan, which carries the store. The unit was already
    // looked up in scope so nothing outside it could hold this one anyway, but
    // the coverage test reads call sites literally and is right to: a query
    // that happens to be safe because of an earlier one is a query that stops
    // being safe the day somebody reorders the function.
    where: { stockUnitId: unit.id, id: { not: item.id }, challan: scopeWhere(scope) },
    select: { challan: { select: { challanNo: true } } },
  });
  if (already) throw new Error(`${serial} is already on ${already.challan.challanNo}.`);
  // The order may have sent stock already: the scanned unit becomes the one it
  // sent, so the customer, the bill and Product History name it (29 Oct 2026).
  if (item.challan.salesOrderId && unit.id !== item.stockUnitId) {
    await settleOrderUnit(scope, item.challan.salesOrderId, item.productId, unit.id, item.stockUnitId, `Scanned at the site on ${item.challan.challanNo}`, userId);
  }

  return db.installationChallanItem.update({
    where: { id: item.id },
    data: { stockUnitId: unit.id, barcode: item.stockUnitId ? undefined : unit.serialNo },
    select: { id: true, stockUnitId: true },
  });
}

/* -------------------------------------------------------------------------- */
/*  A visit, and the calls that led to it                                     */
/* -------------------------------------------------------------------------- */

export interface VisitCall {
  id: string;
  startedAt: Date;
  direction: string;
  durationSec: number;
  /** True when it rang out. The thing a manager is actually looking for. */
  unanswered: boolean;
}

/**
 * One visit, with the technician's calls to that customer around it.
 *
 * THE JOIN THAT DID NOT EXIST. `CallLog` has synced every phone's call log for
 * weeks, matched the number to a party, and recorded that a zero-second call
 * means nobody picked up. None of that was ever shown against the visit it was
 * about, so "did he ring before driving out there?" needed two screens and a
 * guess.
 *
 * Matched on the technician plus the customer's number plus a window around the
 * appointment, rather than stored on the visit. A call is not made against a
 * visit - somebody rings a customer, and whether that call was about Tuesday's
 * appointment is an inference. Storing the inference would freeze it; deriving
 * it means a call that syncs late still appears.
 */
export async function visitDetail(scope: StoreScope, visitId: string) {
  const v = await db.serviceVisit.findFirst({
    where: { id: visitId, OR: [scopeWhere(scope), { complaint: scopeWhere(scope) }] },
    select: {
      id: true, scheduledAt: true, status: true, purpose: true, reason: true, outcomeNote: true,
      checkedInAt: true, checkInWithinRange: true, technicianId: true, siteAddress: true,
      technician: { select: { fullName: true } },
      // A survey's own customer (27 Oct 2026) - no complaint or challan to borrow one from.
      customer: { select: { companyName: true, firstName: true, lastName: true, title: true, phone: true, phoneCc: true, addressLine1: true, city: true } },
      changes: {
        orderBy: { createdAt: 'desc' },
        select: { fromAt: true, toAt: true, kind: true, reason: true, requestedByCustomer: true, createdAt: true },
      },
      complaint: {
        select: {
          id: true, complaintNo: true, description: true, siteLocation: true,
          siteLat: true, siteLng: true,
          site: { select: { name: true, address: true, contactPhone: true } },
          customer: {
            select: {
              companyName: true, firstName: true, lastName: true, title: true,
              phone: true, phoneCc: true, addressLine1: true, city: true,
            },
          },
        },
      },
      /*
        A NEW INSTALLATION'S VISIT (7 Oct 2026).

        A visit can now be booked against an installation challan rather than
        a complaint, so this screen has to draw both. Handled here rather than
        returning null for an installation, because a technician whose job
        list shows a visit and whose visit screen shows nothing would conclude
        the app was broken.

        The same fields are filled from the challan - the challan number where
        the complaint number went, the items where the fault description went
        - so an APK built before today still renders the screen, and a newer
        one can use `subject` to word it as an installation.
      */
      installationChallan: {
        select: {
          id: true, challanNo: true, note: true, siteLocation: true, siteLat: true, siteLng: true,
          items: { select: { productName: true, qty: true }, orderBy: { srNo: 'asc' }, take: 12 },
          /*
            The ORDER'S buyer snapshot, not the party record. An order keeps
            the name, phone and shipping address as they were when it was
            confirmed, which is what the technician should be reading - the
            customer may have changed their address since, but the goods were
            promised to the one on the order.
          */
          salesOrder: { select: { customerName: true, phone: true, shippingAddress: true, billingAddress: true } },
        },
      },
    },
  });
  if (!v) return null;

  const ch = v.installationChallan;
  const order = ch?.salesOrder ?? null;
  const cu = v.complaint?.customer ?? v.customer ?? undefined;
  // The complaint's contact first, then the site's, then the order's.
  const phone = v.complaint?.site?.contactPhone ?? cu?.phone ?? order?.phone ?? null;

  /**
   * A window around the appointment, not the whole history.
   *
   * Three days before and one after: the calls that matter are the ones
   * arranging the visit and the one made on the doorstep. A month of calls to
   * a regular customer would bury both.
   */
  const from = new Date(v.scheduledAt.getTime() - 3 * 86_400_000);
  const to = new Date(v.scheduledAt.getTime() + 86_400_000);
  const last10 = (phone ?? '').replace(/\D/g, '').slice(-10);

  const calls = last10.length === 10
    ? await db.callLog.findMany({
      where: {
        ...scopeWhere(scope),
        userId: v.technicianId,
        e164Number: { endsWith: last10 },
        startedAt: { gte: from, lte: to },
      },
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: { id: true, startedAt: true, direction: true, durationSec: true },
    })
    : [];

  return {
    id: v.id,
    scheduledAt: v.scheduledAt,
    status: v.status,
    purpose: v.purpose,
    outcomeNote: v.outcomeNote,
    checkedInAt: v.checkedInAt,
    checkInWithinRange: v.checkInWithinRange,
    technicianName: v.technician.fullName,
    /** 'complaint' | 'installation' - what this visit is for (7 Oct 2026). */
    subject: v.complaint ? 'complaint' as const : ch ? 'installation' as const : 'survey' as const,
    reason: v.reason,
    complaintId: v.complaint?.id ?? null,
    installationChallanId: ch?.id ?? null,
    /* The document the technician quotes on the phone - either number. */
    complaintNo: v.complaint?.complaintNo ?? ch?.challanNo ?? 'Survey',
    description: v.complaint?.description
      ?? (ch ? [ch.items.map((i) => `${i.productName} x${i.qty}`).join(', '), ch.note].filter(Boolean).join(' - ') : 'Survey before installing - look at the site and note what is needed.'),
    customerName: (cu && (cu.companyName || [cu.title, cu.firstName, cu.lastName].filter(Boolean).join(' ').trim()))
      || order?.customerName
      || 'Customer not on the challan',
    phone: phone ? [cu?.phoneCc, phone].filter(Boolean).join(' ') : null,
    siteName: v.complaint?.site?.name ?? null,
    siteAddress: v.complaint?.site?.address
      ?? v.complaint?.siteLocation
      // An installation's visit goes to the challan's site (30 Oct 2026) - not the customer's main address.
      ?? ch?.siteLocation
      ?? v.siteAddress
      ?? (cu ? [cu.addressLine1, cu.city].filter(Boolean).join(', ') : '')
      // For an installation, where the goods were going.
      ?? order?.shippingAddress
      ?? order?.billingAddress
      ?? null,
    // Only a complaint carries captured site coordinates, so an installation
    // visit has no map pin and no check-in. Said once, in complaints.ts.
    siteLat: v.complaint?.siteLat ? Number(v.complaint.siteLat) : ch?.siteLat ? Number(ch.siteLat) : null,
    siteLng: v.complaint?.siteLng ? Number(v.complaint.siteLng) : ch?.siteLng ? Number(ch.siteLng) : null,
    calls: calls.map((c): VisitCall => ({
      id: c.id,
      startedAt: c.startedAt,
      direction: c.direction,
      durationSec: c.durationSec,
      // Zero connected seconds on a call that was placed. This is the whole
      // reason `durationSec` is kept rather than a connected flag.
      unanswered: c.durationSec === 0 && c.direction === 'outgoing',
    })),
    changes: v.changes.map((ch) => ({
      kind: ch.kind,
      fromAt: ch.fromAt,
      toAt: ch.toAt,
      reason: ch.reason,
      requestedByCustomer: ch.requestedByCustomer,
      createdAt: ch.createdAt,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/*  The van, from the phone                                                   */
/* -------------------------------------------------------------------------- */

export interface VanItem {
  productId: string;
  productName: string;
  productCode: string | null;
  unit: string | null;
  qty: number;
  trackingMode: string;
  /** Serial units sitting in this van, so the app can offer them by number. */
  units: { id: string; serialNo: string | null }[];
}

/** What this person is carrying. */
export async function myVan(scope: StoreScope, userId: string) {
  const van = await db.warehouse.findFirst({
    where: { ...scopeWhere(scope), kind: 'van', holderId: userId, isActive: true },
    select: { id: true, name: true, code: true },
  });
  if (!van) return null;

  const [balances, units] = await Promise.all([
    db.productBalance.findMany({
      where: { warehouseId: van.id, currentQty: { not: 0 }, product: scopeWhere(scope) },
      select: {
        productId: true, currentQty: true,
        product: { select: { productName: true, productCode: true, unit: true, trackingMode: true } },
      },
    }),
    db.stockUnit.findMany({
      where: { ...scopeWhere(scope), warehouseId: van.id, status: 'in_stock' },
      select: { id: true, productId: true, serialNo: true },
      take: LIST_MAX_ROWS,
    }),
  ]);

  const byProduct = new Map<string, { id: string; serialNo: string | null }[]>();
  for (const u of units) {
    if (!byProduct.has(u.productId)) byProduct.set(u.productId, []);
    byProduct.get(u.productId)!.push({ id: u.id, serialNo: u.serialNo });
  }

  return {
    id: van.id,
    name: van.name,
    code: van.code,
    items: balances
      .map((b): VanItem => ({
        productId: b.productId,
        productName: b.product.productName,
        productCode: b.product.productCode,
        unit: b.product.unit,
        qty: b.currentQty,
        trackingMode: b.product.trackingMode,
        units: byProduct.get(b.productId) ?? [],
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName)),
  };
}

/**
 * Stock fitted at a customer's site, marked from the phone.
 *
 * THIS is the moment stock leaves the business. Loading a van moved it between
 * warehouses and changed nothing on the books; this takes it out, against a
 * job, with the customer's name on it.
 *
 * Refused beyond what the van is carrying. A technician cannot fit six cameras
 * from a van the ledger says holds four, and allowing it would create stock out
 * of nothing at exactly the moment nobody is watching.
 */
export async function fitFromVan(
  scope: StoreScope,
  input: {
    complaintId?: string | null;
    challanId?: string | null;
    lines: { productId: string; qty: number; stockUnitIds?: string[] }[];
    note?: string | null;
  },
  userId: string,
) {
  const van = await db.warehouse.findFirst({
    where: { ...scopeWhere(scope), kind: 'van', holderId: userId, isActive: true },
    select: { id: true, name: true, code: true, storeId: true },
  });
  if (!van) throw new Error('You do not have a van. Ask the branch to set one up and load it.');

  const lines = input.lines.filter((l) => l.qty > 0);
  if (lines.length === 0) throw new Error('Nothing to record.');

  const held = new Map(
    (await db.productBalance.findMany({
      where: {
        warehouseId: van.id,
        productId: { in: lines.map((l) => l.productId) },
        product: scopeWhere(scope),
      },
      select: { productId: true, currentQty: true, product: { select: { productName: true } } },
    })).map((b) => [b.productId, b]),
  );

  const over = lines.find((l) => l.qty > (held.get(l.productId)?.currentQty ?? 0));
  if (over) {
    const h = held.get(over.productId);
    throw new Error(
      `Your van has ${h?.currentQty ?? 0} of ${h?.product.productName ?? 'that item'}, `
      + `so ${over.qty} cannot be fitted. Tell the branch what is actually on board.`,
    );
  }

  // Who it went to, so the units carry their customer. Null is tolerated - a
  // job with no customer on it is rare and real - and then nothing is bound,
  // rather than a unit claiming a customer who does not exist.
  const partyId = input.complaintId
    ? (await db.complaint.findFirst({
      where: { id: input.complaintId, ...scopeWhere(scope) },
      select: { customerId: true },
    }))?.customerId ?? null
    : input.challanId
      ? (await db.installationChallan.findFirst({
        where: { id: input.challanId, ...scopeWhere(scope) },
        select: { salesOrder: { select: { partyId: true } } },
      }))?.salesOrder?.partyId ?? null
      : null;

  const note = input.note?.trim() || `Fitted on site from ${van.name}`;

  return db.$transaction(async (tx) => {
    await applyMovements(tx, van.storeId, userId, lines.map((l) => ({
      productId: l.productId,
      qty: -l.qty,
      reason: 'job_issue' as const,
      warehouseId: van.id,
      refType: input.challanId ? 'InstallationChallan' : 'Complaint',
      refId: input.challanId ?? input.complaintId ?? van.id,
      refNo: van.code,
      note,
      // It went to a customer. This is the one van movement where that is true.
      unitDestination: partyId ? ('customer' as const) : undefined,
      partyId,
      stockUnitIds: l.stockUnitIds,
    })));
    return { vanName: van.name, lines: lines.length };
  });
}
