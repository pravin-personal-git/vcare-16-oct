import { loadSession, type Session } from './session';
import { refreshSession } from './api';
import { checkIn, startBackgroundCheckIns } from './checkin';
import { loadDevice } from './device';

/**
 * Everything that happens behind the opening animation.
 *
 * Today: find a saved sign-in and make sure it still works. As later weeks
 * land, the same list grows - open the offline database, send queued
 * changes, check for an app update - each one allowed to fail without
 * holding the app on the intro screen.
 */
export interface BootResult {
  session: Session | null;
}

export async function bootstrap(): Promise<BootResult> {
  // A paired phone checks in on every start. Not awaited: the intro must not
  // wait on the network, and a failed check-in is simply retried later.
  void loadDevice().then((d) => { if (d) { void checkIn(); void startBackgroundCheckIns(); } });
  let session = await loadSession();
  if (session && Date.now() >= session.accessExpiresAt) {
    // No signal keeps the saved session (refreshSession only signs out on a
    // definite 401), so someone opening the app in a dead zone is not sent
    // back to the login screen.
    session = await refreshSession(session);
  }
  return { session };
}

/** Where a signed-in person lands. */
export function homeFor(session: Session | null): '/welcome' | '/customer/home' | '/employee/home' | '/employee/work' | '/owner/home' {
  if (!session) return '/welcome';
  if (session.kind === 'party') return '/customer/home';
  if (session.home === 'owner') return '/owner/home';
  // The simple field-worker app (13 Oct 2026, Settings > Roles > Phone app > Layout).
  return session.app?.layout?.preset === 'simple' ? '/employee/work' : '/employee/home';
}

/** The intro is never shorter than this (so it does not flash) nor longer than MAX. */
export const INTRO_MIN_MS = 2800;
export const INTRO_MAX_MS = 8000;
