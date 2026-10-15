/**
 * Turning a site's worth of work into the lines of one bill.
 *
 * Pure, and separate from `server/consolidated-invoice.ts` on purpose: this is
 * the part that decides what a customer is charged, and it should be provable
 * without a database. Everything here takes plain data and returns plain data.
 *
 * The rules it encodes, all of them Pravin's:
 *
 *  - Goods are billed from CHALLANS, because a challan is the record of what
 *    physically left the building. An order is a promise.
 *  - Prices come from the ORDER, because a challan carries quantities and no
 *    money.
 *  - Labour and charges are billed from the ORDER, once, because there is no
 *    challan that could ever carry them.
 *  - Twelve cameras across three challans are ONE line, because one line is
 *    what the customer bought.
 *  - Metres are rounded UP, always, at the point of consumption.
 *
 * ---------------------------------------------------------------------------
 * WHY LINES ARE MATCHED BY NAME AND NOT ONLY BY PRODUCT ID
 *
 * Measured on Vcare's real data, 2 Oct 2026: ALL 2,418 of their migrated
 * sales-order lines carry `productId: null`. The migration brought the product
 * NAME across and never linked it to the catalogue. Their challan lines, by
 * contrast, name a product on 4,735 of 4,738 rows.
 *
 * So a price book keyed on product id alone finds nothing for any migrated
 * order, every challan line falls through to the catalogue price, and the
 * customer is billed a number nobody agreed. The name is the only bridge
 * between the two sides, and both came out of the same source system, so it is
 * a sound one.
 */

/**
 * What identifies "the same thing" on two different documents.
 *
 * The product id when there is one. The name, normalised, when there is not -
 * which on migrated data is every single order line. Upper-cased and with
 * runs of whitespace collapsed, because the source system was typed into by
 * people and "CP PLUS  NVR 16CH" and "CP Plus NVR 16CH" are one product.
 */
export function matchKey(productId: string | null, productName: string): string {
  if (productId) return `id:${productId}`;
  return nameKey(productName);
}

function nameKey(productName: string): string {
  return `name:${productName.trim().toUpperCase().replace(/\s+/g, ' ')}`;
}

/**
 * EVERY way this line could be recognised, because the two sides are not
 * symmetric.
 *
 * On Vcare's data a challan line names a product id and the order line for the
 * very same camera names only a name. Keying each side on its own best
 * identifier therefore never matches, and the bill falls back to catalogue
 * prices for everything - which is how the first version of this file would
 * have billed a 172-camera order.
 *
 * So both keys are registered for every line, and a lookup tries each in turn.
 * Id first: two products can share a typed-in name, and the id is the one that
 * cannot be wrong.
 */
export function matchKeys(productId: string | null, productName: string): string[] {
  const keys = [nameKey(productName)];
  if (productId) keys.unshift(`id:${productId}`);
  return keys;
}

/** A part consumed in metres rounds up. 12.5 m is billed as 13 m. */
export function billableQty(qty: number, unit: string | null | undefined): number {
  if (!unit) return qty;
  const u = unit.trim().toLowerCase();
  const isLength = u === 'm' || u === 'mtr' || u === 'mtrs' || u === 'metre' || u === 'metres'
    || u === 'meter' || u === 'meters';
  return isLength ? Math.ceil(qty) : qty;
}

export interface SourceChallan {
  id: string;
  challanNo: string;
  dispatchedAt: Date;
  salesOrderId: string | null;
  items: {
    id: string;
    productId: string | null;
    productName: string;
    qty: number;
    unit?: string | null;
  }[];
}

export interface SourceOrder {
  id: string;
  orderNo: string;
  orderDate: Date;
  items: {
    id: string;
    productId: string | null;
    productName: string;
    productCode: string | null;
    qty: number;
    unitPricePaise: number;
    discountPct: number;
    taxRatePct: number;
  }[];
}

export interface ProductFacts {
  id: string;
  kind: string;
  hsnCode: string | null;
  productCode: string | null;
  productName: string;
  /** Current dealer list price. Only ever a fallback — see `pricedFromCatalogue`. */
  fallbackPricePaise: number;
}

export interface BuiltSource {
  kind: 'installation_challan' | 'sales_order';
  challanId: string | null;
  challanItemId: string | null;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  qty: number;
  docNo: string;
  docDate: Date;
}

export interface BuiltLine {
  productId: string | null;
  productName: string;
  productCode: string | null;
  hsnCode: string | null;
  qty: number;
  unitPricePaise: number;
  discountPct: number;
  taxRatePct: number;
  sources: BuiltSource[];
  pricedFromCatalogue: boolean;
}

export interface BuildResult {
  lines: BuiltLine[];
  warnings: string[];
}

/**
 * The grouping key: product AND price AND discount AND tax rate.
 *
 * Not product alone. Twelve cameras at one agreed price across three challans
 * are one line. Two more added mid-job on a second order at a different price
 * are a SEPARATE line, because merging them would have to invent an average
 * price that appears on no document either side ever signed.
 */
function key(productId: string | null, name: string, price: number, disc: number, tax: number) {
  return `${productId ?? `name:${name}`}|${price}|${disc}|${tax}`;
}

export function buildConsolidatedLines(
  challans: SourceChallan[],
  orders: SourceOrder[],
  products: Map<string, ProductFacts>,
): BuildResult {
  const warnings: string[] = [];
  const grouped = new Map<string, BuiltLine>();

  /* ---- the price book ---------------------------------------------------- */

  interface Priced {
    orderId: string; itemId: string; productCode: string | null;
    unitPricePaise: number; discountPct: number; taxRatePct: number;
  }
  const priceOf = new Map<string, Priced>();
  for (const o of orders) {
    for (const i of o.items) {
      const entry: Priced = {
        orderId: o.id, itemId: i.id, productCode: i.productCode,
        unitPricePaise: i.unitPricePaise,
        discountPct: i.discountPct,
        taxRatePct: i.taxRatePct,
      };
      // The FIRST order wins where two price the same product differently. The
      // goods went out against the earlier promise; an order raised later for
      // more cameras does not retroactively reprice the ones already fitted.
      for (const k of matchKeys(i.productId, i.productName)) {
        if (!priceOf.has(k)) priceOf.set(k, entry);
      }
    }
  }

  /**
   * The catalogue indexed by NAME, because on migrated data a name is all
   * there is.
   *
   * Measured 2 Oct 2026: all 2,418 of Vcare's migrated order lines have a null
   * `productId` AND a null `productCode`. Indexing on the code - which the
   * first version of this did - finds nothing, every goods line then looks
   * like a charge, and a 172-camera order gets billed in full whether or not a
   * single camera left the building.
   *
   * A duplicate name is harmless here: this index answers only "is this goods
   * or labour", and two rows sharing a name agree about that.
   */
  const byName = new Map<string, ProductFacts>();
  for (const p of products.values()) {
    byName.set(nameKey(p.productName), p);
    if (p.productCode) byName.set(`code:${p.productCode.trim().toUpperCase()}`, p);
  }

  /** What actually left the building, so the order loop knows what is left. */
  const delivered = new Set<string>();
  for (const c of challans) {
    for (const i of c.items) {
      for (const k of matchKeys(i.productId, i.productName)) delivered.add(k);
    }
  }

  /* ---- goods, from the challans ------------------------------------------ */

  for (const c of challans) {
    for (const item of c.items) {
      const qty = billableQty(item.qty, item.unit);
      if (qty <= 0) continue;

      const facts = item.productId ? products.get(item.productId) : undefined;
      const priced = matchKeys(item.productId, item.productName)
        .map((k) => priceOf.get(k))
        .find(Boolean);

      let unitPricePaise = priced?.unitPricePaise ?? 0;
      let pricedFromCatalogue = false;
      if (!priced) {
        unitPricePaise = facts?.fallbackPricePaise ?? 0;
        pricedFromCatalogue = true;
        warnings.push(
          `${item.productName} went out on ${c.challanNo} with no order line behind it. `
          + 'It is priced from the catalogue — check the amount before issuing.',
        );
      }

      const discountPct = priced?.discountPct ?? 0;
      const taxRatePct = priced?.taxRatePct ?? 18;
      const k = key(item.productId, item.productName, unitPricePaise, discountPct, taxRatePct);

      let line = grouped.get(k);
      if (!line) {
        line = {
          productId: item.productId,
          productName: item.productName,
          productCode: priced?.productCode ?? facts?.productCode ?? null,
          hsnCode: facts?.hsnCode ?? null,
          qty: 0,
          unitPricePaise,
          discountPct,
          taxRatePct,
          sources: [],
          pricedFromCatalogue,
        };
        grouped.set(k, line);
      }

      line.qty += qty;
      line.sources.push({
        kind: 'installation_challan',
        challanId: c.id,
        challanItemId: item.id,
        salesOrderId: priced?.orderId ?? c.salesOrderId,
        salesOrderItemId: priced?.itemId ?? null,
        qty,
        docNo: c.challanNo,
        docDate: c.dispatchedAt,
      });
    }
  }

  /* ---- labour and charges, from the orders -------------------------------- */
  //
  // No technician walks out of a warehouse holding "installation, 3 visits", so
  // these can only come from the order that agreed them — at the quantity
  // ordered, because a service has no dispatched quantity and waiting for one
  // would mean labour is never billed at all.
  for (const o of orders) {
    for (const i of o.items) {
      if (i.qty <= 0) continue;

      /**
       * Anything a challan already delivered is billed from the challan, at
       * the delivered quantity. Never from here, or it is billed twice - and
       * at the quantity ORDERED, which is the quantity that did not
       * necessarily go out.
       */
      if (matchKeys(i.productId, i.productName).some((k) => delivered.has(k))) continue;

      /**
       * What is left is billed ONLY when the catalogue says it is a service -
       * something no challan could ever carry out of a warehouse.
       *
       * Everything else is skipped and named in the warnings, including a line
       * the catalogue cannot identify at all. That default is deliberate and it
       * is the cautious one: measured on Vcare's data, their migrated order
       * lines carry no product id, no product code, and names that do not
       * always match the catalogue - so "if we cannot tell, bill it" would
       * have put 4,575 metres of cable on a customer's invoice on the strength
       * of a promise, with nothing saying it ever shipped.
       *
       * Under-billing with a loud warning is a phone call. Over-billing a
       * government building for twenty lakh of goods that never left the
       * warehouse is something else entirely. The person raising the invoice
       * can add a line by hand; they cannot un-send a tax invoice.
       */
      const facts = i.productId
        ? products.get(i.productId)
        : byName.get(nameKey(i.productName))
          ?? (i.productCode ? byName.get(`code:${i.productCode.trim().toUpperCase()}`) : undefined);

      if (facts?.kind !== 'service') {
        warnings.push(
          `${i.productName} (${i.qty} on ${o.orderNo}) has not gone out on any of these challans, `
          + `so it is NOT on this bill${facts ? '' : ' — and the catalogue does not recognise it'}.`,
        );
        continue;
      }
      const k = key(i.productId, i.productName, i.unitPricePaise, i.discountPct, i.taxRatePct);

      let line = grouped.get(k);
      if (!line) {
        line = {
          productId: i.productId,
          productName: i.productName,
          productCode: i.productCode ?? facts?.productCode ?? null,
          hsnCode: facts?.hsnCode ?? null,
          qty: 0,
          unitPricePaise: i.unitPricePaise,
          discountPct: i.discountPct,
          taxRatePct: i.taxRatePct,
          sources: [],
          pricedFromCatalogue: false,
        };
        grouped.set(k, line);
      }

      line.qty += i.qty;
      line.sources.push({
        kind: 'sales_order',
        challanId: null,
        challanItemId: null,
        salesOrderId: o.id,
        salesOrderItemId: i.id,
        qty: i.qty,
        docNo: o.orderNo,
        docDate: o.orderDate,
      });
    }
  }

  return { lines: [...grouped.values()], warnings: [...new Set(warnings)] };
}
