import { redirect } from 'next/navigation';

/**
 * Accounts > Dashboard is now the Accounts tab of the dashboards (11 Oct
 * 2026, dashboards demo): one filter bar, the same figures, clickable. The
 * menu link and old bookmarks land there.
 */
export default function AccountsDashboardPage() {
  redirect('/dashboard?tab=accounts');
}
