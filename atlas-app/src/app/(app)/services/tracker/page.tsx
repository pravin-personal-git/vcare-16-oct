import { redirect } from 'next/navigation';

/**
 * The Complaint Tracker is replaced by a page per complaint (health check
 * SVC-2). Old links - /services/tracker?id=... - land on that complaint.
 */
export default async function ComplaintTrackerPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  redirect(id ? `/services/complaints/${encodeURIComponent(id)}` : '/services/complaints');
}
