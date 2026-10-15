import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';

/**
 * The block printed at the bottom of a quotation or invoice so a customer
 * knows where to pay. Ref Setting > Bank Account.
 */

export class BankAccountError extends Error {}

export async function listBankAccounts(scope: StoreScope) {
  return db.bankAccount.findMany({
    where: scopeWhere(scope),
    orderBy: [{ isDefault: 'desc' }, { bankName: 'asc' }],
  });
}

export interface BankAccountInput {
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  branch: string | null;
  showOnDocuments: boolean;
}

function validate(input: BankAccountInput) {
  if (!input.accountHolderName.trim()) throw new BankAccountError('Account holder name is required.');
  if (!input.bankName.trim()) throw new BankAccountError('Bank name is required.');
  if (!input.accountNumber.trim()) throw new BankAccountError('Account number is required.');
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(input.ifsc.trim())) {
    throw new BankAccountError('That does not look like a valid IFSC code (e.g. HDFC0001234).');
  }
}

export async function createBankAccount(scope: StoreScope, input: BankAccountInput) {
  const storeId = scopeForWrite(scope);
  validate(input);

  const existing = await db.bankAccount.count({ where: { storeId } });

  return db.bankAccount.create({
    data: {
      storeId,
      accountHolderName: input.accountHolderName.trim(),
      bankName: input.bankName.trim(),
      accountNumber: input.accountNumber.trim(),
      ifsc: input.ifsc.trim().toUpperCase(),
      branch: input.branch?.trim() || null,
      showOnDocuments: input.showOnDocuments,
      // The first account for a store becomes the default automatically -
      // otherwise a fresh tenant prints no bank details on its first invoice
      // and nobody notices until a customer asks where to pay.
      isDefault: existing === 0,
    },
  });
}

export async function updateBankAccount(scope: StoreScope, id: string, input: BankAccountInput) {
  const storeId = scopeForWrite(scope);
  validate(input);

  const found = await db.bankAccount.findFirst({ where: { id, storeId } });
  if (!found) throw new BankAccountError('That bank account is not in your scope.');

  return db.bankAccount.update({
    where: { id },
    data: {
      accountHolderName: input.accountHolderName.trim(),
      bankName: input.bankName.trim(),
      accountNumber: input.accountNumber.trim(),
      ifsc: input.ifsc.trim().toUpperCase(),
      branch: input.branch?.trim() || null,
      showOnDocuments: input.showOnDocuments,
    },
  });
}

/**
 * Exactly one default per store. Not a schema constraint - a partial unique
 * index on a boolean needs raw SQL Prisma's declarative schema cannot
 * express - enforced here instead, inside one transaction so two people
 * clicking "Set default" on different rows at once cannot leave two.
 */
export async function setDefaultBankAccount(scope: StoreScope, id: string) {
  const storeId = scopeForWrite(scope);
  const found = await db.bankAccount.findFirst({ where: { id, storeId } });
  if (!found) throw new BankAccountError('That bank account is not in your scope.');

  await db.$transaction([
    db.bankAccount.updateMany({ where: { storeId, isDefault: true }, data: { isDefault: false } }),
    db.bankAccount.update({ where: { id }, data: { isDefault: true } }),
  ]);
}

export async function setBankAccountActive(scope: StoreScope, id: string, isActive: boolean) {
  const storeId = scopeForWrite(scope);
  const found = await db.bankAccount.findFirst({ where: { id, storeId } });
  if (!found) throw new BankAccountError('That bank account is not in your scope.');
  if (found.isDefault && !isActive) {
    throw new BankAccountError('This is the default account. Set another one as default first.');
  }

  return db.bankAccount.update({ where: { id }, data: { isActive } });
}

export async function deleteBankAccount(
  scope: StoreScope, id: string, userId: string | null = null,
) {
  const storeId = scopeForWrite(scope);
  const found = await db.bankAccount.findFirst({ where: { id, storeId } });
  if (!found) throw new BankAccountError('That bank account is not in your scope.');
  if (found.isDefault) {
    throw new BankAccountError('This is the default account. Set another one as default before deleting it.');
  }

  // Tombstoned, not removed (3 Oct 2026). A bank account is referenced by every
  // receipt and payment made through it; a row that comes back from another
  // machine after somebody closed the account is worse than one that stays and
  // is hidden (`server/soft-delete`).
  await db.bankAccount.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: userId } });
}
