import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { getPayslipDocument } from '@/server/payslip-document';
import { PayslipViewClient } from './PayslipViewClient';

export default async function PayslipViewPage({
  params,
}: {
  params: Promise<{ runId: string; payslipId: string }>;
}) {
  const { runId, payslipId } = await params;
  const ctx = await requireContext();

  const slip = await getPayslipDocument(ctx.scope, payslipId);
  if (!slip) notFound();

  return (
    <PayslipViewClient
      runId={runId}
      slip={{
        ...slip,
        generatedAt: slip.generatedAt.toISOString(),
        run: {
          ...slip.run,
          periodStart: slip.run.periodStart.toISOString(),
          periodEnd: slip.run.periodEnd.toISOString(),
        },
      }}
    />
  );
}
