import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { db } from '@/server/db';
import { publicBrandUrl } from '@/server/storage';
import { customerJobView, ownedByToken } from '@/server/job-customer';
import { JobLinkClient } from './JobLinkClient';

/**
 * A customer's job, without a login (workflow slice 5, spec §9): for
 * customers who have neither the app nor the portal. The office sends this
 * link on WhatsApp. It shows the milestones and lets them confirm, approve an
 * estimate, ask for another time, rate and reopen - nothing else.
 */
export const dynamic = 'force-dynamic';

/**
 * The preview WhatsApp draws under the link (A2, 11 Oct 2026): the business
 * and the request number instead of a bare URL. Never indexed.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const job = await ownedByToken(token).catch(() => null);
  const c = job && await db.complaint.findUnique({
    where: { id: job.id },
    select: { complaintNo: true, store: { select: { organization: { select: { name: true, logoPath: true } } } } },
  });
  if (!c) return { title: 'Service request', robots: { index: false, follow: false } };
  const org = c.store.organization;
  const title = `Service request ${c.complaintNo} from ${org.name}`;
  const description = 'See progress, confirm when it is fixed, and rate us.';
  const logo = publicBrandUrl(org.logoPath);
  return {
    title, description, robots: { index: false, follow: false },
    openGraph: { title, description, type: 'website', siteName: org.name, ...(logo ? { images: [{ url: logo, alt: org.name }] } : {}) },
  };
}

export default async function JobLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const job = await ownedByToken(token).catch(() => null);
  if (!job) notFound();
  const [view, store] = await Promise.all([
    customerJobView(job.id),
    db.store.findUnique({ where: { id: job.storeId }, select: { name: true, organization: { select: { name: true } } } }),
  ]);
  if (!view) notFound();
  return (
    <main className="min-h-screen bg-background px-4 py-6">
      <JobLinkClient token={token} job={view} businessName={store?.organization.name ?? store?.name ?? ''} />
    </main>
  );
}
