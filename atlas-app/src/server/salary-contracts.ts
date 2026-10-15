import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';

/**
 * SALARY CONTRACTS - Atlas-HRNS's "Contracts" screen.
 *
 * Effective-dated, the same shape as `ReportingAssignment`: a raise or a
 * change of terms creates a NEW row and closes whatever was open before it,
 * it never edits history. A payslip already generated under last month's
 * contract must keep meaning what it meant, even after this month's raise -
 * see the note on `SalaryContract` in schema.prisma.
 *
 * Supersedes the flat `EmployeeSalary` (`server/payroll.ts`) for any
 * employee who has one of these instead - `/hrm/salary` is left alone for
 * now rather than migrated in the same pass that introduces its
 * replacement.
 */

export class SalaryContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalaryContractError';
  }
}

/** A fixed catalogue the calculation engine recognises `BASIC` and `HRA` by code - see `payroll-engine.ts`. Anything else is free-text, same balance `TaxRate`/`PaymentType` strike. */
export const COMPONENT_PRESETS = [
  { code: 'BASIC', label: 'Basic' },
  { code: 'HRA', label: 'HRA' },
  { code: 'CONVEYANCE', label: 'Conveyance' },
  { code: 'SPECIAL_ALLOWANCE', label: 'Special Allowance' },
  { code: 'LTA', label: 'LTA' },
  { code: 'MEDICAL', label: 'Medical Allowance' },
] as const;

export const CONTRACT_TYPES = [
  { value: 'permanent', label: 'Permanent' },
  { value: 'probation', label: 'Probation' },
  { value: 'contract', label: 'Contract' },
  { value: 'intern', label: 'Intern' },
] as const;

export const CALC_TYPES = [
  { value: 'fixed', label: 'Fixed amount' },
  { value: 'percent_of_basic', label: '% of basic pay' },
  { value: 'percent_of_gross', label: '% of gross pay' },
  { value: 'percent_of_sales', label: '% of sales (capped)' },
  { value: 'per_attendance_day', label: 'Per day attended' },
  { value: 'per_overtime_hour', label: 'Per overtime hour' },
] as const;

export const OVERTIME_KINDS = [
  { value: 'regular', label: 'Regular overtime' },
  { value: 'week_off', label: 'Overtime on a weekly off' },
  { value: 'holiday', label: 'Overtime on a holiday' },
] as const;

/** A small, explicit field list - see the schema note on `SalaryComponentCondition` for why this isn't a fully dynamic system. */
export const CONDITION_FIELDS = [
  { value: 'contractType', label: 'Contract Type' },
  { value: 'employmentType', label: 'Employment Type' },
] as const;

export const CONDITION_OPERATORS = [
  { value: 'equal', label: 'is' },
  { value: 'not_equal', label: 'is not' },
] as const;

export interface ComponentConditionRow {
  field: string;
  operator: string;
  value: string;
}

export interface ContractComponentRow {
  code: string;
  label: string;
  /** For `calcType = 'fixed'` only. Null for a formula-driven component - there is no single monthly figure until a period's actual data is known. */
  monthlyPaise: number | null;
  calcType: string;
  /** For a `percent_of_*` calcType only. */
  ratePct: number | null;
  /** Applies to every variable calcType. Null = uncapped. */
  capPaise: number | null;
  /** For `per_attendance_day` / `per_overtime_hour` only - the flat rate per unit. */
  unitRatePaise: number | null;
  /** For `per_overtime_hour` only - which overtime bucket this reads. */
  overtimeKind: string | null;
  /** Employer-matched contribution, tracked for the payslip document, never deducted. */
  employerRatePct: number | null;
  /** Set only for a one-off component - pays out in whichever run's period contains this date. Null = recurring. */
  oneTimePeriodStart: Date | null;
  /** Targeting rules - a component with none applies to every contract that reaches it. */
  conditions: ComponentConditionRow[];
}

export interface EmployeeContractRow {
  userId: string;
  fullName: string;
  userCode: string;
  hasContract: boolean;
  contractId: string | null;
  contractType: string | null;
  effectiveFrom: Date | null;
  ctcAnnualPaise: number;
  /** Fixed components summed, plus each variable one's cap (its ceiling estimate) or 0 if uncapped - the real figure is only known once a payroll run actually looks at that period's sales. */
  estimatedGrossMonthlyPaise: number;
  hasVariableComponent: boolean;
  pfApplicable: boolean;
  esicApplicable: boolean;
  ptApplicable: boolean;
  taxRegime: string;
  isActive: boolean;
  components: ContractComponentRow[];
}

type ComponentSelect = {
  code: string; label: string; monthlyPaise: number | null;
  calcType: string; ratePct: { toNumber(): number } | null; capPaise: number | null;
  unitRatePaise: number | null; overtimeKind: string | null;
  employerRatePct: { toNumber(): number } | null; oneTimePeriodStart: Date | null;
  conditions: ComponentConditionRow[];
};

function toComponentRow(x: ComponentSelect): ContractComponentRow {
  return {
    code: x.code, label: x.label, monthlyPaise: x.monthlyPaise, calcType: x.calcType,
    ratePct: x.ratePct !== null ? x.ratePct.toNumber() : null,
    capPaise: x.capPaise,
    unitRatePaise: x.unitRatePaise,
    overtimeKind: x.overtimeKind,
    employerRatePct: x.employerRatePct !== null ? x.employerRatePct.toNumber() : null,
    oneTimePeriodStart: x.oneTimePeriodStart,
    conditions: x.conditions,
  };
}

/** A rough ceiling for the Contracts list view only - the real figure for any variable component is only known once a payroll run actually looks at that period's data. */
function estimatedMonthlyPaise(c: ContractComponentRow): number {
  if (c.calcType === 'fixed') return c.monthlyPaise ?? 0;
  return c.capPaise ?? 0;
}

function toRow(u: {
  id: string; fullName: string; userCode: string;
  salaryContracts: {
    id: string; contractType: string; effectiveFrom: Date; ctcAnnualPaise: number;
    pfApplicable: boolean; esicApplicable: boolean; ptApplicable: boolean; taxRegime: string;
    isActive: boolean;
    components: ComponentSelect[];
  }[];
}): EmployeeContractRow {
  const c = u.salaryContracts[0] ?? null;
  const components = c?.components.map(toComponentRow) ?? [];
  return {
    userId: u.id,
    fullName: u.fullName,
    userCode: u.userCode,
    hasContract: c !== null,
    contractId: c?.id ?? null,
    contractType: c?.contractType ?? null,
    effectiveFrom: c?.effectiveFrom ?? null,
    ctcAnnualPaise: c?.ctcAnnualPaise ?? 0,
    estimatedGrossMonthlyPaise: components.reduce((n, x) => n + estimatedMonthlyPaise(x), 0),
    hasVariableComponent: components.some((x) => x.calcType !== 'fixed'),
    pfApplicable: c?.pfApplicable ?? true,
    esicApplicable: c?.esicApplicable ?? false,
    ptApplicable: c?.ptApplicable ?? true,
    taxRegime: c?.taxRegime ?? 'new',
    isActive: c?.isActive ?? true,
    components,
  };
}

/**
 * Every employee visible in this scope, with their CURRENT contract if one
 * exists - the most recently effective row still marked active, exactly one
 * per person. Same relation-scoping as `listEmployeeSalaries`, because
 * `User` itself carries no `storeId`.
 */
export async function listSalaryContracts(scope: StoreScope): Promise<EmployeeContractRow[]> {
  const users = await db.user.findMany({
    where: { storeRoles: { some: scopeWhere(scope) }, isActive: true },
    select: {
      id: true, fullName: true, userCode: true,
      salaryContracts: {
        // `effectiveTo: null` is the authoritative "this is the current one"
        // signal - the same convention `ReportingAssignment` uses. `isActive`
        // means something orthogonal (administratively voided), not "is this
        // the effective version" - a raise closes the old row's
        // `effectiveTo` without touching `isActive`, so filtering on
        // `isActive` alone would still return a superseded contract.
        where: { effectiveTo: null, isActive: true },
        orderBy: { effectiveFrom: 'desc' },
        take: 1,
        select: {
          id: true, contractType: true, effectiveFrom: true, ctcAnnualPaise: true,
          pfApplicable: true, esicApplicable: true, ptApplicable: true, taxRegime: true, isActive: true,
          components: {
            orderBy: { sort: 'asc' },
            select: {
              code: true, label: true, monthlyPaise: true, calcType: true, ratePct: true, capPaise: true,
              unitRatePaise: true, overtimeKind: true, employerRatePct: true, oneTimePeriodStart: true,
              conditions: { select: { field: true, operator: true, value: true } },
            },
          },
        },
      },
    },
    orderBy: { fullName: 'asc' },
    distinct: ['id'],
  });
  return users.map(toRow);
}

export interface ContractHistoryRow {
  id: string;
  contractType: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  ctcAnnualPaise: number;
  isActive: boolean;
  components: ContractComponentRow[];
}

export async function getContractHistory(scope: StoreScope, targetUserId: string): Promise<ContractHistoryRow[]> {
  const target = await db.user.findFirst({
    where: { id: targetUserId, storeRoles: { some: scopeWhere(scope) } },
    select: { id: true },
  });
  if (!target) throw new SalaryContractError('Employee not found in your scope.');

  const rows = await db.salaryContract.findMany({
    where: { userId: targetUserId, storeId: scopeForWrite(scope) },
    orderBy: { effectiveFrom: 'desc' },
    include: { components: { orderBy: { sort: 'asc' }, include: { conditions: true } } },
  });

  return rows.map((c) => ({
    id: c.id, contractType: c.contractType, effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo,
    ctcAnnualPaise: c.ctcAnnualPaise, isActive: c.isActive,
    components: c.components.map(toComponentRow),
  }));
}

export interface CreateComponentInput {
  code: string;
  label: string;
  calcType: string;
  /** Required for `calcType = 'fixed'`, ignored otherwise. */
  monthlyPaise: number;
  /** Required for a `percent_of_*` calcType, ignored otherwise. */
  ratePct: number | null;
  /** Optional for any variable calcType - null means uncapped. Ignored for `fixed`. */
  capPaise: number | null;
  /** Required for `per_attendance_day` / `per_overtime_hour`, ignored otherwise. */
  unitRatePaise: number | null;
  /** Required for `per_overtime_hour`, ignored otherwise. */
  overtimeKind: string | null;
  /** Optional for any calcType - the employer-matched share, tracked not deducted. Null = not tracked. */
  employerRatePct: number | null;
  /** Optional for any calcType - set to make this a one-off component for the run whose period contains this date. Null = recurring. */
  oneTimePeriodStart: Date | null;
  /** Optional targeting rules - empty means this component applies to every contract that reaches it. */
  conditions: ComponentConditionRow[];
}

export interface CreateContractInput {
  userId: string;
  contractType: string;
  ctcAnnualPaise: number;
  pfApplicable: boolean;
  esicApplicable: boolean;
  ptApplicable: boolean;
  taxRegime: string;
  components: CreateComponentInput[];
}

/**
 * Start a new contract for one employee, closing whatever was open before
 * it - never editing an existing row, for the same reason `setReportsTo`
 * never edits `ReportingAssignment` history. A payslip already generated
 * under the old contract keeps its own copy of every figure it needs
 * (`Payslip` is a frozen snapshot), so closing the old contract here cannot
 * reach back and change a payslip that already exists.
 */
export async function createSalaryContract(
  scope: StoreScope, input: CreateContractInput, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);

  if (!CONTRACT_TYPES.some((t) => t.value === input.contractType)) {
    throw new SalaryContractError('Unknown contract type.');
  }
  if (input.ctcAnnualPaise <= 0) throw new SalaryContractError('Annual CTC must be greater than zero.');
  if (input.components.length === 0) throw new SalaryContractError('Add at least one earning component.');
  if (input.components.some((c) => !c.code.trim() || !c.label.trim())) {
    throw new SalaryContractError('Every component needs a code and a label.');
  }
  if (input.components.some((c) => !CALC_TYPES.some((t) => t.value === c.calcType))) {
    throw new SalaryContractError('Unknown calculation type on a component.');
  }
  for (const c of input.components) {
    const name = c.label || c.code;
    if (c.calcType === 'fixed' && c.monthlyPaise <= 0) {
      throw new SalaryContractError(`${name}: enter an amount greater than zero.`);
    }
    if (c.calcType.startsWith('percent_of_')) {
      if (c.ratePct === null || c.ratePct <= 0) {
        throw new SalaryContractError(`${name}: enter a percentage greater than zero.`);
      }
    }
    if (c.calcType === 'per_attendance_day' || c.calcType === 'per_overtime_hour') {
      if (c.unitRatePaise === null || c.unitRatePaise <= 0) {
        throw new SalaryContractError(`${name}: enter a rate greater than zero.`);
      }
    }
    if (c.calcType === 'per_overtime_hour' && !OVERTIME_KINDS.some((k) => k.value === c.overtimeKind)) {
      throw new SalaryContractError(`${name}: choose which kind of overtime this pays for.`);
    }
    if (c.calcType !== 'fixed' && c.capPaise !== null && c.capPaise <= 0) {
      throw new SalaryContractError(`${name}: the cap must be greater than zero, or left blank for uncapped.`);
    }
    if (c.employerRatePct !== null && c.employerRatePct <= 0) {
      throw new SalaryContractError(`${name}: the employer contribution rate must be greater than zero, or left blank.`);
    }
    for (const cond of c.conditions) {
      if (!CONDITION_FIELDS.some((f) => f.value === cond.field)) {
        throw new SalaryContractError(`${name}: unknown condition field.`);
      }
      if (!CONDITION_OPERATORS.some((o) => o.value === cond.operator)) {
        throw new SalaryContractError(`${name}: unknown condition operator.`);
      }
      if (!cond.value.trim()) {
        throw new SalaryContractError(`${name}: a condition needs a value to compare against.`);
      }
    }
  }
  // BASIC must always be a fixed amount - PF and HRA exemption are computed
  // from it, and a formula that can swing to zero in a bad sales month would
  // make an employee's own PF contribution swing with it, which nothing
  // about statutory PF allows.
  const basic = input.components.find((c) => c.code === 'BASIC');
  if (!basic) {
    throw new SalaryContractError('A Basic component is required - PF and HRA exemption are both computed from it.');
  }
  if (basic.calcType !== 'fixed') {
    throw new SalaryContractError('Basic must be a fixed amount, not a formula - PF and HRA exemption depend on it staying stable.');
  }
  // Basic must also always be IN the payslip - a targeting condition or a
  // one-off date could otherwise drop it from a specific run, and
  // `percent_of_basic`/PF/HRA exemption all assume it's always present.
  if (basic.conditions.length > 0) {
    throw new SalaryContractError('Basic cannot have a condition - it must apply to every run this contract covers.');
  }
  if (basic.oneTimePeriodStart !== null) {
    throw new SalaryContractError('Basic cannot be a one-off - it must recur every run.');
  }

  const target = await db.user.findFirst({
    where: { id: input.userId, storeRoles: { some: scopeWhere(scope) } },
    select: { id: true },
  });
  if (!target) throw new SalaryContractError('Employee not found in your scope.');

  const now = new Date();

  await db.$transaction(async (tx) => {
    await tx.salaryContract.updateMany({
      where: { storeId, userId: input.userId, effectiveTo: null },
      data: { effectiveTo: now },
    });

    await tx.salaryContract.create({
      data: {
        storeId,
        userId: input.userId,
        contractType: input.contractType,
        ctcAnnualPaise: input.ctcAnnualPaise,
        pfApplicable: input.pfApplicable,
        esicApplicable: input.esicApplicable,
        ptApplicable: input.ptApplicable,
        taxRegime: input.taxRegime,
        createdBy: userId,
        // `create` (per-item), not `createMany` - createMany can't take a
        // nested relation write, and each component may carry its own
        // `conditions` rows.
        components: {
          create: input.components.map((c, i) => ({
            code: c.code.trim().toUpperCase().replace(/\s+/g, '_'),
            label: c.label.trim(),
            calcType: c.calcType,
            monthlyPaise: c.calcType === 'fixed' ? c.monthlyPaise : null,
            ratePct: c.calcType.startsWith('percent_of_') ? c.ratePct : null,
            capPaise: c.calcType !== 'fixed' ? c.capPaise : null,
            unitRatePaise: c.calcType === 'per_attendance_day' || c.calcType === 'per_overtime_hour' ? c.unitRatePaise : null,
            overtimeKind: c.calcType === 'per_overtime_hour' ? c.overtimeKind : null,
            employerRatePct: c.employerRatePct,
            oneTimePeriodStart: c.oneTimePeriodStart,
            sort: i,
            conditions: {
              create: c.conditions.map((cond) => ({
                field: cond.field, operator: cond.operator, value: cond.value.trim(),
              })),
            },
          })),
        },
      },
    });
  });
}

export async function deactivateSalaryContract(scope: StoreScope, contractId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const updated = await db.salaryContract.updateMany({
    where: { id: contractId, storeId },
    data: { isActive: false, effectiveTo: new Date() },
  });
  if (updated.count === 0) throw new SalaryContractError('Contract not found in your scope.');
}
