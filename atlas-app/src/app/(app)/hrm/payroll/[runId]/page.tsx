import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { getPayrollRunDetail } from '@/server/payroll-run';
import { PayslipsClient } from './PayslipsClient';

export default async function PayrollRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const ctx = await requireContext();

  if (ctx.scope.kind !== 'single') notFound();

  const detail = await getPayrollRunDetail(ctx.scope, runId);
  if (!detail) notFound();

  return (
    <PayslipsClient
      run={{
        ...detail.run,
        periodStart: detail.run.periodStart.toISOString(),
        periodEnd: detail.run.periodEnd.toISOString(),
        revertedAt: detail.run.revertedAt?.toISOString() ?? null,
      }}
      payslips={detail.payslips}
      canProcess={ctx.permissions.has('payroll.process')}
    />
  );
}
