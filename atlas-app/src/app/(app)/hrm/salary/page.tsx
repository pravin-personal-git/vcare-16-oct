import { requireContext } from '@/server/context';
import { listEmployeeSalaries, getPayrollSummary } from '@/server/payroll';
import { SalaryClient } from './SalaryClient';

export default async function SalaryPage() {
  const ctx = await requireContext();
  const [rows, summary] = await Promise.all([
    listEmployeeSalaries(ctx.scope),
    getPayrollSummary(ctx.scope),
  ]);

  return (
    <SalaryClient
      rows={rows}
      summary={summary}
      canEdit={ctx.permissions.has('hrm.edit')}
    />
  );
}
