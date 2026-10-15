import { redirect } from 'next/navigation';

/**
 * HRM > Dashboard is now the People tab of the dashboards (11 Oct 2026,
 * dashboards demo): attendance, leave, payroll and approvals with one filter
 * bar. The menu link and old bookmarks land there.
 */
export default function HrmModuleDashboardPage() {
  redirect('/dashboard?tab=people');
}
