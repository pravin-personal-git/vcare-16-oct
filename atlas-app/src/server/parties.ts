import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { summarise, type PartyRow } from '@/lib/party-metrics';
import { RECEIVABLE_WHERE } from '@/lib/invoice-status';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

export type { PartyRow } from '@/lib/party-metrics';
export {
  matchesFilter, summarise, daysOverdue, birthdayThisWeek,
  NO_ORDER_DAYS, NO_COMM_DAYS, type PartyFilter, type PartyMetricsInput,
} from '@/lib/party-metrics';

/** role narrows the list: the Customers screen and the Suppliers screen are
 *  the same data filtered by role flag.
 *
 *  Loads every party in scope, not a slice. See lib/list-limits for why the
 *  old 500-row cap was the wrong trade - the grid pages in the browser and
 *  renders one page at a time, so the cap bought a little payload and cost
 *  the viewer four fifths of their customer list. */
export async function listParties(
  scope: StoreScope,
  role?: 'customer' | 'supplier',
  opts: { take?: number } = {},
): Promise<PartyRow[]> {
  const rows = await db.party.findMany({
    where: {
      ...scopeWhere(scope),
      ...(role === 'customer' ? { isCustomer: true } : {}),
      ...(role === 'supplier' ? { isSupplier: true } : {}),
    },
    // Only what the grid and the metrics actually read. `include` was pulling
    // every column including the two Decimal lat/long fields.
    select: {
      id: true, partyCode: true, isCustomer: true, isSupplier: true,
      payablePaise: true, supplierType: true, title: true, firstName: true,
      lastName: true, companyName: true, phoneCc: true, phone: true,
      email: true, city: true, state: true, gstin: true, addressLine1: true,
      creditLimitPaise: true, creditLimitDays: true, currentBalancePaise: true,
      dueDate: true, rewardPoints: true, birthday: true, customerSince: true,
      lastPurchaseAt: true, lastCommunicationAt: true, status: true,
      customerType: { select: { name: true } },
      createdAt: true,
    },
    orderBy: { firstName: 'asc' },
    take: Math.min(opts.take ?? LIST_MAX_ROWS, LIST_MAX_ROWS),
  });

  /**
   * What each customer owes, worked out from the documents.
   *
   * `Party.currentBalancePaise` is NOT used. It was maintained by hand - a
   * decrement when a payment landed, and nothing at all when an invoice was
   * issued - so it drifted negative by exactly the total each customer had ever
   * paid. The Customers screen was reporting nobody owed anything while the
   * Invoices screen correctly showed lakhs receivable, and the two screens
   * disagreeing about money is the worst thing this app can do.
   *
   * A stored balance is a promise to update it from every place that could
   * change it, forever. That promise is not keepable. So it is derived:
   *
   *   owed = issued invoices − money received
   *
   * A draft invoice is not a receivable. Nobody has been asked to pay it yet,
   * and it can still be edited or deleted.
   */
  const balances = await computeBalances(scope, rows.map((r) => r.id));

  return rows.map((c) => ({
    id: c.id,
    partyCode: c.partyCode,
    isCustomer: c.isCustomer,
    isSupplier: c.isSupplier,
    payablePaise: c.payablePaise,
    supplierType: c.supplierType,
    displayName: [c.title, c.firstName, c.lastName].filter(Boolean).join(' '),
    companyName: c.companyName,
    phone: `${c.phoneCc} ${c.phone}`,
    email: c.email,
    city: c.city,
    state: c.state,
    addressLine1: c.addressLine1,
    customerTypeName: c.customerType?.name ?? null,
    customerSince: c.customerSince,
    managerName: null,               // resolved once employees are wired (A106)
    rewardPoints: c.rewardPoints,
    currentBalancePaise: balances.get(c.id) ?? 0,
    creditLimitPaise: c.creditLimitPaise,
    creditLimitDays: c.creditLimitDays,
    dueDate: c.dueDate,
    lastPurchaseAt: c.lastPurchaseAt,
    lastCommunicationAt: c.lastCommunicationAt,
    birthday: c.birthday,
    gstin: c.gstin,
    status: c.status,
    createdAt: c.createdAt,
  }));
}

/**
 * The next `P-00001` style code for a store.
 *
 * The highest NUMBER among codes shaped `P-<digits>`, not the last code in
 * text order (live test 29 Sep 2026): a store also holds migrated and demo
 * codes (`PTY-04743`, `CUST-D0007`), and text order let one of those decide
 * the next number - which could be a code that already exists, or `P-NaN`.
 * Takes the transaction client when called inside one.
 */
export async function nextPartyCode(storeId: string, client: Pick<typeof db, '$queryRaw'> = db): Promise<string> {
  const [row] = await client.$queryRaw<{ n: number | null }[]>`
    SELECT MAX(substring("partyCode" from '^P-([0-9]+)$')::int) AS n
    FROM "Party" WHERE "storeId" = ${storeId}`;
  return `P-${String((row?.n ?? 0) + 1).padStart(5, '0')}`;
}

/** Prisma's unique-constraint error on the party code (two saves at the same moment). */
export function isPartyCodeClash(e: unknown): boolean {
  const err = e as { code?: string; meta?: { target?: unknown } };
  return err?.code === 'P2002' && JSON.stringify(err.meta?.target ?? '').includes('partyCode');
}

export interface PartyInput {
  isCustomer: boolean;
  isSupplier: boolean;
  supplierType: string | null;
  paymentTermsDays: number;
  companyName: string | null;
  gstin: string | null;
  title: string | null;
  firstName: string;
  lastName: string | null;
  designation: string | null;
  phone: string;
  altPhone: string | null;
  email: string | null;
  website: string | null;
  customerTypeId: string | null;
  source: string | null;
  birthday: Date | null;
  weddingAnniversary: Date | null;
  addressLine1: string | null;
  state: string | null;
  city: string | null;
  pincode: string | null;
  deliveryAddress: string | null;
  deliverySameAsBilling: boolean;
  creditLimitPaise: number;
  creditLimitDays: number;
  subscribeSms: boolean;
}

export async function createParty(scope: StoreScope, input: PartyInput) {
  const storeId = scopeForWrite(scope);

  // A party with no role is invisible on every screen - reject it rather than
  // silently creating an orphan record.
  if (!input.isCustomer && !input.isSupplier) {
    throw new Error('A party must be a customer, a supplier, or both.');
  }

  // The original makes duplicate-phone behaviour a policy setting. Until that
  // screen exists we warn rather than block, so imports are not derailed.
  const duplicate = await db.party.findFirst({
    where: { storeId, phone: input.phone },
    select: { partyCode: true },
  });

  // Two people saving at the same moment can be handed the same code; the
  // unique index refuses the second, which then takes the next number.
  for (let attempt = 0; ; attempt++) {
    try {
      const party = await db.party.create({
        data: {
          storeId,
          partyCode: await nextPartyCode(storeId),
          ...input,
          deliveryAddress: input.deliverySameAsBilling ? input.addressLine1 : input.deliveryAddress,
        },
      });
      return { party, duplicateOf: duplicate?.partyCode ?? null };
    } catch (e) {
      if (attempt < 3 && isPartyCodeClash(e)) continue;
      throw e;
    }
  }
}

/** Full record for the edit form. Scoped - a party outside your stores is not found. */
export async function getParty(scope: StoreScope, id: string) {
  return db.party.findFirst({ where: { id, ...scopeWhere(scope) } });
}

/**
 * Update a party.
 *
 * partyCode is never editable - it appears on quotations already sent, and
 * changing it would orphan those documents from the record they refer to.
 *
 * Clearing both role flags is rejected: such a record shows on no screen and
 * is effectively lost rather than deleted.
 */
export async function updateParty(scope: StoreScope, id: string, input: PartyInput) {
  const existing = await db.party.findFirst({
    where: { id, ...scopeWhere(scope) }, select: { id: true, storeId: true, phone: true },
  });
  if (!existing) throw new Error('Customer not found in your scope.');

  if (!input.isCustomer && !input.isSupplier) {
    throw new Error('A party must remain a customer, a supplier, or both.');
  }

  let duplicateOf: string | null = null;
  if (input.phone !== existing.phone) {
    const clash = await db.party.findFirst({
      where: { storeId: existing.storeId, phone: input.phone, id: { not: id } },
      select: { partyCode: true },
    });
    duplicateOf = clash?.partyCode ?? null;
  }

  const party = await db.party.update({
    where: { id },
    data: {
      ...input,
      deliveryAddress: input.deliverySameAsBilling
        ? input.addressLine1
        : input.deliveryAddress,
    },
  });

  return { party, duplicateOf };
}


/**
 * Outstanding per party - issued invoices less payments received.
 *
 * Grouped in two queries rather than one per party. On a pooler running at
 * connection_limit=1, one query per customer on a 200-row list is 200 round
 * trips and a timeout.
 */
export async function computeBalances(
  scope: StoreScope,
  partyIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (partyIds.length === 0) return out;

  const invoices = await db.invoice.groupBy({
    by: ['partyId'],
    where: {
      ...scopeWhere(scope),
      partyId: { in: partyIds },
      // Draft is not yet a receivable; cancelled never was.
      ...RECEIVABLE_WHERE,
    },
    _sum: { grandTotalPaise: true, amountPaidPaise: true },
  });

  for (const i of invoices) {
    if (!i.partyId) continue;
    const owed = (i._sum.grandTotalPaise ?? 0) - (i._sum.amountPaidPaise ?? 0);
    out.set(i.partyId, owed);
  }

  return out;
}

/**
 * The same derivation across every party in scope, without an id list.
 *
 * `computeBalances` takes ids because it is called with the loaded page. For a
 * whole-scope summary that would mean an IN clause holding several thousand
 * cuids; dropping the filter and grouping over the store is both shorter SQL
 * and a better plan.
 */
async function computeAllBalances(scope: StoreScope): Promise<Map<string, number>> {
  const invoices = await db.invoice.groupBy({
    by: ['partyId'],
    where: { ...scopeWhere(scope), ...RECEIVABLE_WHERE },
    _sum: { grandTotalPaise: true, amountPaidPaise: true },
  });

  const out = new Map<string, number>();
  for (const i of invoices) {
    if (!i.partyId) continue;
    out.set(i.partyId, (i._sum.grandTotalPaise ?? 0) - (i._sum.amountPaidPaise ?? 0));
  }
  return out;
}

export interface PartyTotals {
  /**
   * Every party in scope.
   *
   * Equal to `rows.length` now that `listParties` loads the whole set, and
   * kept separate anyway: it is counted from a narrow ten-column scan, so a
   * screen can state the true total even if the row query is ever sliced
   * again (A022) without the header quietly starting to report the slice.
   */
  total: number;
  summary: ReturnType<typeof summarise>;
}

/**
 * The real KPI figures for the whole scope, independent of the page cap.
 *
 * Selects only the ten fields `summarise` reads - no names, addresses or
 * GSTINs - so this is a narrow scan rather than a second full load. The rules
 * themselves come from lib/party-metrics, the same functions the grid filters
 * with, rather than being restated in SQL: "crossed limit" and "no order in
 * 30 days" are judgements about dates and money, and two implementations of
 * those agree only until one of them is edited.
 */
export async function summariseAllParties(
  scope: StoreScope,
  role?: 'customer' | 'supplier',
): Promise<PartyTotals> {
  const rows = await db.party.findMany({
    where: {
      ...scopeWhere(scope),
      ...(role === 'customer' ? { isCustomer: true } : {}),
      ...(role === 'supplier' ? { isSupplier: true } : {}),
    },
    select: {
      id: true, isCustomer: true, isSupplier: true, payablePaise: true,
      creditLimitPaise: true, creditLimitDays: true, dueDate: true,
      lastPurchaseAt: true, lastCommunicationAt: true, birthday: true,
    },
  });

  const balances = await computeAllBalances(scope);

  return {
    total: rows.length,
    summary: summarise(rows.map((r) => ({
      isCustomer: r.isCustomer,
      isSupplier: r.isSupplier,
      payablePaise: r.payablePaise,
      creditLimitPaise: r.creditLimitPaise,
      creditLimitDays: r.creditLimitDays,
      dueDate: r.dueDate,
      lastPurchaseAt: r.lastPurchaseAt,
      lastCommunicationAt: r.lastCommunicationAt,
      birthday: r.birthday,
      currentBalancePaise: balances.get(r.id) ?? 0,
    }))),
  };
}
