import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { listUserAccounts } from './staff-accounts';

/**
 * Employee Salary - spec 09-attendance-hrm.md §7, the light half of Payroll.
 *
 * Real payroll runs under HRM → Payroll. This is deliberately not a second
 * payroll engine - no versioning, no statutory filing, no payslips. It gives a
 * tenant a gross-cost figure per employee and a rough summary
 * on the HR dashboard. PF (12% of Basic) and ESIC (0.75% of Gross) are
 * indicative arithmetic, not a compliance calculation - the UI says so.
 */

export class PayrollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayrollError';
  }
}

const PF_RATE = 0.12;
const ESIC_RATE = 0.0075;

export interface EmployeeSalaryRow {
  hasStructure: boolean;
  userId: string;
  fullName: string;
  userCode: string;
  basicPaise: number;
  hraPaise: number;
  allowancesPaise: number;
  grossPaise: number;
  pfPaise: number;
  esicPaise: number;
  pfApplicable: boolean;
  esicApplicable: boolean;
  isActive: boolean;
  notes: string | null;
}

function toRow(u: {
  id: string; fullName: string; userCode: string;
  salary: {
    basicPaise: number; hraPaise: number; allowancesPaise: number;
    pfApplicable: boolean; esicApplicable: boolean; isActive: boolean; notes: string | null;
  } | null;
}): EmployeeSalaryRow {
  const s = u.salary;
  const basicPaise = s?.basicPaise ?? 0;
  const hraPaise = s?.hraPaise ?? 0;
  const allowancesPaise = s?.allowancesPaise ?? 0;
  const grossPaise = basicPaise + hraPaise + allowancesPaise;
  const pfApplicable = s?.pfApplicable ?? true;
  const esicApplicable = s?.esicApplicable ?? false;
  return {
    hasStructure: s !== null,
    userId: u.id,
    fullName: u.fullName,
    userCode: u.userCode,
    basicPaise, hraPaise, allowancesPaise, grossPaise,
    pfPaise: pfApplicable ? Math.round(basicPaise * PF_RATE) : 0,
    esicPaise: esicApplicable ? Math.round(grossPaise * ESIC_RATE) : 0,
    pfApplicable, esicApplicable,
    isActive: s?.isActive ?? true,
    notes: s?.notes ?? null,
  };
}

/**
 * Every employee visible in this scope, with their salary structure if one
 * exists. Reads through `User.storeRoles` - the same relation-scoping
 * `search.ts` already uses - because `User` itself carries no `storeId`.
 */
export async function listEmployeeSalaries(scope: StoreScope): Promise<EmployeeSalaryRow[]> {
  const users = await db.user.findMany({
    where: { storeRoles: { some: scopeWhere(scope) }, isActive: true },
    select: {
      id: true, fullName: true, userCode: true,
      salary: {
        select: {
          basicPaise: true, hraPaise: true, allowancesPaise: true,
          pfApplicable: true, esicApplicable: true, isActive: true, notes: true,
        },
      },
    },
    orderBy: { fullName: 'asc' },
    distinct: ['id'],
  });
  return users.map(toRow);
}

export interface SalaryStructureInput {
  userId: string;
  basicPaise: number;
  hraPaise: number;
  allowancesPaise: number;
  pfApplicable: boolean;
  esicApplicable: boolean;
  notes: string | null;
}

export async function upsertEmployeeSalary(
  scope: StoreScope, input: SalaryStructureInput, userId: string,
): Promise<void> {
  scopeForWrite(scope);
  if (input.basicPaise <= 0) throw new PayrollError('Basic pay must be greater than zero.');
  if (input.hraPaise < 0 || input.allowancesPaise < 0) throw new PayrollError('HRA and allowances cannot be negative.');

  const target = await db.user.findFirst({
    where: { id: input.userId, storeRoles: { some: scopeWhere(scope) } },
    select: { id: true },
  });
  if (!target) throw new PayrollError('Employee not found in your scope.');

  await db.employeeSalary.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      basicPaise: input.basicPaise,
      hraPaise: input.hraPaise,
      allowancesPaise: input.allowancesPaise,
      pfApplicable: input.pfApplicable,
      esicApplicable: input.esicApplicable,
      notes: input.notes,
      createdBy: userId,
    },
    update: {
      basicPaise: input.basicPaise,
      hraPaise: input.hraPaise,
      allowancesPaise: input.allowancesPaise,
      pfApplicable: input.pfApplicable,
      esicApplicable: input.esicApplicable,
      notes: input.notes,
      isActive: true,
    },
  });
}

export async function setEmployeeSalaryActive(
  scope: StoreScope, targetUserId: string, isActive: boolean,
): Promise<void> {
  scopeForWrite(scope);
  const target = await db.user.findFirst({
    where: { id: targetUserId, storeRoles: { some: scopeWhere(scope) } },
    select: { id: true },
  });
  if (!target) throw new PayrollError('Employee not found in your scope.');

  const updated = await db.employeeSalary.updateMany({
    where: { userId: targetUserId },
    data: { isActive },
  });
  if (updated.count === 0) throw new PayrollError('No salary structure set for this employee yet.');
}

// ------------------------------------------------------------------- summary

export interface PayrollSummary {
  employeeCount: number;
  grossPaise: number;
  pfPaise: number;
  esicPaise: number;
  advancesOutstandingPaise: number;
  netPaise: number;
}

/**
 * Gross Payroll, PF, ESIC and advances-outstanding - the spec's own Payroll
 * summary. Salary Advances reuses `listUserAccounts`'s already-built
 * outstanding-advance figure rather than re-deriving it from
 * `StaffTransaction`, so this can never disagree with the Staff Balance
 * screen about who owes what.
 *
 * `netPaise` IS NOT A PAYROLL NET (8 Oct 2026).
 *
 * It used to be `gross - PF - ESIC - advancesOutstandingPaise`, which
 * subtracted a CUMULATIVE, all-time advance balance from ONE month's gross:
 * a ₹50,000 advance from last year made this month's "Net Payroll" ₹50,000
 * smaller, forever. It also ignored TDS, PT, loss of pay and loan EMI
 * entirely. The advance subtraction is gone and the figure is labelled for
 * what it is on the screen.
 *
 * The real net for a month is on the payroll run's payslips
 * (`getPayrollRunDetail`), computed by `lib/payroll-engine`. This is a
 * structure-level estimate for a dashboard tile, nothing more.
 */
export async function getPayrollSummary(scope: StoreScope): Promise<PayrollSummary> {
  const [salaries, accounts] = await Promise.all([
    listEmployeeSalaries(scope),
    listUserAccounts(scope),
  ]);

  const structured = salaries.filter((r) => r.hasStructure && r.isActive);
  const grossPaise = structured.reduce((n, r) => n + r.grossPaise, 0);
  const pfPaise = structured.reduce((n, r) => n + r.pfPaise, 0);
  const esicPaise = structured.reduce((n, r) => n + r.esicPaise, 0);
  const advancesOutstandingPaise = accounts.rows.reduce(
    (n, r) => n + Math.max(0, r.advanceOutstandingPaise), 0,
  );

  return {
    employeeCount: structured.length,
    grossPaise, pfPaise, esicPaise, advancesOutstandingPaise,
    netPaise: grossPaise - pfPaise - esicPaise,
  };
}
