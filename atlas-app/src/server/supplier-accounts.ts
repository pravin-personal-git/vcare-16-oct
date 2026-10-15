import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * The Supplier Account list - every supplier with a payable balance.
 *
 * Spec: 07-products-suppliers.md §3 ("Supplier Account").
 *
 * `payablePaise` is read off the ledger - net movement on `2100 Accounts
 * Payable`, grouped by party - the same reasoning as
 * `server/customer-accounts.ts`'s `duePaise`: every purchase bill and
 * supplier payment already posts to `2100` with `partyId` set (see
 * `server/purchases.ts`), so this is accurate in a way a document-only sum
 * would have to work to be.
 *
 * `openingBalancePaise` is not tracked per supplier anywhere in this system -
 * only a single store-wide opening figure exists (`settings/opening-balance`,
 * which does not break out by party). Shown as zero rather than guessed.
 */

export interface SupplierAccountRow {
  id: string;
  partyCode: string;
  displayName: string;
  companyName: string | null;
  phone: string;
  status: string;
  payablePaise: number;
  totalPaidPaise: number;
}

export interface SupplierAccountCards {
  totalAccounts: number;
  openingBalancePaise: number;
  amountPayablePaise: number;
  totalPaidPaise: number;
}

export interface SupplierAccountsResult {
  rows: SupplierAccountRow[];
  cards: SupplierAccountCards;
}

export async function listSupplierAccounts(
  scope: StoreScope,
  asOf = new Date(),
): Promise<SupplierAccountsResult> {
  const [parties, apLines, payments] = await Promise.all([
    db.party.findMany({
      where: { ...scopeWhere(scope), isSupplier: true },
      select: {
        id: true, partyCode: true, title: true, firstName: true, lastName: true,
        companyName: true, phoneCc: true, phone: true, status: true,
      },
      orderBy: { firstName: 'asc' },
      take: LIST_MAX_ROWS,
    }),

    db.journalLine.groupBy({
      by: ['partyId'],
      where: {
        account: { code: '2100' },
        partyId: { not: null },
        journalEntry: { ...scopeWhere(scope), entryDate: { lte: asOf } },
      },
      _sum: { debitPaise: true, creditPaise: true },
    }),

    db.supplierPayment.groupBy({
      by: ['partyId'],
      where: { ...scopeWhere(scope), status: 'paid', paidAt: { lte: asOf } },
      _sum: { amountPaise: true },
    }),
  ]);

  const payableByParty = new Map<string, number>();
  for (const l of apLines) {
    if (!l.partyId) continue;
    payableByParty.set(l.partyId, (l._sum.creditPaise ?? 0) - (l._sum.debitPaise ?? 0));
  }

  const paidByParty = new Map<string, number>();
  for (const p of payments) {
    paidByParty.set(p.partyId, p._sum.amountPaise ?? 0);
  }

  const rows: SupplierAccountRow[] = parties.map((p) => ({
    id: p.id,
    partyCode: p.partyCode,
    displayName: [p.title, p.firstName, p.lastName].filter(Boolean).join(' '),
    companyName: p.companyName,
    phone: `${p.phoneCc} ${p.phone}`,
    status: p.status,
    payablePaise: payableByParty.get(p.id) ?? 0,
    totalPaidPaise: paidByParty.get(p.id) ?? 0,
  }));

  const cards: SupplierAccountCards = {
    totalAccounts: rows.length,
    openingBalancePaise: 0,
    amountPayablePaise: rows.reduce((n, r) => n + Math.max(0, r.payablePaise), 0),
    totalPaidPaise: rows.reduce((n, r) => n + r.totalPaidPaise, 0),
  };

  return { rows, cards };
}
