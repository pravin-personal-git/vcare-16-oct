import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { publicBrandUrl } from './storage';

export interface PayslipDocument {
  id: string;
  generatedAt: Date;
  paymentRef: string | null;

  org: { name: string; gstin: string | null; logoUrl: string | null };
  store: { name: string; address: string | null };
  run: { label: string; periodStart: Date; periodEnd: Date; status: string };

  employeeName: string;
  employeeCode: string;
  designation: string | null;
  department: string | null;
  bankAccountNumber: string | null;

  workingDays: number;
  paidDays: string;
  lopDays: string;

  grossPaise: number;
  totalDeductionsPaise: number;
  netPaise: number;

  earnings: { code: string; label: string; amountPaise: number }[];
  deductions: { code: string; label: string; amountPaise: number }[];
  employerContributions: { code: string; label: string; amountPaise: number }[];
}

/**
 * The single printable payslip - one employee, one period, frozen at
 * generation time. Read-only: nothing here can be edited from this page,
 * only regenerated (which replaces the whole run, see `payroll-run.ts`).
 */
export async function getPayslipDocument(
  scope: StoreScope, payslipId: string,
): Promise<PayslipDocument | null> {
  const slip = await db.payslip.findFirst({
    where: { id: payslipId, ...scopeWhere(scope) },
    include: {
      lines: { orderBy: { sort: 'asc' } },
      payrollRun: true,
      store: { include: { organization: true } },
    },
  });
  if (!slip) return null;

  return {
    id: slip.id,
    generatedAt: slip.generatedAt,
    paymentRef: slip.paymentRef,

    org: {
      name: slip.store.organization.name,
      gstin: slip.store.organization.gstin,
      logoUrl: publicBrandUrl(slip.store.organization.logoPath),
    },
    store: { name: slip.store.name, address: slip.store.address },
    run: {
      label: slip.payrollRun.label,
      periodStart: slip.payrollRun.periodStart,
      periodEnd: slip.payrollRun.periodEnd,
      status: slip.payrollRun.status,
    },

    employeeName: slip.employeeName,
    employeeCode: slip.employeeCode,
    designation: slip.designation,
    department: slip.department,
    bankAccountNumber: slip.bankAccountNumber,

    workingDays: slip.workingDays,
    paidDays: slip.paidDays.toString(),
    lopDays: slip.lopDays.toString(),

    grossPaise: slip.grossPaise,
    totalDeductionsPaise: slip.totalDeductionsPaise,
    netPaise: slip.netPaise,

    earnings: slip.lines.filter((l) => l.kind === 'earning')
      .map((l) => ({ code: l.code, label: l.label, amountPaise: l.amountPaise })),
    deductions: slip.lines.filter((l) => l.kind === 'deduction')
      .map((l) => ({ code: l.code, label: l.label, amountPaise: l.amountPaise })),
    employerContributions: slip.lines.filter((l) => l.kind === 'employer_contribution')
      .map((l) => ({ code: l.code, label: l.label, amountPaise: l.amountPaise })),
  };
}
