'use client';

import Link from 'next/link';
import { CustomerJobPanel, type CustomerJobVM } from '@/components/services/CustomerJobPanel';
import { JobPhotos } from '@/components/services/JobPhotos';
import type { JobPhoto } from '@/server/job-photos';
import { portalJobAct } from './actions';

/**
 * The portal's complaint page: the shared customer panel (workflow slice 5).
 *
 * The three switches arriving as props rather than being read here is deliberate -
 * see the note on the page. A switch the browser decides is a switch the browser
 * can be told to ignore.
 */
export function PortalJobClient({ job, photos, showTimestamps, allowDownloads }: {
  job: CustomerJobVM;
  photos: JobPhoto[];
  /** `portal.job.timestamps` - off shows the day, not "arrived 14:42". */
  showTimestamps: boolean;
  /** `portal.documents` - whether a PDF may be downloaded at all. */
  allowDownloads: boolean;
}) {
  return (
    <div className="grid gap-3">
      <Link href="/portal/complaints" className="text-sm text-brand hover:underline">← Back to my complaints</Link>

      <CustomerJobPanel
        job={job}
        act={(op, body) => portalJobAct(job.id, op, body)}
        showTimestamps={showTimestamps}
        /*
          The report link is withheld entirely rather than shown and refused.
          A download that fails looks like the app is broken; a link that was
          never there is just a business that discusses its paperwork in person.
        */
        reportHref={allowDownloads ? `/j/${job.id}/report` : undefined}
        // Job photos marked "Customer sees it" (11 Oct 2026), in the card stack.
        extra={photos.length > 0 ? <div className="rounded-lg bg-card p-4 shadow-raised"><JobPhotos photos={photos} /></div> : undefined}
      />
    </div>
  );
}
