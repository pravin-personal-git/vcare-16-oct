import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';

/**
 * Income Tax Declarations (roadmap §4.5) - `IncomeTaxDeclaration` existed in
 * schema, unused. This is the screen that finally reads it, closing the gap
 * `calculateMonthlyTDS` has always flagged: an old-regime contract got 0
 * TDS because nothing supplied a declared-deductions figure. Only a
 * VERIFIED declaration is ever read by payroll (see payroll-run.ts) - an
 * employee's own unverified numbers never silently lower their tax.
 */
export class IncomeTaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IncomeTaxError';
  }
}

export interface DeclarationRow {
  id: string;
  userId: string;
  userName: string;
  financialYear: number;
  regime: string;
  declarations: Record<string, number>;
  proofStatus: string;
  totalDeclaredPaise: number;
  updatedAt: Date;
}

export async function listDeclarations(scope: StoreScope, financialYear: number): Promise<DeclarationRow[]> {
  const rows = await db.incomeTaxDeclaration.findMany({
    where: { ...scopeWhere(scope), financialYear },
    include: { user: { select: { fullName: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id, userId: r.userId, userName: r.user.fullName, financialYear: r.financialYear,
    regime: r.regime, declarations: (r.declarations as Record<string, number>) ?? {},
    proofStatus: r.proofStatus, totalDeclaredPaise: r.totalDeclaredPaise, updatedAt: r.updatedAt,
  }));
}

export async function getMyDeclaration(
  scope: StoreScope, userId: string, financialYear: number,
): Promise<DeclarationRow | null> {
  const storeId = scopeForWrite(scope);
  const r = await db.incomeTaxDeclaration.findUnique({
    where: { storeId_userId_financialYear: { storeId, userId, financialYear } },
    include: { user: { select: { fullName: true } } },
  });
  if (!r) return null;
  return {
    id: r.id, userId: r.userId, userName: r.user.fullName, financialYear: r.financialYear,
    regime: r.regime, declarations: (r.declarations as Record<string, number>) ?? {},
    proofStatus: r.proofStatus, totalDeclaredPaise: r.totalDeclaredPaise, updatedAt: r.updatedAt,
  };
}

/** Self-service: an employee declares (or re-declares) their own year. Re-saving after proof was verified resets it to pending - a changed number needs re-checking, not a carried-over stamp. */
export async function saveMyDeclaration(
  scope: StoreScope,
  input: { financialYear: number; regime: string; declarations: Record<string, number> },
  userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (input.regime !== 'old' && input.regime !== 'new') throw new IncomeTaxError('Regime must be old or new.');

  const totalDeclaredPaise = Object.values(input.declarations).reduce(
    (sum, rupees) => sum + Math.max(0, Math.round(Number(rupees) * 100)), 0,
  );

  await db.incomeTaxDeclaration.upsert({
    where: { storeId_userId_financialYear: { storeId, userId, financialYear: input.financialYear } },
    create: {
      storeId, userId, financialYear: input.financialYear, regime: input.regime,
      declarations: input.declarations, totalDeclaredPaise, proofStatus: 'pending', updatedBy: userId,
    },
    update: {
      regime: input.regime, declarations: input.declarations, totalDeclaredPaise,
      proofStatus: 'pending', updatedBy: userId,
    },
  });
}

/** HR/payroll marks proof as received (or reverts it) - the gate `payroll-run.ts` checks before a declaration ever lowers TDS. */
export async function setDeclarationProofStatus(
  scope: StoreScope, id: string, proofStatus: 'pending' | 'submitted' | 'verified', userId: string,
): Promise<void> {
  const existing = await db.incomeTaxDeclaration.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!existing) throw new IncomeTaxError('Declaration not found in your scope.');
  await db.incomeTaxDeclaration.update({ where: { id: existing.id }, data: { proofStatus, updatedBy: userId } });
}
