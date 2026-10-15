import { notFound, redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { listShifts, shiftTrail } from '@/server/shifts';
import { selfiesForSession } from '@/server/attendance-capture/selfie';
import { TrailClient } from './TrailClient';
import { DocumentActivity } from '@/components/document/DocumentActivity';

/**
 * One shift, and where the phone was during it.
 *
 * THE ANSWER TO "WHERE CAN I SEE THE LOCATION?".
 *
 * The Android app has been recording a position at shift start, at shift end
 * and alongside every call sync since 7 Sep. `shiftTrail` has existed since the
 * same day. Until now there was nowhere to look at it - the Shift Log only had
 * two "on map" links, which showed the ends of the day and nothing in between.
 *
 * Gated on `attendance.locate`, not `attendance.view`. Seeing that somebody
 * worked 08:12 to 19:40 and seeing everywhere they went are different
 * authorities, and the second one is the most invasive thing this product
 * holds.
 */
export default async function ShiftTrailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireContext();

  if (!ctx.permissions.has('attendance.locate')) {
    redirect('/attendance/shifts');
  }

  // Fetched through `listShifts` rather than a bare lookup so the row arrives
  // already scoped, already carrying the worked-minutes rule, and already
  // reflecting any correction - one source of truth for what a shift is.
  // One check-in by its id, any source - it used to scan a capped, phone-only list,
  // so a website check-in (or an old one) was a 404.
  const [shift] = await listShifts(ctx.scope, { from: new Date(0), to: new Date(), id });
  if (!shift) notFound();

  const trail = await shiftTrail(ctx.scope, id);

  /**
   * The clock-in photographs (F2.5, D14), on the same page and behind the same
   * `attendance.locate` permission as the trail.
   *
   * They belong here rather than on the Shift Log list: a face is the most
   * identifying thing in this product, and a grid of them beside every row
   * turns a working list into surveillance at a glance. Somebody who wants to
   * look at one has to open that one shift.
   *
   * The links are signed for this request only - nothing stores a URL.
   */
  const photos = await selfiesForSession(ctx.scope, id);

  return (
    <>
    <TrailClient
      shift={{
        id: shift.id,
        userName: shift.userName,
        startedAt: shift.startedAt.toISOString(),
        endedAt: shift.endedAt?.toISOString() ?? null,
        correctedEndedAt: shift.correctedEndedAt?.toISOString() ?? null,
        workedMinutes: shift.workedMinutes,
        callCount: shift.callCount,
        startLat: shift.startLat,
        startLng: shift.startLng,
        endLat: shift.endLat,
        endLng: shift.endLng,
      }}
      trail={trail.map((p) => ({
        lat: p.lat,
        lng: p.lng,
        accuracyM: p.accuracyM,
        source: p.source,
        recordedAt: p.recordedAt.toISOString(),
        mocked: p.mocked,
      }))}
      photos={photos.map((ph) => ({
        id: ph.id,
        direction: ph.direction,
        capturedAt: ph.capturedAt.toISOString(),
        mocked: ph.mocked,
        lat: ph.lat,
        lng: ph.lng,
        url: ph.url,
      }))}
    />
      <DocumentActivity table="AttendanceSession" rowId={id} />
    </>
  );
}
