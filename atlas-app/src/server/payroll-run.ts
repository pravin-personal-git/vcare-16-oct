import 'server-only';
import { db } from './db';
import { scopeForWrite, type StoreScope } from './store-scope';
import { istWall } from '@/lib/ist';
import { eachDay, storedBounds, storedDay, storedDays, weekdayOf } from '@/lib/attendance-day';
import { attendancePolicy } from './attendance-policy';
import { payPeriodsForYear, cycleIndexForDate } from '@/lib/payroll-cycle';
import { summarizePayrollDays, countPresentDays, summarizeOvertimeMinutes, type PayrollDayInput } from '@/lib/payroll-days';
import { effectiveDayPolicy } from '@/lib/shift-schedule';
import { getShiftScheduleByUser } from './work-schedules';
import {
  computePayslip, resolvePercentOfSalesPaise, resolvePercentPaise, resolvePerAttendanceDayPaise,
  resolvePerOvertimeHourPaise, resolveEmployerContributionPaise, applyCap,
  passesComponentConditions, isOneTimeComponentDue,
  type PayrollConfigInput, type PayslipComponentInput, type PayslipLineResult,
} from '@/lib/payroll-engine';
import type { PtSlab } from '@/lib/payroll-statutory';
import { dueLoanEmi, type LoanEmiDue } from '@/lib/loan-emi';
import { recoverableAdvances } from './staff-accounts';
import { postJournalEntry, reverseJournalEntry } from './ledger';
import type { LedgerLineInput } from '@/lib/ledger';
import { REVENUE_ORDER_WHERE } from '@/lib/revenue';
import { formatCurrency } from '@/lib/format';
import { getFinancialYear } from '@/lib/financial-year';

/**
 * GENERATE A PAYROLL RUN FROM REAL DATA.
 *
 * `lib/payroll-engine.ts` computes one payslip from already-fetched inputs;
 * this is where those inputs actually come from - a store's active salary
 * contracts, its attendance days, its approved leave, its holidays, and any
 * loan due this period - and where the result is written back as a
 * `PayrollRun` with one `Payslip` per employee.
 *
 * Regeneration is wholesale, not incremental: calling this again for the
 * same period on a still-`draft` run deletes and rebuilds every payslip in
 * it. A payroll run is small enough that diffing which employee's numbers
 * changed is not worth the risk of two rebuild paths quietly disagreeing.
 * A `locked` run refuses outright - see `PayrollRun.locked`.
 */

export class PayrollRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayrollRunError';
  }
}

const DEFAULT_PAYROLL_CONFIG: PayrollConfigInput = {
  pfEnabled: true, pfEmployeeRatePct: 12, pfEmployerRatePct: 12, pfWageCeilingPaise: 1_500_000,
  esicEnabled: false, esicEmployeeRatePct: 0.75, esicEmployerRatePct: 3.25, esicWageThresholdPaise: 2_100_000,
  ptEnabled: false, ptSlabs: [],
};

/**
 * Does this store take plain advances out of salary, and at most how much a
 * month (G-19)? Read separately from `loadPayrollConfig` on purpose: that one
 * returns the pure statutory input `lib/payroll-statutory` works on, and a
 * recovery policy is not a statutory rate.
 */
async function loadAdvanceRecovery(storeId: string): Promise<{ enabled: boolean; maxPaise: number }> {
  const row = await db.payrollConfiguration.findUnique({
    where: { storeId },
    select: { advanceRecoveryEnabled: true, advanceRecoveryMaxPaise: true },
  });
  return {
    enabled: row?.advanceRecoveryEnabled ?? false,
    maxPaise: row?.advanceRecoveryMaxPaise ?? 0,
  };
}

async function loadPayrollConfig(storeId: string): Promise<PayrollConfigInput> {
  const row = await db.payrollConfiguration.findUnique({ where: { storeId } });
  if (!row) return DEFAULT_PAYROLL_CONFIG;
  return {
    pfEnabled: row.pfEnabled,
    pfEmployeeRatePct: row.pfEmployeeRatePct.toNumber(),
    pfEmployerRatePct: row.pfEmployerRatePct.toNumber(),
    pfWageCeilingPaise: row.pfWageCeilingPaise,
    esicEnabled: row.esicEnabled,
    esicEmployeeRatePct: row.esicEmployeeRatePct.toNumber(),
    esicEmployerRatePct: row.esicEmployerRatePct.toNumber(),
    esicWageThresholdPaise: row.esicWageThresholdPaise,
    ptEnabled: row.ptEnabled,
    ptSlabs: (row.ptSlabs as unknown as PtSlab[]) ?? [],
  };
}

function labelFor(periodStart: Date): string {
  return periodStart.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' });
}

/** This store's pay period for a given month, from its own configured cycle start day - never a hard-coded calendar month. */
export async function payrollPeriodFor(
  storeId: string, year: number, monthIndex: number,
): Promise<{ periodStart: Date; periodEnd: Date; label: string }> {
  const policy = await attendancePolicy(storeId);
  const period = payPeriodsForYear(year, policy.payrollCycleStartDay)[monthIndex];
  if (!period) throw new PayrollRunError('That month is out of range.');
  return { periodStart: period.start, periodEnd: period.end, label: labelFor(period.start) };
}

/**
 * The pay period a given moment actually falls INSIDE - not the period whose
 * label matches the calendar month `now` is in.
 *
 * With a cycle start day other than 1 (e.g. the 21st), a date early in a
 * calendar month - the 19th, say - sits in the period that STARTED the
 * previous month and hasn't ended yet, not the period about to start two
 * days later. `cycleIndexForDate` already knows this; the one extra case it
 * hands back is `-1` for a January date before the start day, meaning the
 * period actually began in December of the PREVIOUS year - the one point
 * `payPeriodsForYear`'s per-year indexing doesn't reach on its own.
 */
export async function currentPayrollPeriod(
  storeId: string, now: Date = new Date(),
): Promise<{ periodStart: Date; periodEnd: Date; label: string }> {
  const policy = await attendancePolicy(storeId);
  // India's date, not the server's - on the UTC server the new period began
  // at 05:30 on its start day (9 Oct 2026).
  const today = istWall(now);
  const cycleIndex = cycleIndexForDate(today, policy.payrollCycleStartDay);

  const period = cycleIndex === -1
    ? payPeriodsForYear(today.getFullYear() - 1, policy.payrollCycleStartDay)[11]
    : payPeriodsForYear(today.getFullYear(), policy.payrollCycleStartDay)[cycleIndex];

  if (!period) throw new PayrollRunError('Could not resolve the current pay period.');
  return { periodStart: period.start, periodEnd: period.end, label: labelFor(period.start) };
}

export interface GeneratedPayslipSummary {
  userId: string;
  fullName: string;
  workingDays: number;
  paidDays: number;
  lopDays: number;
  grossPaise: number;
  totalDeductionsPaise: number;
  netPaise: number;
}

export async function generatePayrollRun(
  scope: StoreScope,
  periodStart: Date,
  periodEnd: Date,
  userId: string,
): Promise<{ runId: string; payslips: GeneratedPayslipSummary[] }> {
  const storeId = scopeForWrite(scope);

  const existing = await db.payrollRun.findUnique({ where: { storeId_periodStart: { storeId, periodStart } } });
  if (existing?.locked) {
    throw new PayrollRunError('This payroll run is locked - nothing in it can be regenerated.');
  }

  /*
    The period's days as India days (lib/attendance-day). A period is stored at
    the server's midnight - UTC midnight on the live site - which `storedDay`
    reads as the same day either way. Holidays and leave are looked up wide
    enough to catch a day saved at UTC midnight or at midnight India time; a
    holiday saved the India way on the period's first day used to fall out.
  */
  const dayKeys = eachDay(storedDay(periodStart), storedDay(periodEnd));
  const periodStored = storedBounds(dayKeys[0], dayKeys[dayKeys.length - 1]);

  const [policy, config, contractRows, holidayRows] = await Promise.all([
    attendancePolicy(storeId),
    loadPayrollConfig(storeId),
    db.salaryContract.findMany({
      where: {
        storeId, isActive: true,
        effectiveFrom: { lte: periodEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: periodStart } }],
      },
      include: {
        components: { orderBy: { sort: 'asc' }, include: { conditions: true } },
        user: { select: { id: true, fullName: true, userCode: true, isActive: true } },
      },
    }),
    db.holiday.findMany({ where: { storeId, date: periodStored }, select: { date: true } }),
  ]);

  // One contract per employee for this run - the most recently effective one,
  // if data ever ends up with two overlapping (a correction that should have
  // closed the old one first). Silently picking the newest is safer than
  // crashing the whole run over one person's bad row, and it is what a human
  // resolving the same clash by eye would also pick.
  const contractByUser = new Map<string, (typeof contractRows)[number]>();
  for (const c of contractRows) {
    if (!c.user.isActive) continue;
    const current = contractByUser.get(c.userId);
    if (!current || c.effectiveFrom > current.effectiveFrom) contractByUser.set(c.userId, c);
  }
  const contracts = [...contractByUser.values()];
  if (contracts.length === 0) {
    throw new PayrollRunError('No employee has an active salary contract covering this period.');
  }

  const userIds = contracts.map((c) => c.userId);
  const holidaySet = new Set(holidayRows.map((h) => storedDay(h.date)));
  const weekOffSet = new Set(policy.weekOffDays);

  const [attendanceRows, leaveRows, loanRows, taxDeclarationRows] = await Promise.all([
    db.attendanceDay.findMany({
      where: { storeId, userId: { in: userIds }, workDate: { gte: dayKeys[0], lte: dayKeys[dayKeys.length - 1] } },
      select: { userId: true, workDate: true, workedMinutes: true },
    }),
    db.leaveRequest.findMany({
      where: {
        storeId, userId: { in: userIds }, status: 'approved',
        fromDate: { lte: periodStored.lte }, toDate: { gte: periodStored.gte },
      },
      select: { userId: true, fromDate: true, toDate: true, kind: true, leaveType: { select: { paidPercentage: true } } },
    }),
    db.staffLoan.findMany({
      where: { storeId, userId: { in: userIds }, status: 'active', startPeriod: { lte: periodStart } },
      // Oldest loan first, and the same order at process time, so the
      // payslip's deduction and the repayments written against it agree.
      orderBy: [{ startPeriod: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, userId: true, emiPaise: true, principalPaise: true,
        // Skips what a reverted run gave back - see `revertPayrollRun`.
        repayments: { where: { deletedAt: null }, select: { amountPaise: true } },
      },
    }),
    // Old-regime TDS only - see calculateMonthlyTDS. Only a VERIFIED
    // declaration counts; an unverified or missing one means 0 here, the
    // "revert to higher TDS if proof never arrives" rule from §4.5.
    db.incomeTaxDeclaration.findMany({
      where: {
        storeId, userId: { in: userIds },
        financialYear: getFinancialYear(periodStart), proofStatus: 'verified',
      },
      select: { userId: true, totalDeclaredPaise: true },
    }),
  ]);
  const declaredDeductionByUser = new Map(taxDeclarationRows.map((d) => [d.userId, d.totalDeclaredPaise]));

  // Each contract-holder's own assigned shift, if they have one - the
  // bridge closing the gap the Work Schedules slice deliberately left
  // open. See `lib/shift-schedule.ts`'s `effectiveDayPolicy`: same
  // resolution `attendanceMonth` (server/attendance.ts) uses, so a shift
  // assignment changes what the Grid and payroll agree on together, never
  // just one of them.
  const scheduleByUser = await getShiftScheduleByUser(userIds);

  const attendanceByUser = new Map<string, Map<string, number | null>>();
  for (const a of attendanceRows) {
    if (!attendanceByUser.has(a.userId)) attendanceByUser.set(a.userId, new Map());
    attendanceByUser.get(a.userId)!.set(a.workDate, a.workedMinutes);
  }

  const leaveByUser = new Map<string, Map<string, { kind: 'leave' | 'wfh' | 'half_day'; paidPercentage?: number }>>();
  for (const l of leaveRows) {
    if (!leaveByUser.has(l.userId)) leaveByUser.set(l.userId, new Map());
    const perDay = leaveByUser.get(l.userId)!;
    for (const key of storedDays(l.fromDate, l.toDate)) {
      if (key < dayKeys[0] || key > dayKeys[dayKeys.length - 1]) continue;
      perDay.set(key, { kind: l.kind as 'leave' | 'wfh' | 'half_day', paidPercentage: l.leaveType?.paidPercentage });
    }
  }

  // Every active loan is collected, each one capped at what is still
  // outstanding on it - `lib/loan-emi.ts`.
  //
  // Until 5 Oct 2026 this took the first active loan's full EMI and nothing
  // else: a second loan was silently skipped, the last installment was not
  // capped at the remainder, and - because processing never recorded a
  // repayment - a loan that had been paid back in full kept having its EMI
  // cut every single month (G-03). The cap is what stops that even if a
  // loan is left `active` by hand.
  const loansByUser = new Map<string, typeof loanRows>();
  for (const loan of loanRows) {
    const mine = loansByUser.get(loan.userId) ?? [];
    mine.push(loan);
    loansByUser.set(loan.userId, mine);
  }

  // What to take off plain advances this month (G-19). OFF unless the store
  // switched it on, so nobody's pay changes by surprise. The outstanding
  // figure comes from `recoverableAdvances` - the same function the Staff
  // Balance screen uses, so payroll and that screen can never disagree about
  // what somebody owes. Loans are excluded there; they have their own line.
  const recovery = await loadAdvanceRecovery(storeId);
  const advanceDueByUser = new Map<string, { duePaise: number; label: string }>();
  if (recovery.enabled) {
    const owed = await recoverableAdvances(scope, userIds);
    for (const [holderId, outstandingPaise] of owed) {
      const duePaise = recovery.maxPaise > 0 ? Math.min(outstandingPaise, recovery.maxPaise) : outstandingPaise;
      if (duePaise <= 0) continue;
      const leftPaise = outstandingPaise - duePaise;
      advanceDueByUser.set(holderId, {
        duePaise,
        label: leftPaise === 0
          ? 'Advance recovery - nothing left after this month'
          : `Advance recovery - ${formatCurrency(leftPaise)} left after this month`,
      });
    }
  }

  const loanEmiByUser = new Map<string, LoanEmiDue>();
  for (const [holderId, loans] of loansByUser) {
    const due = dueLoanEmi(loans.map((l) => ({
      id: l.id,
      emiPaise: l.emiPaise,
      principalPaise: l.principalPaise,
      repaidPaise: l.repayments.reduce((sum, r) => sum + r.amountPaise, 0),
    })));
    if (due.totalPaise > 0) loanEmiByUser.set(holderId, due);
  }

  // Achieved sales per employee, for any `percent_of_sales` component -
  // fetched ONCE for every employee who might need it, not per-component,
  // per-employee. Same predicate `server/targets.ts` already uses for the
  // Sales Target report's own incentive figure - one answer to "what counts
  // as a sale", never two that could quietly disagree.
  const needsSalesFigure = contracts.some((c) => c.components.some((x) => x.calcType === 'percent_of_sales'));
  const achievedSalesByUser = new Map<string, number>();
  if (needsSalesFigure) {
    const orders = await db.salesOrder.findMany({
      where: { storeId, orderDate: { gte: periodStart, lte: periodEnd }, ...REVENUE_ORDER_WHERE },
      select: { salespersonId: true, grandTotalPaise: true },
    });
    for (const o of orders) {
      if (!o.salespersonId) continue;
      achievedSalesByUser.set(o.salespersonId, (achievedSalesByUser.get(o.salespersonId) ?? 0) + o.grandTotalPaise);
    }
  }

  // Employment type (for component targeting, §3.3) and bank details (for
  // the payslip document) - one batched fetch, not per-contract.
  const profileRows = await db.employeeProfile.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, employmentType: true, bankAccountNumber: true },
  });
  const profileByUser = new Map(profileRows.map((p) => [p.userId, p]));

  // Designation for the payslip document - the same "Team Setup assignment
  // first, most senior permission role otherwise" resolution `hierarchy.ts`'s
  // `orgChart` already uses, scoped to just this run's employees instead of
  // the whole organisation.
  const designationRows = await db.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      department: { select: { name: true } },
      storeRoles: { select: { role: { select: { level: true, designationCode: true } } } },
      reportingAssignments: {
        where: { effectiveTo: null }, take: 1,
        select: { designationRole: { select: { level: true, designationCode: true } } },
      },
    },
  });
  const designationByUser = new Map<string, string | null>();
  const departmentByUser = new Map<string, string | null>();
  for (const u of designationRows) {
    const assigned = u.reportingAssignments[0]?.designationRole;
    const leveled = assigned ?? u.storeRoles
      .map((r) => r.role)
      .filter((r): r is typeof r & { level: number } => r.level !== null)
      .sort((a, b) => a.level - b.level)[0];
    designationByUser.set(u.id, leveled?.designationCode ?? null);
    departmentByUser.set(u.id, u.department?.name ?? null);
  }

  interface BuiltPayslip {
    userId: string; employeeName: string; employeeCode: string;
    designation: string | null; bankAccountNumber: string | null; department: string | null;
    workingDays: number; paidDays: number; lopDays: number;
    grossPaise: number; totalDeductionsPaise: number; netPaise: number;
    lines: { kind: string; code: string; label: string; amountPaise: number; sort: number }[];
  }

  const built: BuiltPayslip[] = contracts.map((contract) => {
    const attMap = attendanceByUser.get(contract.userId) ?? new Map<string, number | null>();
    const leaveMap = leaveByUser.get(contract.userId) ?? new Map();

    const shiftSchedule = scheduleByUser.get(contract.userId) ?? null;

    const dayInputs: PayrollDayInput[] = dayKeys.map((key) => {
      const effective = effectiveDayPolicy(shiftSchedule, weekdayOf(key), {
        shiftStart: policy.shiftStart, shiftEnd: policy.shiftEnd, fullDayMinutes: policy.fullDayMinutes,
        isWeeklyOffByDefault: weekOffSet.has(weekdayOf(key)),
      });
      return {
        workDate: key,
        isWeeklyOff: effective.isScheduledOff,
        isHoliday: holidaySet.has(key),
        workedMinutes: attMap.get(key) ?? null,
        leave: leaveMap.get(key) ?? null,
        fullDayMinutes: effective.fullDayMinutes,
      };
    });

    const { workingDays, paidDays, lopDays } = summarizePayrollDays(dayInputs, policy.fullDayMinutes, policy.halfDayMinutes);
    const presentDays = countPresentDays(dayInputs);
    const overtimeMinutes = summarizeOvertimeMinutes(dayInputs, policy.fullDayMinutes, policy.overtimeMinMinutes);
    const achievedSalesPaise = achievedSalesByUser.get(contract.userId) ?? 0;

    const conditionContext = {
      contractType: contract.contractType,
      employmentType: profileByUser.get(contract.userId)?.employmentType ?? null,
    };

    // Skip a component entirely - not a ₹0 line - when it doesn't apply to
    // this employee (§3.3 targeting) or isn't due this period (a one-off
    // component whose date falls in a different run).
    const eligible = contract.components.filter((c) => (
      passesComponentConditions(c.conditions, conditionContext)
      && isOneTimeComponentDue(c.oneTimePeriodStart, periodStart, periodEnd)
    ));

    const basicPaise = eligible.find((c) => c.code === 'BASIC')?.monthlyPaise ?? 0;

    // Pass 1 - everything except `percent_of_gross`, which needs pass 1's
    // total as its own basis (see the schema note on `SalaryComponent`).
    const resolved = new Map<string, { label: string; paise: number }>();
    for (const c of eligible) {
      if (c.calcType === 'percent_of_gross') continue;
      const ratePct = c.ratePct?.toNumber() ?? 0;
      const unitRatePaise = c.unitRatePaise ?? 0;

      if (c.calcType === 'fixed') {
        resolved.set(c.code, { label: c.label, paise: c.monthlyPaise ?? 0 });
      } else if (c.calcType === 'percent_of_sales') {
        const capNote = c.capPaise !== null ? `, capped at ${formatCurrency(c.capPaise)}` : '';
        resolved.set(c.code, {
          label: `${c.label} (${ratePct}% of ${formatCurrency(achievedSalesPaise)} sales${capNote})`,
          paise: resolvePercentOfSalesPaise(achievedSalesPaise, ratePct, c.capPaise),
        });
      } else if (c.calcType === 'percent_of_basic') {
        const capNote = c.capPaise !== null ? `, capped at ${formatCurrency(c.capPaise)}` : '';
        resolved.set(c.code, {
          label: `${c.label} (${ratePct}% of basic${capNote})`,
          paise: applyCap(resolvePercentPaise(basicPaise, ratePct), c.capPaise),
        });
      } else if (c.calcType === 'per_attendance_day') {
        resolved.set(c.code, {
          label: `${c.label} (${formatCurrency(unitRatePaise)} × ${presentDays} day${presentDays === 1 ? '' : 's'} attended)`,
          paise: applyCap(resolvePerAttendanceDayPaise(presentDays, unitRatePaise), c.capPaise),
        });
      } else if (c.calcType === 'per_overtime_hour') {
        const bucketMinutes = c.overtimeKind === 'holiday' ? overtimeMinutes.holiday
          : c.overtimeKind === 'week_off' ? overtimeMinutes.weekOff
          : overtimeMinutes.regular;
        const hours = Math.round((bucketMinutes / 60) * 10) / 10;
        resolved.set(c.code, {
          label: `${c.label} (${formatCurrency(unitRatePaise)} × ${hours}h ${(c.overtimeKind ?? 'regular').replace('_', ' ')} overtime)`,
          paise: applyCap(resolvePerOvertimeHourPaise(bucketMinutes, unitRatePaise), c.capPaise),
        });
      }
    }

    // Pass 2 - `percent_of_gross`, against pass 1's total (everything else
    // this contract carries, excluding other percent_of_gross components -
    // avoids the circularity of "gross" including itself).
    const grossBeforeGrossPercent = [...resolved.values()].reduce((n, r) => n + r.paise, 0);
    for (const c of eligible) {
      if (c.calcType !== 'percent_of_gross') continue;
      const ratePct = c.ratePct?.toNumber() ?? 0;
      const capNote = c.capPaise !== null ? `, capped at ${formatCurrency(c.capPaise)}` : '';
      resolved.set(c.code, {
        label: `${c.label} (${ratePct}% of gross${capNote})`,
        paise: applyCap(resolvePercentPaise(grossBeforeGrossPercent, ratePct), c.capPaise),
      });
    }

    const components: PayslipComponentInput[] = eligible.map((c) => ({
      code: c.code,
      label: resolved.get(c.code)!.label,
      monthlyPaise: resolved.get(c.code)!.paise,
    }));

    // The employer-matched half of a contribution - informational only,
    // computed off each component's own resolved amount, never deducted
    // from the employee and never posted to the ledger (same choice
    // `processPayrollRun` already makes for employer-side PF/ESIC).
    const employerContributionLines: PayslipLineResult[] = eligible
      .filter((c) => c.employerRatePct !== null)
      .map((c) => {
        const basisPaise = resolved.get(c.code)!.paise;
        const ratePct = c.employerRatePct!.toNumber();
        return {
          kind: 'employer_contribution' as const,
          code: `${c.code}_EMPLOYER`,
          label: `${c.label} - employer contribution (${ratePct}%)`,
          amountPaise: resolveEmployerContributionPaise(basisPaise, ratePct),
        };
      });

    const loanEmi = loanEmiByUser.get(contract.userId);
    const advanceDue = advanceDueByUser.get(contract.userId);

    const computed = computePayslip({
      components, workingDays, paidDays, lopDays,
      pfApplicable: contract.pfApplicable,
      esicApplicable: contract.esicApplicable,
      ptApplicable: contract.ptApplicable,
      taxRegime: contract.taxRegime,
      payrollConfig: config,
      loanEmiPaise: loanEmi?.totalPaise,
      loanEmiLabel: loanEmi?.label,
      advanceRecoveryPaise: advanceDue?.duePaise,
      advanceRecoveryLabel: advanceDue?.label,
      annualDeclaredDeductionPaise: declaredDeductionByUser.get(contract.userId) ?? 0,
    });

    const allLines = [...computed.lines, ...employerContributionLines];

    return {
      userId: contract.userId,
      employeeName: contract.user.fullName,
      employeeCode: contract.user.userCode,
      designation: designationByUser.get(contract.userId) ?? null,
      bankAccountNumber: profileByUser.get(contract.userId)?.bankAccountNumber ?? null,
      department: departmentByUser.get(contract.userId) ?? null,
      workingDays, paidDays, lopDays,
      grossPaise: computed.grossPaise,
      totalDeductionsPaise: computed.totalDeductionsPaise,
      netPaise: computed.netPaise,
      lines: allLines.map((l, idx) => ({ kind: l.kind, code: l.code, label: l.label, amountPaise: l.amountPaise, sort: idx })),
    };
  });

  const label = labelFor(periodStart);

  const runId = await db.$transaction(async (tx) => {
    const run = await tx.payrollRun.upsert({
      where: { storeId_periodStart: { storeId, periodStart } },
      create: { storeId, periodStart, periodEnd, label, createdBy: userId },
      update: { periodEnd, label },
    });

    await tx.payslip.deleteMany({ where: { payrollRunId: run.id } });

    for (const p of built) {
      await tx.payslip.create({
        data: {
          storeId, payrollRunId: run.id, userId: p.userId,
          employeeName: p.employeeName, employeeCode: p.employeeCode,
          designation: p.designation, bankAccountNumber: p.bankAccountNumber, department: p.department,
          workingDays: p.workingDays, paidDays: p.paidDays, lopDays: p.lopDays,
          grossPaise: p.grossPaise, totalDeductionsPaise: p.totalDeductionsPaise, netPaise: p.netPaise,
          lines: { createMany: { data: p.lines } },
        },
      });
    }

    return run.id;
  });

  return {
    runId,
    payslips: built.map((p) => ({
      userId: p.userId, fullName: p.employeeName,
      workingDays: p.workingDays, paidDays: p.paidDays, lopDays: p.lopDays,
      grossPaise: p.grossPaise, totalDeductionsPaise: p.totalDeductionsPaise, netPaise: p.netPaise,
    })),
  };
}

export interface PayrollRunRow {
  id: string;
  label: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  locked: boolean;
  employeeCount: number;
  grossPaise: number;
  netPaise: number;
  /** Set if this run was taken back to draft after being processed. */
  revertedAt: Date | null;
  revertReason: string | null;
}

export async function listPayrollRuns(scope: StoreScope): Promise<PayrollRunRow[]> {
  const storeId = scopeForWrite(scope);
  const runs = await db.payrollRun.findMany({
    where: { storeId },
    orderBy: { periodStart: 'desc' },
    include: { payslips: { select: { grossPaise: true, netPaise: true } } },
  });
  return runs.map((r) => ({
    id: r.id, label: r.label, periodStart: r.periodStart, periodEnd: r.periodEnd,
    status: r.status, locked: r.locked,
    employeeCount: r.payslips.length,
    grossPaise: r.payslips.reduce((n, p) => n + p.grossPaise, 0),
    netPaise: r.payslips.reduce((n, p) => n + p.netPaise, 0),
    revertedAt: r.revertedAt, revertReason: r.revertReason,
  }));
}

export interface PayslipDetail {
  id: string;
  userId: string;
  employeeName: string;
  employeeCode: string;
  workingDays: number;
  paidDays: string;
  lopDays: string;
  grossPaise: number;
  totalDeductionsPaise: number;
  netPaise: number;
  lines: { kind: string; code: string; label: string; amountPaise: number }[];
}

export async function getPayrollRunDetail(
  scope: StoreScope, runId: string,
): Promise<{ run: PayrollRunRow; payslips: PayslipDetail[] } | null> {
  const storeId = scopeForWrite(scope);
  const run = await db.payrollRun.findFirst({
    where: { id: runId, storeId },
    include: {
      payslips: {
        orderBy: { employeeName: 'asc' },
        include: { lines: { orderBy: { sort: 'asc' } } },
      },
    },
  });
  if (!run) return null;

  return {
    run: {
      id: run.id, label: run.label, periodStart: run.periodStart, periodEnd: run.periodEnd,
      status: run.status, locked: run.locked,
      employeeCount: run.payslips.length,
      grossPaise: run.payslips.reduce((n, p) => n + p.grossPaise, 0),
      netPaise: run.payslips.reduce((n, p) => n + p.netPaise, 0),
      revertedAt: run.revertedAt, revertReason: run.revertReason,
    },
    payslips: run.payslips.map((p) => ({
      id: p.id, userId: p.userId, employeeName: p.employeeName, employeeCode: p.employeeCode,
      workingDays: p.workingDays, paidDays: p.paidDays.toString(), lopDays: p.lopDays.toString(),
      grossPaise: p.grossPaise, totalDeductionsPaise: p.totalDeductionsPaise, netPaise: p.netPaise,
      lines: p.lines.map((l) => ({ kind: l.kind, code: l.code, label: l.label, amountPaise: l.amountPaise })),
    })),
  };
}

// ------------------------------------------------------- process, then pay
//
// Two separate postings, the same "raise a liability, then clear it" shape
// as invoice/receipt or purchase-bill/supplier-payment.
//
//   PROCESS (draft -> processed): the accrual entry. Wages are expensed,
//   statutory withholdings and any loan EMI become liabilities/asset
//   reductions, and what's left is what the business now OWES its staff -
//   Staff Payable, not cash yet. This also LOCKS the run: `generatePayrollRun`
//   already refuses a locked run, because regenerating after a real GL
//   posting would leave that posting describing payslips that no longer
//   exist. There is no separate "lock" action - processing an aggregate,
//   ledger-backed batch this way, once, IS the lock.
//
//   PAY (processed -> paid): the clearing entry, once money actually leaves
//   the bank - Staff Payable debited back to zero, cash or bank credited.
//
// LOP NEVER APPEARS ON EITHER SIDE OF THE ACCRUAL ENTRY
//
// It is not owed to anyone, so it is not a liability - it simply means less
// wage expense was earned in the first place. Debiting Salaries & Wages with
// gross MINUS the LOP lines, then crediting every other deduction plus net
// pay, balances by construction: net is already defined as gross minus every
// deduction including LOP, so crediting all of them except LOP is
// arithmetically identical to gross minus LOP. See the code comment inline.
//
// EMPLOYER-SIDE PF/ESIC IS NOT POSTED HERE
//
// `payroll-statutory.ts` computes an employer contribution figure, but
// `computePayslip` never turns it into a payslip line - it is not withheld
// from anyone's pay, so it never reaches a Payslip or PayslipLine. Posting
// it as an additional employer cost is real, correct, and NOT done here -
// this entry only reflects money that moved through an actual payslip line.

const DEDUCTION_LIABILITY_ACCOUNT: Record<string, string> = {
  PF: '2310',
  ESIC: '2320',
  PT: '2330',
  TDS: '2340',
  LOAN_EMI: '1400', // an asset (Staff Advances), not a liability - a loan recovery reduces what staff owe the company, it does not create a new payable.
  ADVANCE: '1400', // the same, for a plain advance with no loan schedule (G-19).
};

/**
 * WHICH LOAN EACH PAYSLIP'S `LOAN_EMI` DEDUCTION IS ACTUALLY PAYING OFF.
 *
 * The payslip carries one `LOAN_EMI` line, not one per loan, so the split is
 * resolved here from what is outstanding right now, in the same
 * oldest-first order `generatePayrollRun` used. Resolved BEFORE the ledger
 * entry is posted: a deduction the loans can no longer absorb - somebody
 * settled the loan by hand after this draft was generated - means the run is
 * stale, and a stale run must be regenerated rather than posted and the
 * difference quietly lost.
 *
 * NO `StaffTransaction` IS CREATED FOR THESE
 *
 * A repayment entered by hand goes through `createStaffTransaction`
 * (`advance_repaid`: Dr cash / Cr 1400) because cash really arrives. A
 * payslip deduction is not cash - nothing is handed over, the employee's net
 * pay is simply smaller - and the payroll accrual entry below already
 * credits 1400 for the whole `LOAN_EMI` total. Posting an `advance_repaid`
 * on top would credit 1400 twice and debit a till that never opened. So the
 * repayment row stands on its `payslipId`, exactly as `StaffLoanRepayment`
 * was designed ("deducted on a payslip (`payslipId` set), or off-cycle by
 * hand"), and `staff-accounts.ts` counts both kinds when it answers who owes
 * what.
 */
interface PayslipLoanRepayment {
  loanId: string;
  payslipId: string;
  amountPaise: number;
  /** This repayment finishes the loan, so processing closes it. */
  closes: boolean;
}

async function resolvePayslipLoanRepayments(
  storeId: string,
  periodStart: Date,
  payslips: { id: string; userId: string; employeeName: string; lines: { kind: string; code: string; amountPaise: number }[] }[],
): Promise<PayslipLoanRepayment[]> {
  const deductedByPayslip = payslips
    .map((p) => ({
      payslipId: p.id,
      userId: p.userId,
      employeeName: p.employeeName,
      amountPaise: p.lines
        .filter((l) => l.kind === 'deduction' && l.code === 'LOAN_EMI')
        .reduce((sum, l) => sum + l.amountPaise, 0),
    }))
    .filter((p) => p.amountPaise > 0);

  if (deductedByPayslip.length === 0) return [];

  const loanRows = await db.staffLoan.findMany({
    // Exactly the loans `generatePayrollRun` deducted against - a loan that
    // starts after this period is not collected by it.
    where: {
      storeId, userId: { in: deductedByPayslip.map((p) => p.userId) },
      status: 'active', startPeriod: { lte: periodStart },
    },
    orderBy: [{ startPeriod: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, userId: true, emiPaise: true, principalPaise: true,
      // Skips what a reverted run gave back - see `revertPayrollRun`.
        repayments: { where: { deletedAt: null }, select: { amountPaise: true } },
    },
  });

  const repayments: PayslipLoanRepayment[] = [];

  for (const p of deductedByPayslip) {
    const due = dueLoanEmi(
      loanRows
        .filter((l) => l.userId === p.userId)
        .map((l) => ({
          id: l.id,
          emiPaise: l.emiPaise,
          principalPaise: l.principalPaise,
          repaidPaise: l.repayments.reduce((sum, r) => sum + r.amountPaise, 0),
        })),
    );

    if (p.amountPaise > due.totalPaise) {
      throw new PayrollRunError(
        `${p.employeeName}'s payslip deducts ${formatCurrency(p.amountPaise)} of loan EMI, but only `
        + `${formatCurrency(due.totalPaise)} is still outstanding. Regenerate this run before processing it.`,
      );
    }

    // The deduction is spread oldest loan first. Normally it equals the sum
    // of the shares exactly; it can be smaller if a loan was partly settled
    // by hand since this draft was generated.
    let left = p.amountPaise;
    for (const share of due.shares) {
      if (left <= 0) break;
      const amountPaise = Math.min(left, share.duePaise);
      const remaining = share.duePaise + share.balanceAfterPaise;
      repayments.push({
        loanId: share.loanId,
        payslipId: p.payslipId,
        amountPaise,
        closes: amountPaise >= remaining,
      });
      left -= amountPaise;
    }
  }

  return repayments;
}

export async function processPayrollRun(scope: StoreScope, runId: string, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);

  const run = await db.payrollRun.findFirst({
    where: { id: runId, storeId },
    include: { payslips: { include: { lines: true } } },
  });
  if (!run) throw new PayrollRunError('Payroll run not found in your scope.');
  if (run.status !== 'draft') throw new PayrollRunError(`This run is already ${run.status}.`);
  if (run.payslips.length === 0) throw new PayrollRunError('This run has no payslips to process.');

  // Resolved first: it validates the run against today's loan balances and
  // refuses a stale one before anything is posted.
  const loanRepayments = await resolvePayslipLoanRepayments(storeId, run.periodStart, run.payslips);

  const deductionTotals = new Map<string, number>();
  let totalGross = 0;
  let totalLop = 0;
  let totalNet = 0;

  for (const p of run.payslips) {
    totalGross += p.grossPaise;
    totalNet += p.netPaise;
    for (const line of p.lines) {
      if (line.kind !== 'deduction') continue;
      if (line.code === 'LOP') { totalLop += line.amountPaise; continue; }
      deductionTotals.set(line.code, (deductionTotals.get(line.code) ?? 0) + line.amountPaise);
    }
  }

  const lines: LedgerLineInput[] = [
    { accountCode: '5300', debitPaise: totalGross - totalLop, description: `Payroll - ${run.label}` },
  ];
  for (const [code, amountPaise] of deductionTotals) {
    const accountCode = DEDUCTION_LIABILITY_ACCOUNT[code];
    if (!accountCode || amountPaise <= 0) continue;
    lines.push({ accountCode, creditPaise: amountPaise });
  }
  lines.push({ accountCode: '2300', creditPaise: totalNet, description: `Net pay owed - ${run.payslips.length} employee${run.payslips.length === 1 ? '' : 's'}` });

  await postJournalEntry(scope, {
    entryDate: run.periodEnd,
    description: `Payroll - ${run.label} (${run.payslips.length} employee${run.payslips.length === 1 ? '' : 's'})`,
    sourceType: 'payroll_run',
    sourceId: run.id,
    lines,
  }, userId);

  // The EMI the payslips deducted now actually comes off the loans. One
  // transaction with the status change: a processed run whose repayments
  // were not written is the bug this replaced.
  await db.$transaction(async (tx) => {
    for (const r of loanRepayments) {
      await tx.staffLoanRepayment.create({
        data: { loanId: r.loanId, payslipId: r.payslipId, amountPaise: r.amountPaise },
      });
      if (r.closes) {
        await tx.staffLoan.update({ where: { id: r.loanId }, data: { status: 'closed' } });
      }
    }

    await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: 'processed', processedAt: new Date(), processedBy: userId,
        locked: true, lockedAt: new Date(), lockedBy: userId,
      },
    });
  });
}

/**
 * TAKE A PROCESSED RUN BACK TO DRAFT (8 Oct 2026).
 *
 * Processing a run was one-way: it posted the accrual entry and locked the
 * run, and `generatePayrollRun` refuses a locked run. So a mistake found
 * afterwards - an attendance day fixed, a component corrected, somebody left
 * out - could not be corrected at all. On a live month that is not an
 * inconvenience, it is a wrong payslip nobody can fix.
 *
 * Three things have to be undone together, and in this order:
 *
 *   1. THE LEDGER, by reversal and never by deletion. A posted entry stays
 *      posted; a mirror entry cancels it. `reverseJournalEntry` dates the
 *      reversal TODAY and refuses if today's period is closed, which is
 *      correct accounting: reverting September in October leaves September's
 *      original entry standing and the correction in October.
 *   2. THE LOAN REPAYMENTS this run collected. Without this the EMI is
 *      collected twice - once by the reverted run and once by its
 *      replacement - which is exactly the bug `dueLoanEmi` exists to prevent,
 *      arriving by a different door. A loan this run closed is reopened if
 *      money is owed on it again.
 *   3. THE RUN ITSELF, back to `draft` and unlocked, with the reason kept.
 *
 * NOT undone: nothing. The payslips stay until `generatePayrollRun` rebuilds
 * them wholesale, so a reverted run still shows what it said while somebody
 * works out what was wrong with it.
 *
 * REBUILDING AFTER A REVERT needs the run's own month open: `generatePayrollRun`
 * posts nothing, but re-processing posts dated `periodEnd`, and the ledger
 * refuses a closed period. If the month was closed, reopen it first
 * (Accounts > Close the Books - itself an approvable action).
 */
export async function revertPayrollRun(
  scope: StoreScope, runId: string, reason: string, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!reason.trim()) throw new PayrollRunError('Say why this run is being taken back.');

  const run = await db.payrollRun.findFirst({
    where: { id: runId, storeId },
    include: { payslips: { select: { id: true } } },
  });
  if (!run) throw new PayrollRunError('Payroll run not found in your scope.');
  if (run.status === 'draft') throw new PayrollRunError('This run is still a draft - edit it and generate it again.');
  if (run.status !== 'processed' && run.status !== 'paid') {
    throw new PayrollRunError(`A ${run.status} run cannot be taken back.`);
  }

  // The payment entry first, then the accrual - the opposite order to the one
  // that created them, so the books are never left showing cash paid against
  // wages that no longer exist.
  for (const sourceType of ['payroll_payment', 'payroll_run'] as const) {
    const entry = await db.journalEntry.findFirst({
      where: { storeId, sourceType, sourceId: run.id, reversalOfId: null },
      select: { id: true },
    });
    if (entry) {
      await reverseJournalEntry(scope, entry.id, userId, `Payroll ${run.label} taken back: ${reason.trim()}`);
    }
  }

  const payslipIds = run.payslips.map((p) => p.id);
  const repayments = payslipIds.length > 0
    ? await db.staffLoanRepayment.findMany({
      where: { payslipId: { in: payslipIds } },
      select: { id: true, loanId: true, amountPaise: true },
    })
    : [];
  const loanIds = [...new Set(repayments.map((r) => r.loanId))];
  const loans = loanIds.length > 0
    ? await db.staffLoan.findMany({
      where: { id: { in: loanIds } },
      select: {
        id: true, principalPaise: true, status: true,
        repayments: { where: { deletedAt: null }, select: { id: true, amountPaise: true } },
      },
    })
    : [];

  await db.$transaction(async (tx) => {
    // TOMBSTONED, NOT DELETED (AGENTS.md: nothing is removed without a name
    // against it). `StaffLoanRepayment` is in the `ledger` sync class, where a
    // hard delete cannot be told apart from a row that has not synced yet - the
    // hub would either resurrect it or delete rows it has never seen. Every read
    // of a loan's repayments filters `deletedAt: null`.
    if (repayments.length > 0) {
      await tx.staffLoanRepayment.updateMany({
        where: { id: { in: repayments.map((r) => r.id) } },
        data: { deletedAt: new Date(), deletedBy: userId },
      });
    }

    // A loan this run finished off owes money again once its repayment is
    // gone, so it goes back to `active` and the rebuilt run collects it.
    const removed = new Set(repayments.map((r) => r.id));
    for (const loan of loans) {
      const left = loan.principalPaise
        - loan.repayments.filter((r) => !removed.has(r.id)).reduce((n, r) => n + r.amountPaise, 0);
      if (loan.status === 'closed' && left > 0) {
        await tx.staffLoan.update({ where: { id: loan.id }, data: { status: 'active' } });
      }
    }

    await tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: 'draft',
        processedAt: null, processedBy: null,
        paidAt: null, paidBy: null,
        locked: false, lockedAt: null, lockedBy: null,
        revertedAt: new Date(), revertedBy: userId, revertReason: reason.trim(),
      },
    });
  });
}

const PAY_CASH_ACCOUNT: Record<string, string> = {
  cash: '1010', bank: '1020', upi: '1020', cheque: '1020',
};

export async function markPayrollRunPaid(
  scope: StoreScope, runId: string, method: string, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);

  const run = await db.payrollRun.findFirst({
    where: { id: runId, storeId },
    include: { payslips: { select: { netPaise: true } } },
  });
  if (!run) throw new PayrollRunError('Payroll run not found in your scope.');
  if (run.status !== 'processed') {
    throw new PayrollRunError(
      run.status === 'draft' ? 'Process this run before marking it paid.' : `This run is already ${run.status}.`,
    );
  }

  const totalNet = run.payslips.reduce((n, p) => n + p.netPaise, 0);
  const cashAccount = PAY_CASH_ACCOUNT[method] ?? '1010';

  await postJournalEntry(scope, {
    entryDate: new Date(),
    description: `Payroll paid - ${run.label} (${run.payslips.length} employee${run.payslips.length === 1 ? '' : 's'})`,
    sourceType: 'payroll_payment',
    sourceId: run.id,
    lines: [
      { accountCode: '2300', debitPaise: totalNet },
      { accountCode: cashAccount, creditPaise: totalNet },
    ],
  }, userId);

  await db.payrollRun.update({
    where: { id: run.id },
    data: { status: 'paid', paidAt: new Date(), paidBy: userId },
  });
}
