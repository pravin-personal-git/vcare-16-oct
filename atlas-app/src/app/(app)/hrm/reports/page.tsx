import { requireContext } from '@/server/context';
import { REPORTS } from '@/server/report-catalogue';
import { DownloadsClient } from '@/app/(app)/reports/downloads/DownloadsClient';

/**
 * The roadmap's §4.10 Excel export center - reuses the SAME report registry
 * and `/api/reports/download` route the platform-wide "Reports & Downloads"
 * screen already uses (see report-catalogue.ts), scoped down to HRM data
 * sets rather than a second, parallel export system. `people-calls` is
 * excluded - Call Activity shares the People category for historical
 * grouping reasons but isn't an HRM concept.
 */
export default async function HrmReportsPage() {
  const ctx = await requireContext();

  const hrmReports = REPORTS.filter((r) => r.category === 'People' && r.id !== 'people-calls');
  const allowed = hrmReports.filter((r) => ctx.permissions.has(r.permission));

  return (
    <DownloadsClient
      badge="RP"
      title="Reports"
      subtitle={`${allowed.length} HRM data sets · download as CSV`}
      reports={allowed.map((r) => ({
        id: r.id, name: r.name, description: r.description, category: r.category, dated: r.dated,
      }))}
      hiddenCount={hrmReports.length - allowed.length}
    />
  );
}
