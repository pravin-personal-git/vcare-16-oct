'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { AnchoredPopover, usePopoverAnchor } from '@/components/ui/AnchoredPopover';
import {
  markLeavingAction, markPresentAction, type PresenceActionResult,
} from '@/app/actions/presence';

/**
 * "PRESENT" - ATTENDANCE FOR PEOPLE WHO DO NOT CARRY THE FIELD PHONE.
 *
 * This button used to open a popover explaining that attendance was not built.
 * It is built now, so it does the thing.
 *
 * WHAT ONE PRESS DOES
 *
 *   1. Asks the browser where it is, and waits no longer than eight seconds.
 *   2. Records the press in Atlas.
 *
 * WHY IT DOES NOT REFUSE WITHOUT A LOCATION.
 *
 * A browser can decline location, and on a desktop it is often wrong by
 * kilometres anyway. Refusing to record somebody's attendance because of a
 * browser setting would punish the employee for something they may not control.
 * The press is recorded either way, and the popover says plainly which kind it
 * was - an attendance record that quietly omits whether it had a location is
 * the one that causes an argument later.
 *
 * WHY THERE IS NO CONFIRMATION DIALOG.
 *
 * Both actions are corrigible. Marking present at the wrong moment is fixed by
 * a manager on the attendance screen, which is exactly the authority that
 * screen exists to hold. An extra click every morning to protect against a
 * mistake somebody else can undo in five seconds is a bad trade.
 */

export interface PresenceSnapshot {
  clockInAt: string;
  clockOutAt: string | null;
  workedMinutes: number | null;
  hasLocation: boolean;
}

/** How long to wait for the browser before giving up and recording without it. */
const FIX_TIMEOUT_MS = 8_000;

/**
 * Ask the browser where it is. Never rejects, never hangs.
 *
 * The outer timer is not redundant with the option of the same name: a browser
 * that is showing its own permission prompt has not started the geolocation
 * timeout yet, so a person who walks away from the prompt would otherwise leave
 * the button spinning for ever.
 */
function browserFix(): Promise<{ lat?: number; lng?: number; accuracyM?: number }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({});
      return;
    }

    let settled = false;
    const done = (v: { lat?: number; lng?: number; accuracyM?: number }) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const timer = setTimeout(() => done({}), FIX_TIMEOUT_MS);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        done({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
        });
      },
      () => {
        clearTimeout(timer);
        done({});
      },
      { enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS, maximumAge: 60_000 },
    );
  });
}

function clock(iso: string): string {
  // India time, always: the server renders this in UTC and the browser in IST,
  // and the two disagreeing broke hydration on every page (React error 418).
  return new Date(iso).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function PresenceButton({ initial }: { initial: PresenceSnapshot | null }) {
  const [state, setState] = useState<PresenceSnapshot | null>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { ref, anchor, open, toggle, close } = usePopoverAnchor<HTMLButtonElement>();

  // The server is the authority. A navigation that re-renders the header with a
  // newer snapshot must win over whatever this component last saw.
  useEffect(() => setState(initial), [initial]);

  const run = async (action: (fix: Awaited<ReturnType<typeof browserFix>>) => Promise<PresenceActionResult>) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setMessage(null);
    try {
      const res = await action(await browserFix());
      if (!res.ok) {
        setProblem(res.error ?? 'Something went wrong.');
      } else {
        if (res.state) setState(res.state);
        setProblem(res.warning ?? null);
        setMessage(res.state?.clockOutAt ? 'Finished for the day.' : 'Marked present.');
      }
      if (!open) toggle();
    } finally {
      setBusy(false);
    }
  };

  const done = state !== null && state.clockOutAt !== null;
  const inProgress = state !== null && state.clockOutAt === null;

  let label = 'Present';
  if (state !== null) {
    if (state.clockOutAt !== null) {
      label = state.workedMinutes !== null ? duration(state.workedMinutes) : 'Done';
    } else {
      label = clock(state.clockInAt);
    }
  }

  // Green only while it is an invitation. Once the day is recorded the control
  // is information, and a green button that does nothing new draws the eye for
  // no reason every time somebody looks at the header.
  const tone = done
    ? 'border border-border bg-card text-muted-foreground hover:bg-muted'
    : inProgress
      ? 'border border-success/40 bg-success/10 text-on-tint-success hover:bg-success/15'
      : 'bg-success text-white shadow-card hover:opacity-90';

  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={busy}
        onClick={() => {
          if (state) toggle();
          else void run(markPresentAction);
        }}
        aria-label={inProgress ? 'You are marked present' : done ? 'Attendance for today' : 'Mark yourself present'}
        className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded px-2.5 text-sm font-medium transition disabled:opacity-60 sm:px-3 ${tone}`}
      >
        <Icon name={busy ? 'clock' : 'check-circle'} className={`h-4 w-4 shrink-0 ${busy ? 'animate-spin' : ''}`} />
        <span className="hidden sm:inline">{busy ? 'Working…' : label}</span>
        {/* Once marked present the label becomes a bare clock time with no
            other affordance - nothing suggested it was still clickable to
            end the day, which is exactly how "no way to end shift" happens
            even though the action underneath has always worked. */}
        {state && !busy && <Icon name="chevron-down" className="h-3.5 w-3.5 shrink-0 opacity-70" />}
      </button>

      {anchor && (
        <AnchoredPopover anchor={anchor} align="end" width={288} onClose={close} className="p-3">
            <p className="text-sm font-semibold">
              {done ? 'Today' : inProgress ? 'You are present' : 'Mark attendance'}
            </p>

            {state && (
              <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between gap-3">
                  <dt>Started</dt>
                  <dd className="font-medium text-foreground">{clock(state.clockInAt)}</dd>
                </div>
                {state.clockOutAt && (
                  <div className="flex justify-between gap-3">
                    <dt>Finished</dt>
                    <dd className="font-medium text-foreground">{clock(state.clockOutAt)}</dd>
                  </div>
                )}
                {state.workedMinutes !== null && (
                  <div className="flex justify-between gap-3">
                    <dt>Worked</dt>
                    <dd className="font-medium text-foreground">{duration(state.workedMinutes)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt>Location</dt>
                  <dd className="font-medium text-foreground">
                    {state.hasLocation ? 'Recorded' : 'Not shared'}
                  </dd>
                </div>
              </dl>
            )}

            {!state && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                This records you present for the day, with the time and, if your
                browser allows it, your location. It goes straight to the HR
                system.
              </p>
            )}

            {message && <p className="mt-2 text-xs font-medium text-success">{message}</p>}

            {problem && (
              <p className="mt-2 flex gap-1.5 text-xs leading-relaxed text-warning">
                <Icon name="alert-triangle" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{problem}</span>
              </p>
            )}

            {inProgress && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(markLeavingAction)}
                className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card text-sm font-medium transition hover:bg-muted disabled:opacity-60"
              >
                <Icon name="log-out" className="h-3.5 w-3.5" />
                Finish for the day
              </button>
            )}

            {!state && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(markPresentAction)}
                className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-success text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
              >
                <Icon name="check-circle" className="h-3.5 w-3.5" />
                Mark me present
              </button>
            )}
        </AnchoredPopover>
      )}
    </>
  );
}
