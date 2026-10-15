import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { RECEIVABLE_WHERE } from '@/lib/invoice-status';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * The Customer Account list - every customer with a balance, in one screen.
 *
 * Spec: 10-accounts-purchase.md §1.4 ("Customer Account").
 *
 * `duePaise` is read off the ledger (net movement on `1100 Accounts
 * Receivable`, grouped by party), not recomputed from documents the way
 * `parties.ts::computeBalances` does for the Customers screen. The two
 * should agree for a customer who has never had a credit note, but
 * `computeBalances` nets only invoices against receipts - it does not know
 * about credit notes, so it overstates what a customer owes by however much
 * has been credited back to them. The GL does not have that gap: every
 * invoice, receipt, credit note and refund that touches this party's
 * receivable already posts to `1100` with `partyId` set (see
 * `server/invoices.ts`, `server/receipts.ts`, `server/credit-notes.ts`).
 *
 * `oldestUnpaidDueDate` still comes from documents - the GL knows amounts,
 * not due dates.
 */

export interface CustomerAccountRow {
  id: string;
  partyCode: string;
  displayName: string;
  companyName: string | null;
  phone: string;
  status: string;
  duePaise: number;
  creditLimitPaise: number;
  oldestUnpaidDueDate: Date | null;
  crossedDueDate: boolean;
  crossedCreditLimit: boolean;
  followUpDate: Date | null;
  isBadDebt: boolean;
}

export interface CustomerAccountCards {
  all: number;
  openAccounts: number;
  followUpDue: number;
  badDebts: number;
  totalDueAccounts: number;
  crossedDueDate: number;
  crossedCreditLimit: number;
  crossedBoth: number;
  totalDuePaise: number;
}

export interface CustomerAccountsResult {
  rows: CustomerAccountRow[];
  cards: CustomerAccountCards;
}

export async function listCustomerAccounts(
  scope: StoreScope,
  asOf = new Date(),
): Promise<CustomerAccountsResult> {
  const [parties, arLines, unpaidInvoices] = await Promise.all([
    db.party.findMany({
      where: { ...scopeWhere(scope), isCustomer: true },
      select: {
        id: true, partyCode: true, title: true, firstName: true, lastName: true,
        companyName: true, phoneCc: true, phone: true, status: true,
        creditLimitPaise: true, followUpDate: true, isBadDebt: true,
      },
      orderBy: { firstName: 'asc' },
      take: LIST_MAX_ROWS,
    }),

    // Net movement on Accounts Receivable, per party - invoices, receipts,
    // credit notes and refunds all already post here with partyId set.
    db.journalLine.groupBy({
      by: ['partyId'],
      where: {
        account: { code: '1100' },
        partyId: { not: null },
        journalEntry: { ...scopeWhere(scope), entryDate: { lte: asOf } },
      },
      _sum: { debitPaise: true, creditPaise: true },
    }),

    db.invoice.findMany({
      where: { ...scopeWhere(scope), partyId: { not: null }, ...RECEIVABLE_WHERE },
      select: { partyId: true, dueDate: true, grandTotalPaise: true, amountPaidPaise: true },
    }),
  ]);

  const duePaiseByParty = new Map<string, number>();
  for (const l of arLines) {
    if (!l.partyId) continue;
    duePaiseByParty.set(l.partyId, (l._sum.debitPaise ?? 0) - (l._sum.creditPaise ?? 0));
  }

  const oldestUnpaidByParty = new Map<string, Date>();
  for (const inv of unpaidInvoices) {
    if (!inv.partyId || inv.grandTotalPaise <= inv.amountPaidPaise) continue;
    const cur = oldestUnpaidByParty.get(inv.partyId);
    if (!cur || inv.dueDate < cur) oldestUnpaidByParty.set(inv.partyId, inv.dueDate);
  }

  const rows: CustomerAccountRow[] = parties.map((p) => {
    const duePaise = duePaiseByParty.get(p.id) ?? 0;
    const oldestUnpaidDueDate = oldestUnpaidByParty.get(p.id) ?? null;
    return {
      id: p.id,
      partyCode: p.partyCode,
      displayName: [p.title, p.firstName, p.lastName].filter(Boolean).join(' '),
      companyName: p.companyName,
      phone: `${p.phoneCc} ${p.phone}`,
      status: p.status,
      duePaise,
      creditLimitPaise: p.creditLimitPaise,
      oldestUnpaidDueDate,
      crossedDueDate: oldestUnpaidDueDate != null && oldestUnpaidDueDate < asOf,
      crossedCreditLimit: p.creditLimitPaise > 0 && duePaise > p.creditLimitPaise,
      followUpDate: p.followUpDate,
      isBadDebt: p.isBadDebt,
    };
  });

  const cards: CustomerAccountCards = {
    all: rows.length,
    openAccounts: rows.filter((r) => r.duePaise > 0).length,
    followUpDue: rows.filter((r) => r.followUpDate != null && r.followUpDate <= asOf).length,
    badDebts: rows.filter((r) => r.isBadDebt).length,
    totalDueAccounts: rows.filter((r) => r.duePaise > 0).length,
    crossedDueDate: rows.filter((r) => r.crossedDueDate).length,
    crossedCreditLimit: rows.filter((r) => r.crossedCreditLimit).length,
    crossedBoth: rows.filter((r) => r.crossedDueDate && r.crossedCreditLimit).length,
    totalDuePaise: rows.reduce((n, r) => n + Math.max(0, r.duePaise), 0),
  };

  return { rows, cards };
}

export async function setFollowUpDate(
  scope: StoreScope, partyId: string, followUpDate: Date | null,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const party = await db.party.findFirst({ where: { id: partyId, storeId }, select: { id: true } });
  if (!party) throw new Error('Customer not found in your scope.');
  await db.party.update({ where: { id: partyId }, data: { followUpDate } });
}

export async function setBadDebt(
  scope: StoreScope, partyId: string, isBadDebt: boolean,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  const party = await db.party.findFirst({ where: { id: partyId, storeId }, select: { id: true } });
  if (!party) throw new Error('Customer not found in your scope.');
  await db.party.update({ where: { id: partyId }, data: { isBadDebt } });
}
