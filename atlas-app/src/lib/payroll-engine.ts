import { calculatePF, calculateESIC, calculateProfessionalTax, calculateMonthlyTDS, type PtSlab } from './payroll-statutory';
import { incentivePaise } from './target-period';

/**
 * One employee's payslip breakup for one period - pure arithmetic over
 * already-fetched inputs, no database. `server/payroll-run.ts` is what
 * fetches a contract's components, a period's attendance days, an active
 * loan's EMI, and calls this.
 *
 * GROSS IS THE FULL CONTRACTED FIGURE, LOSS-OF-PAY IS A DEDUCTION
 *
 * `grossPaise` on the result is what the contract says this person earns in
 * a full period, not shrunk for the days they were away - the same figure a
 * printed payslip's "Gross Salary" line means. Loss-of-pay is its own
 * deduction line below it, exactly like PF or a loan EMI, so `netPaise` is
 * always `grossPaise - totalDeductionsPaise` with nothing hidden inside the
 * earnings side. Statutory deductions are computed on the EARNED figures
 * (post-LOP), because PF/ESIC/PT/TDS are owed on what was actually paid,
 * never on a contracted figure the employee didn't receive this period.
 */

export interface PayslipComponentInput {
  code: string;
  label: string;
  monthlyPaise: number;
}

/**
 * Turn a `percent_of_sales` `SalaryComponent` into the one concrete paise
 * figure `computePayslip` above actually needs - this is the ONLY place a
 * formula-driven component becomes a number. `computePayslip` itself never
 * learns a component could be anything other than a flat monthly figure;
 * `server/payroll-run.ts` calls this once per formula component, per
 * employee, per run, before building the `components` array it hands to
 * `computePayslip`.
 *
 * Reuses `incentivePaise` (`lib/target-period.ts`) rather than
 * re-implementing "percentage of achieved sales" a second time - that
 * function already backs the Sales Target report's own incentive figure,
 * and a payroll component computing it differently would be exactly the
 * "two reports disagree about revenue" bug `lib/revenue.ts`'s own doc
 * comment warns about, just moved one layer up.
 */
export function resolvePercentOfSalesPaise(
  achievedSalesPaise: number, ratePct: number, capPaise: number | null,
): number {
  const raw = incentivePaise(achievedSalesPaise, ratePct);
  return capPaise !== null ? Math.min(raw, capPaise) : raw;
}

/**
 * `percent_of_basic` / `percent_of_gross` - a plain percentage of whatever
 * basis figure the caller hands in. Deliberately separate from
 * `resolvePercentOfSalesPaise` above: that one exists specifically to reuse
 * `incentivePaise`'s exact rounding so it can never disagree with the Sales
 * Target report's own incentive figure - a concern that doesn't apply here,
 * since neither basic pay nor gross pay is a number any other report
 * independently computes.
 */
export function resolvePercentPaise(basisPaise: number, ratePct: number): number {
  return Math.round(basisPaise * (ratePct / 100));
}

/** `per_attendance_day` - a flat rate for each day the employee actually attended this period (see `countPresentDays` in `payroll-days.ts`). */
export function resolvePerAttendanceDayPaise(presentDays: number, unitRatePaise: number): number {
  return Math.round(presentDays * unitRatePaise);
}

/** `per_overtime_hour` - a flat hourly rate against however many overtime minutes fell in the requested bucket (see `summarizeOvertimeMinutes` in `payroll-days.ts`). */
export function resolvePerOvertimeHourPaise(overtimeMinutes: number, unitRatePaise: number): number {
  return Math.round((overtimeMinutes / 60) * unitRatePaise);
}

/** The employer-matched half of a contribution - computed for the payslip document, never subtracted from the employee's own pay. See the schema note on `SalaryComponent.employerRatePct`. */
export function resolveEmployerContributionPaise(basisPaise: number, employerRatePct: number): number {
  return Math.round(basisPaise * (employerRatePct / 100));
}

/** Applies to every variable calcType, not only `percent_of_sales` - see the schema note on `SalaryComponent.capPaise`. */
export function applyCap(rawPaise: number, capPaise: number | null): number {
  return capPaise !== null ? Math.min(rawPaise, capPaise) : rawPaise;
}

export interface SalaryComponentConditionInput {
  field: string; // contractType | employmentType
  operator: string; // equal | not_equal
  value: string;
}

/**
 * Whether a component with these targeting rules applies to this contract -
 * every condition must pass (AND, matching atlas-hrns's own condition-based
 * allowances). Zero conditions always passes, same as before targeting
 * existed at all.
 */
export function passesComponentConditions(
  conditions: SalaryComponentConditionInput[],
  context: { contractType: string; employmentType: string | null },
): boolean {
  for (const cond of conditions) {
    const actual = cond.field === 'contractType' ? context.contractType : context.employmentType;
    const matches = actual === cond.value;
    if (cond.operator === 'equal' && !matches) return false;
    if (cond.operator === 'not_equal' && matches) return false;
  }
  return true;
}

/**
 * Whether a one-time component pays out in this run - `oneTimePeriodStart`
 * falling anywhere inside [periodStart, periodEnd] is enough, it does not
 * need to equal the period's own start date exactly. Null (recurring)
 * always applies.
 */
export function isOneTimeComponentDue(
  oneTimePeriodStart: Date | null, periodStart: Date, periodEnd: Date,
): boolean {
  if (oneTimePeriodStart === null) return true;
  return oneTimePeriodStart >= periodStart && oneTimePeriodStart <= periodEnd;
}

export interface PayrollConfigInput {
  pfEnabled: boolean;
  pfEmployeeRatePct: number;
  pfEmployerRatePct: number;
  pfWageCeilingPaise: number;
  esicEnabled: boolean;
  esicEmployeeRatePct: number;
  esicEmployerRatePct: number;
  esicWageThresholdPaise: number;
  ptEnabled: boolean;
  ptSlabs: PtSlab[];
}

export interface ComputePayslipInput {
  components: PayslipComponentInput[];
  workingDays: number;
  paidDays: number;
  lopDays: number;
  pfApplicable: boolean;
  esicApplicable: boolean;
  ptApplicable: boolean;
  taxRegime: string;
  payrollConfig: PayrollConfigInput;
  /** This period's due EMI across the employee's active `StaffLoan`s, if any - already capped at what is outstanding by `lib/loan-emi.ts`, a plain deduction line here. */
  loanEmiPaise?: number;
  /** The label for that line, from `dueLoanEmi` - it names where the loan stands after this month. Falls back to a plain "Loan EMI". */
  loanEmiLabel?: string;
  /** This period's recovery against plain (non-loan) staff advances, if the store has it switched on - see `PayrollConfiguration.advanceRecoveryEnabled`. */
  advanceRecoveryPaise?: number;
  /** The label for that line - it names what is left to recover. */
  advanceRecoveryLabel?: string;
  /** Old-regime only: the employee's verified `IncomeTaxDeclaration` total for the year, resolved by the caller. See `calculateMonthlyTDS`. */
  annualDeclaredDeductionPaise?: number;
}

/**
 * `employer_contribution` never comes out of `computePayslip` itself - it
 * plays no part in gross/deductions/net arithmetic, so `payroll-run.ts`
 * appends these lines separately once `computePayslip` has already run.
 * The type is widened here because `PayslipLine.kind` in the database
 * holds all three, and callers reading a stored payslip back need the
 * full set, not just the two this function actually produces.
 */
export interface PayslipLineResult {
  kind: 'earning' | 'deduction' | 'employer_contribution';
  code: string;
  label: string;
  amountPaise: number;
}

export interface ComputedPayslip {
  lines: PayslipLineResult[];
  grossPaise: number;
  totalDeductionsPaise: number;
  netPaise: number;
}

export function computePayslip(input: ComputePayslipInput): ComputedPayslip {
  const lines: PayslipLineResult[] = [];
  let grossPaise = 0;
  let basicPaise = 0;

  for (const c of input.components) {
    lines.push({ kind: 'earning', code: c.code, label: c.label, amountPaise: c.monthlyPaise });
    grossPaise += c.monthlyPaise;
    if (c.code === 'BASIC') basicPaise = c.monthlyPaise;
  }

  let totalDeductionsPaise = 0;
  const proRate = input.workingDays > 0 ? input.paidDays / input.workingDays : 1;

  if (input.lopDays > 0 && input.workingDays > 0) {
    const lopPaise = grossPaise - Math.round(grossPaise * proRate);
    if (lopPaise > 0) {
      const dayWord = input.lopDays === 1 ? 'day' : 'days';
      lines.push({ kind: 'deduction', code: 'LOP', label: `Loss of Pay (${input.lopDays} ${dayWord})`, amountPaise: lopPaise });
      totalDeductionsPaise += lopPaise;
    }
  }

  const earnedBasicPaise = Math.round(basicPaise * proRate);
  const earnedGrossPaise = grossPaise - totalDeductionsPaise;

  if (input.pfApplicable) {
    const pf = calculatePF(earnedBasicPaise, input.payrollConfig);
    if (pf.employeePaise > 0) {
      lines.push({ kind: 'deduction', code: 'PF', label: 'Provident Fund', amountPaise: pf.employeePaise });
      totalDeductionsPaise += pf.employeePaise;
    }
  }

  if (input.esicApplicable) {
    const esic = calculateESIC(earnedGrossPaise, input.payrollConfig);
    if (esic.employeePaise > 0) {
      lines.push({ kind: 'deduction', code: 'ESIC', label: 'ESIC', amountPaise: esic.employeePaise });
      totalDeductionsPaise += esic.employeePaise;
    }
  }

  if (input.ptApplicable) {
    const pt = calculateProfessionalTax(earnedGrossPaise, input.payrollConfig.ptEnabled, input.payrollConfig.ptSlabs);
    if (pt > 0) {
      lines.push({ kind: 'deduction', code: 'PT', label: 'Professional Tax', amountPaise: pt });
      totalDeductionsPaise += pt;
    }
  }

  const tds = calculateMonthlyTDS(earnedGrossPaise, input.taxRegime, input.annualDeclaredDeductionPaise ?? 0);
  if (tds > 0) {
    lines.push({ kind: 'deduction', code: 'TDS', label: 'Income Tax (TDS)', amountPaise: tds });
    totalDeductionsPaise += tds;
  }

  // THE EMI CANNOT TAKE MORE THAN THE PAY LEFT (8 Oct 2026).
  //
  // Everything above is owed on what was earned, so it can never exceed the
  // gross. An EMI can: a month of unpaid leave leaves nothing to deduct from,
  // and a full-LOP month with a ₹10,000 EMI produced a net of MINUS ₹10,000.
  // That run could not even be processed - `validateBalanced` refuses a
  // negative credit - so the month simply stopped, with a ledger error nobody
  // could read.
  //
  // Capped at what is left instead. Because `processPayrollRun` records the
  // repayment from the PAYSLIP LINE, not from the schedule, whatever was not
  // collected stays on the loan and the next month asks for it again.
  if (input.loanEmiPaise && input.loanEmiPaise > 0) {
    const roomPaise = Math.max(0, grossPaise - totalDeductionsPaise);
    const emiPaise = Math.min(input.loanEmiPaise, roomPaise);
    if (emiPaise > 0) {
      const short = emiPaise < input.loanEmiPaise;
      lines.push({
        kind: 'deduction', code: 'LOAN_EMI',
        label: short
          ? 'Loan EMI - part only, the pay this month did not cover it'
          : input.loanEmiLabel?.trim() || 'Loan EMI',
        amountPaise: emiPaise,
      });
      totalDeductionsPaise += emiPaise;
    }
  }

  // AFTER the loan, and capped the same way.
  //
  // The loan comes first because it is the one with a schedule somebody
  // agreed to. A plain advance has no schedule, so it takes whatever room is
  // left and asks again next month - which is also why a thin month quietly
  // recovers less instead of pushing net pay below zero.
  if (input.advanceRecoveryPaise && input.advanceRecoveryPaise > 0) {
    const roomPaise = Math.max(0, grossPaise - totalDeductionsPaise);
    const takePaise = Math.min(input.advanceRecoveryPaise, roomPaise);
    if (takePaise > 0) {
      const short = takePaise < input.advanceRecoveryPaise;
      lines.push({
        kind: 'deduction', code: 'ADVANCE',
        label: short
          ? 'Advance recovery - part only, the pay this month did not cover it'
          : input.advanceRecoveryLabel?.trim() || 'Advance recovery',
        amountPaise: takePaise,
      });
      totalDeductionsPaise += takePaise;
    }
  }

  return {
    lines,
    grossPaise,
    totalDeductionsPaise,
    netPaise: grossPaise - totalDeductionsPaise,
  };
}
