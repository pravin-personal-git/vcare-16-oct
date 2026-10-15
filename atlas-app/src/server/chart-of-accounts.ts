import 'server-only';
import { db } from './db';

/**
 * Browsing and extending the chart of accounts.
 *
 * `Account` rows have only ever been written by `ensureChartOfAccounts()`
 * (`server/ledger.ts`), idempotently seeding `STANDARD_CHART_OF_ACCOUNTS` -
 * there was no admin screen to browse or add to them directly. This is
 * that screen's backing module, kept separate from `ledger.ts` itself: that
 * file posts and reverses journal entries against these rows, this one
 * only manages the rows.
 *
 * Organisation-scoped, not store-scoped - one chart of accounts serves
 * every branch, same as `ledger.ts` already assumes.
 */

export class ChartOfAccountsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChartOfAccountsError';
  }
}

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  subType: string | null;
  parentId: string | null;
  parentName: string | null;
  isSystem: boolean;
  isActive: boolean;
  journalLineCount: number;
}

export async function listAccounts(organizationId: string): Promise<AccountRow[]> {
  const rows = await db.account.findMany({
    // A deactivated account is removed from view the same way every other
    // "remove" in this codebase works (AttendanceZone, LeaveType) - the row
    // stays, so a journal line already posted against it keeps meaning
    // something, but it no longer appears here to be selected again.
    where: { organizationId, isActive: true },
    orderBy: { code: 'asc' },
    select: {
      id: true, code: true, name: true, type: true, subType: true, parentId: true,
      isSystem: true, isActive: true,
      parent: { select: { name: true } },
      _count: { select: { journalLines: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, code: r.code, name: r.name, type: r.type, subType: r.subType,
    parentId: r.parentId, parentName: r.parent?.name ?? null,
    isSystem: r.isSystem, isActive: r.isActive,
    journalLineCount: r._count.journalLines,
  }));
}

export interface AccountInput {
  code: string;
  name: string;
  type: string;
  subType: string | null;
  parentId: string | null;
}

const VALID_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];

/** Always a custom row - `isSystem: true` accounts only ever come from the standard seed. */
export async function createAccount(organizationId: string, input: AccountInput): Promise<{ id: string }> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code) throw new ChartOfAccountsError('Give the account a code.');
  if (!name) throw new ChartOfAccountsError('Give the account a name.');
  if (!VALID_TYPES.includes(input.type)) throw new ChartOfAccountsError('Choose a valid account type.');

  const existing = await db.account.findUnique({ where: { organizationId_code: { organizationId, code } } });
  if (existing) throw new ChartOfAccountsError(`Account code "${code}" is already in use.`);

  if (input.parentId) {
    const parent = await db.account.findFirst({ where: { id: input.parentId, organizationId } });
    if (!parent) throw new ChartOfAccountsError('That parent account is not in your organisation.');
  }

  const account = await db.account.create({
    data: {
      organizationId, code, name, type: input.type,
      subType: input.subType?.trim() || null,
      parentId: input.parentId,
      isSystem: false,
    },
    select: { id: true },
  });
  return account;
}

export async function updateAccount(
  organizationId: string, id: string, patch: { name?: string; subType?: string | null },
): Promise<void> {
  const account = await db.account.findFirst({ where: { id, organizationId } });
  if (!account) throw new ChartOfAccountsError('Account not found.');
  if (account.isSystem) {
    throw new ChartOfAccountsError('Standard accounts cannot be edited - add a custom account instead.');
  }

  await db.account.update({
    where: { id },
    data: {
      ...(patch.name?.trim() ? { name: patch.name.trim() } : {}),
      ...(patch.subType !== undefined ? { subType: patch.subType?.trim() || null } : {}),
    },
  });
}

export async function deactivateAccount(organizationId: string, id: string): Promise<void> {
  const account = await db.account.findFirst({
    where: { id, organizationId },
    select: { isSystem: true, _count: { select: { journalLines: true, children: true } } },
  });
  if (!account) throw new ChartOfAccountsError('Account not found.');
  if (account.isSystem) throw new ChartOfAccountsError('Standard accounts cannot be deactivated.');
  if (account._count.journalLines > 0) {
    throw new ChartOfAccountsError('This account has posted journal lines and cannot be removed - GL history must stay intact.');
  }
  if (account._count.children > 0) {
    throw new ChartOfAccountsError('Move or remove its child accounts first.');
  }
  await db.account.update({ where: { id }, data: { isActive: false } });
}
