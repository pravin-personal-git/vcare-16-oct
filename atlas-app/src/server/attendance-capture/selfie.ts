import 'server-only';
import { db } from '../db';
import { putFile, signedUrls, isStorageConfigured } from '../storage';
import { resolveForUser } from '../app-access';
import { scopeWhere, type StoreScope } from '../store-scope';

/**
 * Clock-in photos (F2.5, decision D14).
 *
 * NOT A FACE SCAN, AND THE DISTINCTION IS LOAD-BEARING.
 *
 * A picture is taken, stamped with the GPS fix the app already captures, and
 * shown to a supervisor. There is no enrolment, no template, and no matching -
 * so nothing here is biometric data under DPDP 2023, and the table has no
 * column that could hold any.
 *
 * WHY A PHOTO IS ENOUGH.
 *
 * The reason people cheat phone attendance is that nobody can see where they
 * were. A timestamped photo inside a geofence removes that, and a supervisor
 * glancing down a column of faces is a better check than a 94%-accurate
 * matcher that locks a genuine employee out in bad light. It also works in
 * airplane mode, which a cloud matcher does not.
 */

/**
 * There is deliberately no error class in this module. Nothing here throws:
 * every failure is a `null` return, because the caller has already recorded
 * the attendance and must not be given anything it could rethrow.
 */

/** A JPEG this big is a bad camera setting, not a photograph of a person. */
const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface SelfieInput {
  userId: string;
  storeId: string;
  sessionId: string | null;
  direction: 'in' | 'out';
  capturedAt: Date;
  fix: { lat: number; lng: number; accuracyM: number | null } | null;
  mocked: boolean;
  mimeType: string;
  bytes: ArrayBuffer;
}

/**
 * Store one photo.
 *
 * NEVER FAILS THE CLOCK-IN. The caller records attendance first and calls this
 * afterwards; if storage is down, or the bucket is unconfigured, or the phone
 * sent something odd, the punch still stands. Refusing to let somebody start
 * work because a photograph would not upload is the same mistake as refusing
 * a clock-in for a poor GPS fix - which `attendance-geo.ts` has explicitly
 * avoided since September.
 */
export async function storeSelfie(input: SelfieInput): Promise<{ id: string } | null> {
  if (!isStorageConfigured()) return null;
  if (!ALLOWED.has(input.mimeType)) return null;
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > MAX_BYTES) return null;

  try {
    const ext = input.mimeType === 'image/png' ? 'png' : input.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const { storagePath } = await putFile(
      input.storeId,
      'attendance-selfie',
      input.userId,
      { name: `${input.capturedAt.getTime()}.${ext}`, type: input.mimeType, bytes: input.bytes },
    );

    const row = await db.attendancePhoto.create({
      data: {
        storeId: input.storeId,
        userId: input.userId,
        sessionId: input.sessionId,
        direction: input.direction,
        storagePath,
        lat: input.fix?.lat ?? null,
        lng: input.fix?.lng ?? null,
        accuracyM: input.fix?.accuracyM ?? null,
        mocked: input.mocked,
        capturedAt: input.capturedAt,
      },
      select: { id: true },
    });
    return row;
  } catch (e) {
    console.error('[attendance-selfie] could not store the photo (non-fatal)', e);
    return null;
  }
}

/** Whether this person's app should ask for a photo at all. */
export async function selfieRequired(userId: string, storeIds: string[]): Promise<boolean> {
  try {
    const access = await resolveForUser(userId, storeIds);
    // Tied to the existing clock-in switch rather than a new one: a person who
    // does not clock in from the app has nothing to photograph.
    return access.tracking.clockIn && access.values['track.selfie'] === true;
  } catch {
    return false;
  }
}

export interface SelfieRow {
  id: string;
  direction: string;
  capturedAt: Date;
  mocked: boolean;
  lat: number | null;
  lng: number | null;
  url: string | null;
}

/**
 * Photos for one person over a window, with links that expire.
 *
 * Signed per request rather than stored as URLs: a permanent link to a
 * photograph of somebody's face works forever and for anyone the moment it
 * leaks into a chat or a screenshot.
 */
export async function selfiesFor(
  storeId: string, userId: string, from: Date, to: Date,
): Promise<SelfieRow[]> {
  const rows = await db.attendancePhoto.findMany({
    where: { storeId, userId, capturedAt: { gte: from, lt: to } },
    orderBy: { capturedAt: 'asc' },
    select: {
      id: true, direction: true, capturedAt: true, mocked: true,
      lat: true, lng: true, storagePath: true,
    },
  });
  if (rows.length === 0) return [];

  const links = await signedUrls(rows.map((r) => r.storagePath)).catch(() => new Map<string, string>());

  return rows.map((r) => ({
    id: r.id,
    direction: r.direction,
    capturedAt: r.capturedAt,
    mocked: r.mocked,
    lat: r.lat === null ? null : Number(r.lat),
    lng: r.lng === null ? null : Number(r.lng),
    url: links.get(r.storagePath) ?? null,
  }));
}

/**
 * Photos against one shift, for the shift trail.
 *
 * Scoped through the SESSION rather than on the photo directly, the same way
 * `shiftTrail` is: a shift id guessed from another tenant has to come back
 * empty, not come back with a photograph of somebody's face.
 */
export async function selfiesForSession(scope: StoreScope, sessionId: string): Promise<SelfieRow[]> {
  const session = await db.attendanceSession.findFirst({
    where: { id: sessionId, ...scopeWhere(scope) },
    select: { id: true, storeId: true },
  });
  if (!session) return [];

  const rows = await db.attendancePhoto.findMany({
    where: { storeId: session.storeId, sessionId: session.id },
    orderBy: { capturedAt: 'asc' },
    select: {
      id: true, direction: true, capturedAt: true, mocked: true,
      lat: true, lng: true, storagePath: true,
    },
  });
  if (rows.length === 0) return [];

  const links = await signedUrls(rows.map((r) => r.storagePath)).catch(() => new Map<string, string>());
  return rows.map((r) => ({
    id: r.id,
    direction: r.direction,
    capturedAt: r.capturedAt,
    mocked: r.mocked,
    lat: r.lat === null ? null : Number(r.lat),
    lng: r.lng === null ? null : Number(r.lng),
    url: links.get(r.storagePath) ?? null,
  }));
}
