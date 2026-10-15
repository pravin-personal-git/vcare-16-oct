import 'server-only';
import { db } from './db';
import { myMonth } from './my-attendance';
import { istYearMonth } from '@/lib/attendance-day';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * ONE EMPLOYEE (G-37, 10 Oct 2026). Pravin chose a page of its own, so a
 * person's name can open somewhere. Read-only: who they are, where they
 * work, this month's attendance, their leave, payslips and assigned jobs.
 * Editing stays where it is (Settings > Employees, HRM).
 *
 * Only someone working in one of the branches the viewer can see is found:
 * the same "your stores" rule every other record follows. `storeIds` are
 * the viewer's branches in the current scope. Pay is stricter than HRM
 * (`/hrm/payroll` needs a payroll permission), so payslips are fetched only
 * for a viewer who could open payroll - never sent and merely hidden.
 */
export async function employeeView(storeIds: string[], id: string, opts: { canSeePay: boolean }, now = new Date()) {
  if (storeIds.length === 0) return null;
  const roles = await db.userStoreRole.findMany({
    where: { userId: id, storeId: { in: storeIds }, deletedAt: null },
    select: { storeId: true, store: { select: { name: true } }, role: { select: { name: true } } },
  });
  if (roles.length === 0) return null;

  const user = await db.user.findFirst({
    where: { id, deletedAt: null, storeRoles: { some: { storeId: { in: storeIds } } } },
    select: {
      id: true, userCode: true, fullName: true, email: true, phone: true, isActive: true,
      createdAt: true, lastLoginAt: true, reportsToId: true,
      department: { select: { name: true } },
    },
  });
  if (!user) return null;

  const { year, month } = istYearMonth(now);
  const [profile, manager, leave, payslips, jobs, openJobs, attendance] = await Promise.all([
    db.employeeProfile.findFirst({
      where: { userId: id, deletedAt: null },
      select: { dateOfJoining: true, employmentType: true, confirmedAt: true, exitDate: true, exitReason: true },
    }),
    user.reportsToId ? db.user.findUnique({ where: { id: user.reportsToId }, select: { id: true, fullName: true } }) : null,
    db.leaveRequest.findMany({
      where: { userId: id, storeId: { in: storeIds }, deletedAt: null }, orderBy: { fromDate: 'desc' }, take: LIST_MAX_ROWS,
      select: { id: true, kind: true, fromDate: true, toDate: true, status: true, reason: true, leaveType: { select: { name: true } } },
    }),
    !opts.canSeePay ? Promise.resolve([]) : db.payslip.findMany({
      where: { userId: id, storeId: { in: storeIds }, deletedAt: null }, orderBy: { generatedAt: 'desc' }, take: LIST_MAX_ROWS,
      select: { id: true, payrollRunId: true, netPaise: true, workingDays: true, payrollRun: { select: { label: true, status: true } } },
    }),
    db.complaint.findMany({
      where: { assignedTechnicianId: id, storeId: { in: storeIds } }, orderBy: { createdAt: 'desc' }, take: LIST_MAX_ROWS,
      select: { id: true, complaintNo: true, status: true, createdAt: true, customerId: true, customer: { select: { companyName: true, firstName: true, lastName: true } } },
    }),
    db.complaint.count({ where: { assignedTechnicianId: id, storeId: { in: storeIds }, status: { notIn: ['closed', 'cancelled'] } } }),
    // This month's attendance, in the branch they work in (the first one seen).
    myMonth(id, roles[0].storeId, year, month, now).catch(() => null),
  ]);

  return {
    ...user,
    department: user.department?.name ?? null,
    manager,
    profile,
    roles: roles.map((r) => ({ store: r.store.name, role: r.role.name })),
    attendance: attendance ? { ...attendance.totals, branch: roles[0].store.name } : null,
    leave: leave.map((l) => ({ ...l, typeName: l.leaveType?.name ?? null })),
    payslips,
    canSeePay: opts.canSeePay,
    jobs: jobs.map((j) => ({
      id: j.id, complaintNo: j.complaintNo, status: j.status, createdAt: j.createdAt, customerId: j.customerId,
      customerName: j.customer.companyName || [j.customer.firstName, j.customer.lastName].filter(Boolean).join(' '),
    })),
    openJobs,
  };
}
