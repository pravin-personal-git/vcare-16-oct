import { notFound } from 'next/navigation';
import { requirePortalContext } from '@/server/portal-context';
import { getMyComplaintDetail } from '@/server/portal';
import { customerJobView } from '@/server/job-customer';
import { listJobPhotosForCustomer } from '@/server/job-photos';
import { portalConfig } from '@/server/config';
import { PortalJobClient } from './PortalJobClient';

/**
 * A customer's complaint in the portal (workflow slice 5): milestones, who is
 * coming and when, and what they can do now - the same panel as the
 * no-login link. getMyComplaintDetail proves the job is theirs first.
 *
 * THREE CUSTOMISATION SWITCHES ARE READ HERE (3 Oct 2026). `portal.job.photos`,
 * `portal.job.timestamps` and `portal.documents` have existed in the registry
 * since F1a and NOTHING read any of them - they were on the PENDING_WIRING
 * burn-down because the features behind them did not exist. Job photos now do
 * (`server/job-photos`), and the other two were always a matter of what this page
 * chooses to render.
 *
 * Read server-side, not in the client: a switch the browser decides is a switch
 * the browser can be told to ignore, and the whole point of "do not show the
 * customer exact times" is that the customer does not get them.
 */
export default async function PortalComplaintDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePortalContext();
  const mine = await getMyComplaintDetail(ctx.party.id, ctx.party.storeId, id);
  if (!mine) notFound();
  const job = await customerJobView(id);
  if (!job) notFound();

  const cfg = await portalConfig(ctx.party.storeId).catch(() => null);
  // Default ON where the config cannot be read, matching every element's own
  // default - a client who has never opened Customisation sees the full page.
  const on = (key: string) => cfg?.on(key) !== false;

  const showPhotos = on('portal.job.photos');
  const photos = showPhotos
    ? await listJobPhotosForCustomer(ctx.party.storeId, id).catch(() => [])
    : [];

  return (
    <PortalJobClient
      job={job}
      photos={photos}
      showTimestamps={on('portal.job.timestamps')}
      allowDownloads={on('portal.documents')}
    />
  );
}
