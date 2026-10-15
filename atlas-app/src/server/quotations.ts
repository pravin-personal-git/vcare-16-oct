import 'server-only';
import { stageNamer } from './order-stages';
import { getIncentiveRule } from './incentive-settings';
import { calculateIncentive, DEFAULT_RULE } from '@/lib/incentive-rules';
import { awaitingApproval } from './approvals';
import { resolveSalesperson } from './salesperson';
import { db } from './db';
import { scopeWhere, scopeForWrite, userInScope, type StoreScope } from './store-scope';
import { computeTotals, type QuotationStatus } from '@/lib/quotation-totals';
import { resolveTaxMode } from './gst';
import { allocateDocumentNumber } from './allocate-document-number';
import { costsFor } from './product-cost';
import { computeProfit, type ProfitAnalysis } from '@/lib/quotation-profit';
import { quotationHistoryReason, type HistoryReason } from '@/lib/history-rules';
import { countAttachments } from './attachments';
import { publicBrandUrl } from './storage';

export interface QuotationRow {
  id: string;
  quotationNo: string;
  customerName: string;
  organizationName: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  quotationDate: Date;
  validUntil: Date;
  grandTotalPaise: number;
  status: QuotationStatus;
  source: 'lead' | 'customer' | 'direct';
  leadId: string | null;
  partyId: string | null;
  itemCount: number;
  /** For data reach (B4 step 3) - whose document this is. */
  salespersonId: string | null;
  salespersonName: string | null;
  closedAt: Date | null;
  /** Why it is in History, or null while it is Active. See lib/history-rules. */
  historyReason: HistoryReason | null;
  /** An approval request is open on it (e.g. sending it is held). */
  awaitingApproval: boolean;
  attachmentCount: number;
}

export async function listQuotations(
  scope: StoreScope,
  view: 'active' | 'history' | 'all' = 'active',
): Promise<QuotationRow[]> {
  const [rows, users] = await db.$transaction([
    db.quotation.findMany({
      // Active / History is decided below from status as well as closedAt,
      // so the query takes both and the split happens after.
      where: { ...scopeWhere(scope) },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.user.findMany({ where: userInScope(scope), select: { id: true, fullName: true } }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.fullName]));

  const inView = rows
    .map((q) => ({ q, historyReason: quotationHistoryReason(q) }))
    .filter(({ historyReason }) => view === 'all' || (view === 'history') === (historyReason !== null));
  const files = await countAttachments(scope, 'quotation', inView.map(({ q }) => q.id));
  const held = await awaitingApproval(scope, inView.map(({ q }) => q.id));

  return inView.map(({ q, historyReason }) => ({
    id: q.id,
    quotationNo: q.quotationNo,
    customerName: q.customerName,
    organizationName: q.organizationName,
    phone: q.phone,
    email: q.email,
    city: q.cityId,
    state: q.stateId,
    quotationDate: q.quotationDate,
    validUntil: q.validUntil,
    grandTotalPaise: q.grandTotalPaise,
    status: q.status as QuotationStatus,
    source: q.leadId ? 'lead' : q.partyId ? 'customer' : 'direct',
    leadId: q.leadId,
    partyId: q.partyId,
    itemCount: q._count.items,
    salespersonId: q.salespersonId ?? null,
    salespersonName: q.salespersonId ? name.get(q.salespersonId) ?? null : null,
    closedAt: q.closedAt,
    historyReason,
    awaitingApproval: held.has(q.id),
    attachmentCount: files.get(q.id) ?? 0,
  }));
}

export interface QuotationLineInput {
  productId: string | null;
  productName: string;
  productCode: string | null;
  qty: number;
  unitPricePaise: number;
  discountPct: number;
  taxRatePct: number;

  /**
   * The AMC quoted on this line.
   *
   * Optional so callers with nothing to do with AMC need not pass three nulls.
   * The point of having it here is that a customer asking "how much with the
   * maintenance contract?" gets the figure on the QUOTATION rather than three
   * documents later - AMC used to appear only on the invoice, which is
   * backwards for a sales business.
   *
   * Never folded into `computeTotals`: an extra-cost AMC is billed on its own
   * invoice, so adding it to the quotation's total would quote the customer a
   * number they will never be charged.
   */
  amcOpted?: boolean;
  amcMonths?: number | null;
  amcPricePaise?: number | null;
}

export interface QuotationInput {
  /**
   * GST switched OFF on this document (Vcare, 7 Oct 2026).
   *
   * Sent as an INTENT, not as a tax mode: the client says "no GST on this
   * one" and the server still decides what that means. The alternative - the
   * browser posting `taxMode` directly - would let a crafted request pick
   * CGST on an inter-state sale, which is a tax error somebody signs.
   *
   * Absent reads as false, so every existing caller keeps charging GST.
   */
  noGst?: boolean;
  leadId: string | null;
  partyId: string | null;
  customerName: string;
  organizationName: string | null;
  email: string | null;
  phone: string;
  gstin: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  stateId: string | null;
  cityId: string | null;
  validityPeriodDays: number;
  discountType: 'amount' | 'percent';
  discountValue: number;
  deliveryPaise: number;
  deliveryExempt: boolean;
  deliveryMode: string | null;
  termsBody: string | null;
  notes: string | null;
  /** Freight actually paid. Not the delivery charged to the customer. */
  transportPaise: number;
  /** Commission owed on this deal. */
  incentivePaise: number;
  /** Chosen on the form; absent = the creator (new) or unchanged (edit). */
  salespersonId?: string | null;
  lines: QuotationLineInput[];
}

/**
 * Work out what this quotation earns, from costs resolved on the server.
 *
 * The cost NEVER comes from the browser, for exactly the reason totals never
 * do: a client that can set its own cost can report any profit it likes, and a
 * margin is the number a discount decision is made against.
 *
 * A free-text line - one with no `productId` - has no purchase history and so
 * contributes revenue but no cost. `computeProfit` counts that separately
 * rather than treating it as free.
 */
/**
 * WHAT THIS DEAL EARNS THE SALESPERSON (9 Oct 2026).
 *
 * `lib/incentive-rules.ts` has had a full rule engine since 1 Oct - flat,
 * percentage, margin, slabs, per item - and the settings screen could show a
 * preview of it. Nothing ever applied it to a real quotation: the figure
 * stored was still whatever somebody typed, and `basis: 'manual'` was the only
 * one that did anything.
 *
 * So a business on "five hundred rupees a sale" had to type 500 onto every
 * quotation. Nobody did, which is why the Sales Incentive screen looked empty
 * when it was asked for.
 *
 * `manual` keeps the typed figure, which is what it means. Every other basis
 * is worked out here, on the server, so it cannot be bypassed from a screen
 * and cannot differ between two screens.
 */
async function resolveIncentivePaise(
  storeId: string,
  typedPaise: number,
  totals: { taxableBasePaise: number; lines: { taxablePaise: number }[] },
  lines: { costPricePaise?: number | null; qty: number }[],
): Promise<number> {
  const rule = await getIncentiveRule(storeId).catch(() => DEFAULT_RULE);
  if (rule.basis === 'manual') return typedPaise;

  const result = calculateIncentive({
    valuePaise: totals.taxableBasePaise,
    manualPaise: typedPaise,
    // Per line: its share of the deal after discount, and what it cost us.
    // `margin` and `per_item` need both; the other bases ignore them.
    lines: totals.lines.map((t, i) => ({
      lineTotalPaise: t.taxablePaise,
      costPaise: lines[i]?.costPricePaise != null
        ? (lines[i]!.costPricePaise as number) * (lines[i]!.qty ?? 1)
        : null,
    })),
  }, rule);
  return result.amountPaise;
}

async function analyseProfit(
  scope: StoreScope,
  lines: { productId: string | null; qty: number }[],
  totals: ReturnType<typeof computeTotals>,
  opts: { deliveryRevenuePaise: number; transportPaise: number; incentivePaise: number },
): Promise<ProfitAnalysis> {
  const productIds = [...new Set(lines.map((l) => l.productId).filter((id): id is string => !!id))];
  const costs = productIds.length ? await costsFor(scope, productIds) : new Map();

  return computeProfit(
    lines.map((l, i) => {
      const c = l.productId ? costs.get(l.productId) : undefined;
      return {
        qty: l.qty,
        netPaise: totals.lines[i].netPaise,
        apportionedDiscountPaise: totals.lines[i].apportionedDiscountPaise,
        unitCostPaise: c && c.basis !== 'none' ? c.unitCostPaise : null,
      };
    }),
    opts,
  );
}

/**
 * Totals are recomputed here from the line inputs. Whatever the browser
 * displayed is ignored - a client that can set its own tax total is a client
 * that can issue a zero-GST invoice.
 */
export async function createQuotation(
  scope: StoreScope,
  input: QuotationInput,
  userId: string,
) {
  const storeId = scopeForWrite(scope);

  const store = await db.store.findUniqueOrThrow({
    where: { id: storeId }, select: { stateId: true },
  });

  /**
   * NONE when the person switched GST off, otherwise the two states decide.
   * The toggle can only ever REMOVE tax - it cannot pick the wrong one.
   */
  const taxMode = input.noGst ? 'NONE' as const : resolveTaxMode(store.stateId ?? '', input.stateId);

  const totals = computeTotals(
    input.lines.map((l) => ({
      qty: l.qty,
      unitPricePaise: l.unitPricePaise,
      discountPct: l.discountPct,
      taxRatePct: l.taxRatePct,
    })),
    {
      taxMode,
      discountType: input.discountType,
      discountValue: input.discountValue,
      deliveryPaise: input.deliveryPaise,
      deliveryExempt: input.deliveryExempt,
    },
  );

  const incentivePaise = await resolveIncentivePaise(storeId, input.incentivePaise, totals, input.lines);

  const profit = await analyseProfit(scope, input.lines, totals, {
    deliveryRevenuePaise: input.deliveryExempt ? 0 : input.deliveryPaise,
    transportPaise: input.transportPaise,
    incentivePaise,
  });

  const salespersonId = await resolveSalesperson(storeId, input.salespersonId, userId);
  const quotationNo = await allocateDocumentNumber(storeId, 'QT');
  const validUntil = new Date(Date.now() + input.validityPeriodDays * 86_400_000);

  return db.quotation.create({
    data: {
      storeId,
      quotationNo,
      leadId: input.leadId,
      partyId: input.partyId,
      customerName: input.customerName,
      organizationName: input.organizationName,
      email: input.email,
      phone: input.phone,
      gstin: input.gstin,
      billingAddress: input.billingAddress,
      shippingAddress: input.shippingAddress,
      stateId: input.stateId,
      cityId: input.cityId,
      validityPeriodDays: input.validityPeriodDays,
      validUntil,
      salespersonId,
      deliveryMode: input.deliveryMode,
      deliveryCharge: input.deliveryPaise,
      deliveryExempt: input.deliveryExempt,
      discountType: input.discountType,
      discountValue: input.discountValue,
      subtotalPaise: totals.subtotalPaise,
      itemDiscountPaise: totals.itemDiscountPaise,
      orderDiscountPaise: totals.orderDiscountPaise,
      taxableBasePaise: totals.taxableBasePaise,
      cgstPaise: totals.cgstPaise,
      sgstPaise: totals.sgstPaise,
      igstPaise: totals.igstPaise,
      grandTotalPaise: totals.grandTotalPaise,
      taxMode,
      // The internal margin panel. Server-derived, never printed on the
      // customer's copy.
      costPricePaise: profit.goodsCostPaise,
      transportPaise: input.transportPaise,
      incentivePaise,
      termsBody: input.termsBody,
      notes: input.notes,
      createdBy: userId,
      items: {
        create: input.lines.map((l, i) => ({
          srNo: i + 1,
          productId: l.productId,
          productName: l.productName,
          productCode: l.productCode,
          qty: l.qty,
          unitPricePaise: l.unitPricePaise,
          discountPct: l.discountPct,
          taxRatePct: l.taxRatePct,
          lineDiscountPaise: totals.lines[i].lineDiscountPaise,
          lineTotalPaise: totals.lines[i].netPaise,
          // Alongside the totals, never inside them - an extra-cost AMC is
          // billed on its own invoice, so quoting it in this total would give
          // the customer a figure they will never be charged.
          amcOpted: l.amcOpted ?? false,
          amcMonths: l.amcMonths ?? null,
          amcPricePaise: l.amcPricePaise ?? null,
        })),
      },
    },
  });
}

export async function setQuotationStatus(
  scope: StoreScope, id: string, status: QuotationStatus,
) {
  const q = await db.quotation.findFirst({
    where: { id, ...scopeWhere(scope) }, select: { id: true },
  });
  if (!q) throw new Error('Quotation not found in your scope.');

  const stamp: Record<string, Date> = {};
  if (status === 'sent') stamp.sentAt = new Date();
  if (status === 'accepted') stamp.acceptedAt = new Date();
  if (status === 'rejected') stamp.rejectedAt = new Date();

  return db.quotation.update({ where: { id }, data: { status, ...stamp } });
}

export interface QuotationDetail {
  id: string;
  quotationNo: string;
  status: QuotationStatus;
  quotationDate: Date;
  validUntil: Date;
  /** The customer record, so the name opens their page (G-35). Null for a walk-in. */
  partyId: string | null;
  customerName: string;
  organizationName: string | null;
  email: string | null;
  phone: string;
  gstin: string | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  stateId: string | null;
  cityId: string | null;
  taxMode: string;
  items: {
    srNo: number; productId: string | null; productName: string; productCode: string | null;
    qty: number; unitPricePaise: number; discountPct: number;
    taxRatePct: number; lineTotalPaise: number;
    /** The AMC quoted, so reopening the quotation keeps it. */
    amcOpted: boolean; amcMonths: number | null; amcPricePaise: number | null;
  }[];
  subtotalPaise: number;
  itemDiscountPaise: number;
  orderDiscountPaise: number;
  taxableBasePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  deliveryCharge: number;
  grandTotalPaise: number;
  termsBody: string | null;
  salespersonId: string | null;
  salespersonName: string | null;

  /**
   * The internal margin panel. **Never printed on the customer's copy.**
   *
   * Stored figures, not recomputed on read - because the cost that mattered is
   * the one that applied when the quotation was raised. Recomputing today would
   * quietly rewrite the margin somebody approved a discount against the moment
   * a new purchase price was recorded.
   */
  profit: {
    goodsCostPaise: number;
    transportPaise: number;
    incentivePaise: number;
    totalCostPaise: number;
    profitPaise: number;
    marginPct: number | null;
    unknown: boolean;
  };

  // Organisation branding - this is the white-label surface on a printed doc
  org: {
    name: string; gstin: string | null; email: string | null;
    mobile: string | null; logoUrl: string | null; sealUrl: string | null;
  };
  storeName: string;
  storeAddress: string | null;
}

export async function getQuotationDetail(
  scope: StoreScope, id: string,
): Promise<QuotationDetail | null> {
  const q = await db.quotation.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: {
      items: { orderBy: { srNo: 'asc' } },
      store: { include: { organization: true } },
    },
  });
  if (!q) return null;

  const salesperson = q.salespersonId
    ? await db.user.findUnique({ where: { id: q.salespersonId }, select: { fullName: true } })
    : null;

  return {
    id: q.id,
    quotationNo: q.quotationNo,
    status: q.status as QuotationStatus,
    quotationDate: q.quotationDate,
    validUntil: q.validUntil,
    partyId: q.partyId,
    customerName: q.customerName,
    organizationName: q.organizationName,
    email: q.email,
    phone: q.phone,
    gstin: q.gstin,
    billingAddress: q.billingAddress,
    shippingAddress: q.shippingAddress,
    stateId: q.stateId,
    cityId: q.cityId,
    taxMode: q.taxMode,
    items: q.items.map((i) => ({
      srNo: i.srNo, productId: i.productId, productName: i.productName, productCode: i.productCode,
      qty: i.qty, unitPricePaise: i.unitPricePaise,
      discountPct: Number(i.discountPct), taxRatePct: Number(i.taxRatePct),
      lineTotalPaise: i.lineTotalPaise,
      amcOpted: i.amcOpted, amcMonths: i.amcMonths, amcPricePaise: i.amcPricePaise,
    })),
    subtotalPaise: q.subtotalPaise,
    itemDiscountPaise: q.itemDiscountPaise,
    orderDiscountPaise: q.orderDiscountPaise,
    taxableBasePaise: q.taxableBasePaise,
    cgstPaise: q.cgstPaise,
    sgstPaise: q.sgstPaise,
    igstPaise: q.igstPaise,
    deliveryCharge: q.deliveryExempt ? 0 : q.deliveryCharge,
    grandTotalPaise: q.grandTotalPaise,
    termsBody: q.termsBody,
    salespersonId: q.salespersonId,
    salespersonName: salesperson?.fullName ?? null,
    profit: (() => {
      const totalCostPaise = q.costPricePaise + q.transportPaise + q.incentivePaise;
      // Revenue for margin is the taxable base plus any delivery actually
      // charged. GST is excluded - it is collected for the government, not
      // earned, and including it would inflate every margin by the tax rate.
      const revenuePaise = q.taxableBasePaise + (q.deliveryExempt ? 0 : q.deliveryCharge);
      const profitPaise = revenuePaise - totalCostPaise;
      const unknown = q.costPricePaise <= 0;

      return {
        goodsCostPaise: q.costPricePaise,
        transportPaise: q.transportPaise,
        incentivePaise: q.incentivePaise,
        totalCostPaise,
        profitPaise,
        marginPct:
          revenuePaise > 0 && !unknown
            ? Math.round((profitPaise / revenuePaise) * 10_000) / 100
            : null,
        unknown,
      };
    })(),
    org: {
      name: q.store.organization.name,
      gstin: q.store.organization.gstin,
      email: q.store.organization.email,
      mobile: q.store.organization.mobile,
      logoUrl: publicBrandUrl(q.store.organization.logoPath),
      sealUrl: publicBrandUrl(q.store.organization.sealPath),
    },
    storeName: q.store.name,
    storeAddress: q.store.address,
  };
}

export interface QuotationEditInput {
  /**
   * GST switched OFF on this document (Vcare, 7 Oct 2026).
   *
   * An INTENT, not a tax mode: the client says "no GST on this one" and the
   * server still decides what that means. A browser posting `taxMode` could
   * pick CGST on an inter-state sale, which is a tax error somebody signs.
   * Absent reads as false, so every existing caller keeps charging GST.
   */
  noGst?: boolean;

  customerName: string;
  organizationName: string | null;
  email: string | null;
  phone: string;
  gstin: string | null;
  billingAddress: string | null;
  /**
   * Was missing from this interface entirely.
   *
   * The form has always sent it and always shown it, but because it was not
   * declared here the update path fell back to writing the BILLING address into
   * the shipping column. So a quotation raised for delivery elsewhere lost that
   * address the first time anybody edited it - silently, with the form still
   * displaying the right thing until the next reload.
   */
  shippingAddress: string | null;
  stateId: string | null;
  cityId: string | null;
  validityPeriodDays: number;
  discountType: 'amount' | 'percent';
  discountValue: number;
  deliveryPaise: number;
  deliveryExempt: boolean;
  termsBody: string | null;
  /** Freight actually paid. Not the delivery charged to the customer. */
  transportPaise: number;
  /** Commission owed on this deal. */
  incentivePaise: number;
  /** Chosen on the form; absent = the creator (new) or unchanged (edit). */
  salespersonId?: string | null;
  lines: QuotationLineInput[];
}

/**
 * Edit a saved quotation.
 *
 * Line items are replaced wholesale rather than diffed - a quotation is a
 * snapshot, and reconciling added, removed and reordered rows buys nothing.
 * Totals are recomputed server-side, exactly as on create.
 *
 * A quotation already converted to an order is frozen: the order was placed
 * against specific numbers and editing them afterwards would rewrite what the
 * customer agreed to.
 */
export async function updateQuotation(
  scope: StoreScope, id: string, input: QuotationEditInput,
) {
  const existing = await db.quotation.findFirst({
    where: { id, ...scopeWhere(scope) },
    include: { store: { select: { stateId: true } } },
  });
  if (!existing) throw new Error('Quotation not found in your scope.');
  if (existing.status === 'converted') {
    throw new Error('This quotation has been converted to an order and can no longer be edited.');
  }

  /**
   * NONE when the person switched GST off, otherwise the two states decide.
   * The toggle can only ever REMOVE tax - it cannot pick the wrong one.
   */
  const taxMode = input.noGst ? 'NONE' as const : resolveTaxMode(existing.store.stateId ?? '', input.stateId);

  const totals = computeTotals(
    input.lines.map((l) => ({
      qty: l.qty, unitPricePaise: l.unitPricePaise,
      discountPct: l.discountPct, taxRatePct: l.taxRatePct,
    })),
    {
      taxMode,
      discountType: input.discountType,
      discountValue: input.discountValue,
      deliveryPaise: input.deliveryPaise,
      deliveryExempt: input.deliveryExempt,
    },
  );

  const incentivePaise = await resolveIncentivePaise(scopeForWrite(scope), input.incentivePaise, totals, input.lines);

  const profit = await analyseProfit(scope, input.lines, totals, {
    deliveryRevenuePaise: input.deliveryExempt ? 0 : input.deliveryPaise,
    transportPaise: input.transportPaise,
    incentivePaise,
  });

  const validUntil = new Date(
    existing.quotationDate.getTime() + input.validityPeriodDays * 86_400_000,
  );
  const salespersonId = await resolveSalesperson(existing.storeId, input.salespersonId, existing.salespersonId);

  return db.$transaction(async (tx) => {
    await tx.quotationItem.deleteMany({ where: { quotationId: id } });

    return tx.quotation.update({
      where: { id },
      data: {
        customerName: input.customerName,
        organizationName: input.organizationName,
        email: input.email,
        phone: input.phone,
        gstin: input.gstin,
        billingAddress: input.billingAddress,
        // Was `input.billingAddress` - editing a quotation silently overwrote
        // the shipping address with the billing one, so a delivery could go to
        // the wrong place and nothing on screen would show it had changed.
        shippingAddress: input.shippingAddress,
        stateId: input.stateId,
        cityId: input.cityId,
        validityPeriodDays: input.validityPeriodDays,
        validUntil,
        salespersonId,
        deliveryCharge: input.deliveryPaise,
        deliveryExempt: input.deliveryExempt,
        discountType: input.discountType,
        discountValue: input.discountValue,
        subtotalPaise: totals.subtotalPaise,
        itemDiscountPaise: totals.itemDiscountPaise,
        orderDiscountPaise: totals.orderDiscountPaise,
        taxableBasePaise: totals.taxableBasePaise,
        cgstPaise: totals.cgstPaise,
        sgstPaise: totals.sgstPaise,
        igstPaise: totals.igstPaise,
        grandTotalPaise: totals.grandTotalPaise,
        taxMode,
        // Recomputed on every edit rather than carried across - a changed line
        // or a changed discount changes the margin, and a stale cost figure is
        // exactly the kind of number somebody would discount against.
        costPricePaise: profit.goodsCostPaise,
        transportPaise: input.transportPaise,
        incentivePaise,
        termsBody: input.termsBody,
        items: {
          create: input.lines.map((l, i) => ({
            srNo: i + 1,
            productId: l.productId,
            productName: l.productName,
            productCode: l.productCode,
            qty: l.qty,
            unitPricePaise: l.unitPricePaise,
            discountPct: l.discountPct,
            taxRatePct: l.taxRatePct,
            lineDiscountPaise: totals.lines[i].lineDiscountPaise,
            lineTotalPaise: totals.lines[i].netPaise,
            amcOpted: l.amcOpted ?? false,
            amcMonths: l.amcMonths ?? null,
            amcPricePaise: l.amcPricePaise ?? null,
          })),
        },
      },
    });
  });
}

/** Mint or rotate the public token. Rotating revokes any link already sent. */
export async function ensureShareToken(
  scope: StoreScope, id: string, rotate = false,
): Promise<string> {
  const q = await db.quotation.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: { id: true, publicToken: true },
  });
  if (!q) throw new Error('Quotation not found in your scope.');
  if (q.publicToken && !rotate) return q.publicToken;

  const { randomBytes } = await import('node:crypto');
  const token = randomBytes(24).toString('base64url');
  await db.quotation.update({ where: { id }, data: { publicToken: token } });
  return token;
}

/** Public read by token. Deliberately no scope - the token IS the credential. */
export async function getQuotationByToken(token: string) {
  const q = await db.quotation.findUnique({
    where: { publicToken: token },
    include: {
      items: { orderBy: { srNo: 'asc' } },
      store: { include: { organization: true } },
    },
  });
  return q;
}

/**
 * Release a quotation that was converted by mistake.
 *
 * Converting is one click and it is final: `updateQuotation` refuses anything
 * marked converted, and until now nothing could move it back. A quotation
 * converted to the wrong customer, or converted twice by two people, was
 * frozen in that state permanently - and the only workaround was to raise a
 * fresh quotation, which loses the history and the number.
 *
 * The order that came from it must go first. Deciding which one to release is
 * not this function's job to guess: an order may have been dispatched, part
 * paid, or already invoiced, and each of those is a different conversation.
 * So it refuses while a live order still points here, and names it.
 *
 * The quotation goes back to `accepted` rather than `sent` - it *was* accepted,
 * that is why somebody converted it, and rewriting that would lose a real fact
 * to tidy up an accidental one.
 */
export async function unconvertQuotation(
  scope: StoreScope,
  id: string,
  reason: string,
) {
  if (!reason.trim()) {
    throw new Error('Say why this conversion is being undone. It goes on the record.');
  }

  const quote = await db.quotation.findFirst({
    where: { id, ...scopeWhere(scope) },
    select: {
      id: true, quotationNo: true, status: true, notes: true,
      salesOrders: {
        select: { id: true, orderNo: true, fulfilmentStatus: true, isInvoiced: true },
      },
    },
  });
  if (!quote) throw new Error('Quotation not found in your scope.');

  if (quote.status !== 'converted') {
    throw new Error(
      `${quote.quotationNo} is marked ${quote.status}, not converted, so there is nothing to undo.`,
    );
  }

  const live = quote.salesOrders.filter((o) => o.fulfilmentStatus !== 'void');
  if (live.length > 0) {
    const o = live[0];
    throw new Error(
      `${quote.quotationNo} was converted into ${o.orderNo}, which is still live`
      + ` (${(await stageNamer(scope))(o.fulfilmentStatus)}${o.isInvoiced ? ', invoiced' : ''}).`
      + ' Cancel that order first - deciding what happens to it is a real decision,'
      + ' not something this should guess at.',
    );
  }

  return db.quotation.update({
    where: { id },
    data: {
      status: 'accepted',
      convertedAt: null,
      notes: [quote.notes, `Conversion undone - ${reason.trim()}`].filter(Boolean).join('\n'),
    },
  });
}
