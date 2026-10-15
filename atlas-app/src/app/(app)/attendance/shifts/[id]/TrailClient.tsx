'use client';
import { DetailHeader } from '@/components/document/DetailHeader';
import { describeRule, distanceOf, formatDistance } from '@/lib/distance';

import { Badge, Card, SectionCard, SummaryRow } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { accuracyLabel, formatWorked, metresBetween } from '@/lib/shift';

interface Point {
  lat: number;
  lng: number;
  accuracyM: number | null;
  source: string;
  recordedAt: string;
  mocked: boolean;
}

/**
 * A clock-in photograph (F2.5, D14).
 *
 * `url` is signed for this page load and expires. It is null when storage is
 * not configured or the link could not be minted - the row is still shown,
 * because "a photo was taken at 09:02" is itself part of the record.
 */
interface Photo {
  id: string;
  direction: string;
  capturedAt: string;
  mocked: boolean;
  lat: number | null;
  lng: number | null;
  url: string | null;
}

interface ShiftVM {
  id: string;
  userName: string;
  startedAt: string;
  endedAt: string | null;
  correctedEndedAt: string | null;
  workedMinutes: number | null;
  callCount: number;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
}

const fmtClock = (d: string) =>
  new Date(d).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' });

/** Zoom 15 - roughly a neighbourhood, which matches how coarse the fix is. */
const mapUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}&z=15`;

const SOURCE_LABEL: Record<string, string> = {
  shift_start: 'Started shift',
  shift_end: 'Ended shift',
  session_start: 'Clocked in',
  session_end: 'Clocked out',
  sync: 'On the move',
  manual: 'Manual sync',
  field_check_in: 'Site check-in',
};

export function TrailClient({ shift, trail, photos = [] }: { shift: ShiftVM; trail: Point[]; photos?: Photo[] }) {
  // The real method (F1c, lib/distance) rather than a naive sum of every gap -
  // see that module on why breadcrumb noise invents kilometres.
  const distance = distanceOf(trail.map((p) => ({
    lat: p.lat, lng: p.lng, accuracyM: p.accuracyM, mocked: p.mocked, at: Date.parse(p.recordedAt),
  })));

  return (
    <>
      <DetailHeader
        icon="map-pin"
        kind="Shift"
        number={`${shift.userName} - ${fmtDate(shift.startedAt)}`}
        facts={[
          { label: 'Hours', value: `${fmtClock(shift.startedAt)} to ${shift.correctedEndedAt ? fmtClock(shift.correctedEndedAt) : shift.endedAt ? fmtClock(shift.endedAt) : 'still on shift'}` },
          { label: 'Worked', value: formatWorked(shift.workedMinutes) },
          { label: 'Calls', value: shift.callCount },
        ]}
        backHref="/attendance/shifts"
        backLabel="Back to shifts"
      />

      {/* The honesty note goes above the trail, not under it. Somebody about to
          draw a conclusion from a dot on a map needs to know how wide the dot
          really is BEFORE they read it. */}
      <Card className="mb-3 flex items-start gap-2.5 border-border bg-muted/40 px-3 py-2.5">
        <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="flex-1 text-xs leading-relaxed">
          <strong>Read each dot with its accuracy.</strong> The Vcare app records a precise
          position every 2 minutes while moving and every 10 while still, only while a shift is
          open. Indoors a fix can be off by 50-100 metres - the accuracy is shown beside every
          point. A point marked <strong>fake location</strong> was reported by Android as coming
          from a location-spoofing app.
        </p>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
        <SectionCard title="Where the phone was" icon="clock" bodyClassName="p-0">
          {trail.length === 0 ? (
            <div className="p-6 text-center">
              <Icon name="alert-triangle" className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">No positions recorded</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Either the employee did not allow location, or the phone could not get a fix -
                indoors with no wifi is the usual reason. The shift and the calls are unaffected;
                location is the only thing missing.
              </p>
            </div>
          ) : (
            <ol className="divide-y divide-border">
              {trail.map((p, i) => {
                const prev = i > 0 ? trail[i - 1] : null;
                const moved = prev ? metresBetween(prev, p) : 0;
                return (
                  <li key={`${p.recordedAt}-${i}`} className="flex gap-3 px-4 py-2.5">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-medium tabular-nums">
                          {fmtClock(p.recordedAt)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {SOURCE_LABEL[p.source] ?? p.source}
                        </span>
                        {p.mocked && <Badge tone="danger">fake location</Badge>}
                        {prev && moved > 200 && (
                          <Badge tone="info">
                            moved {moved >= 1000 ? `${(moved / 1000).toFixed(1)} km` : `${moved} m`}
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        <a
                          href={mapUrl(p.lat, p.lng)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="font-mono text-xs text-brand hover:underline"
                        >
                          {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
                        </a>
                        <span className="text-xs text-muted-foreground">
                          {accuracyLabel(p.accuracyM)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </SectionCard>

        <div className="flex flex-col gap-3">
          {photos.length > 0 && (
            <SectionCard title="Clock-in photos" icon="camera">
              {/* NOT A FACE SCAN, and it says so on the screen. Nothing is
                  enrolled and nothing is matched (D14), so a supervisor looking
                  at these is the check - and they should know that judgement is
                  theirs rather than a matcher's. */}
              <p className="mb-2.5 text-xs leading-relaxed text-muted-foreground">
                Taken by the phone&rsquo;s front camera at the moment of clocking in or out, with
                the same time and place as the punch. <strong>These are photographs, not face
                scans</strong> - nothing is measured or matched, and no face data is stored.
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {photos.map((ph) => (
                  <figure key={ph.id} className="overflow-hidden rounded-md border border-border">
                    {ph.url ? (
                      <a href={ph.url} target="_blank" rel="noreferrer noopener">
                        {/* A plain img, not next/image: the link is signed and
                            short-lived, so it must not be fetched and cached by
                            the image optimiser. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={ph.url}
                          alt={`${ph.direction === 'out' ? 'Clock out' : 'Clock in'} at ${fmtClock(ph.capturedAt)}`}
                          className="aspect-square w-full bg-muted object-cover"
                        />
                      </a>
                    ) : (
                      <div className="grid aspect-square w-full place-items-center bg-muted">
                        <Icon name="image" className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <figcaption className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
                      <span className="text-xs font-medium tabular-nums">{fmtClock(ph.capturedAt)}</span>
                      <span className="text-xs text-muted-foreground">
                        {ph.direction === 'out' ? 'out' : 'in'}
                      </span>
                      {ph.mocked && <Badge tone="danger">fake location</Badge>}
                      {!ph.url && <span className="text-xs text-muted-foreground">not available</span>}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </SectionCard>
          )}

          <SectionCard title="Summary" icon="users">
            <SummaryRow label="Employee" value={shift.userName} />
            <SummaryRow label="Started" value={fmtClock(shift.startedAt)} />
            <SummaryRow
              label="Finished"
              value={
                shift.correctedEndedAt
                  ? `${fmtClock(shift.correctedEndedAt)} (corrected)`
                  : shift.endedAt ? fmtClock(shift.endedAt) : 'Still on shift'
              }
            />
            <SummaryRow label="Worked" value={formatWorked(shift.workedMinutes)} strong />
            <SummaryRow label="Calls" value={String(shift.callCount)} />
            <SummaryRow label="Positions" value={String(trail.length)} />
            {/* F1c. Null rather than "0 m" when nothing usable survived the
                filters: "went nowhere" and "we could not tell" are different
                sentences, and only one of them is a claim about a person. */}
            <SummaryRow
              label="Distance covered"
              value={distance.usedPoints > 1 ? formatDistance(distance.metres) : 'Not enough readings'}
              strong={distance.usedPoints > 1}
            />
            {distance.droppedMocked > 0 && (
              <SummaryRow
                label="Simulated fixes"
                value={`${distance.droppedMocked} ignored`}
              />
            )}
          </SectionCard>

          {trail.length > 1 && (
            <Card className="px-3 py-2.5">
              {/* The method, on the screen, beside the figure (F1c). A number
                  whose rule is not visible is a number people argue with. */}
              <p className="text-xs leading-relaxed text-muted-foreground">
                <strong>This is an under-count, deliberately.</strong> {describeRule()} Distance
                is measured in straight lines between readings, so a winding route counts as
                less than it really was, and movement smaller than the readings&rsquo; own
                margin of error is ignored rather than guessed at. It is a floor, never a
                total, and it should not be used to check a fuel claim.
              </p>
              {(distance.ignoredJumps > 0 || distance.brokenByGaps > 0 || distance.droppedInaccurate > 0) && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Left out:{' '}
                  {[
                    distance.droppedInaccurate > 0 && `${distance.droppedInaccurate} vague reading${distance.droppedInaccurate === 1 ? '' : 's'}`,
                    distance.ignoredJumps > 0 && `${distance.ignoredJumps} impossible jump${distance.ignoredJumps === 1 ? '' : 's'}`,
                    distance.brokenByGaps > 0 && `${distance.brokenByGaps} gap${distance.brokenByGaps === 1 ? '' : 's'} in reporting`,
                  ].filter(Boolean).join(' · ')}.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
