import { notFound } from 'next/navigation';
import { ownedByToken } from '@/server/job-customer';
import { serviceReportData } from '@/server/job-report';
import { ServiceReport } from '@/components/services/ServiceReport';

/** The customer's service report, from their no-login link (workflow slice 6). */
export const dynamic = 'force-dynamic';

export default async function JobLinkReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const job = await ownedByToken(token).catch(() => null);
  if (!job || !['resolved', 'closed'].includes(job.status)) notFound();
  const r = await serviceReportData(job.id);
  if (!r) notFound();
  return <ServiceReport r={r} />;
}
