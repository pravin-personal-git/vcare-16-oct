import { notFound } from 'next/navigation';
import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { serviceReportData } from '@/server/job-report';
import { ServiceReport } from '@/components/services/ServiceReport';

/** The office's copy of a job's service report (workflow slice 6). */
export default async function JobReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();
  const job = await db.complaint.findFirst({ where: { id, ...scopeWhere(ctx.scope) }, select: { id: true } });
  if (!job) notFound();
  const r = await serviceReportData(job.id);
  if (!r) notFound();
  return <ServiceReport r={r} />;
}
