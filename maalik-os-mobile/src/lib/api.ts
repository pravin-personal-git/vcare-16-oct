import { rememberBrand } from './brand';
import { isNoSignal, keepCopy, lastCopy, markOnline, wipeCopies } from './net';
import Constants from 'expo-constants';
import type { AppAccess } from './access';
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { clearSession, expiryFrom, loadSession, saveSession, type Session } from './session';
import { registeredPushToken } from './push-token';

/**
 * The one way the app talks to the server (`/api/v1`).
 *
 * - Every call has a timeout; a shop's mobile data can hang forever otherwise.
 * - A signed-in call refreshes the access token first when it is about to
 *   expire, and once more on a 401, then gives up and signs out cleanly.
 * - Errors come back as `ApiError` with the server's own message, which is
 *   already written for people ("Incorrect username or password.").
 */

export const API_BASE: string =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ?? 'https://atlas.nairsolutions.org';

export class ApiError extends Error {
  /** A machine-readable reason from the server, e.g. 'pair_required'. */
  constructor(message: string, readonly status: number, readonly code?: string) { super(message); }
}

/** A short label the server shows against this phone's sign-in. */
export function deviceLabel(): string {
  const app = Application.nativeApplicationVersion ?? 'dev';
  return `MAALIK OS ${app} · ${Platform.OS}`;
}

const TIMEOUT_MS = 20_000;

async function raw<T>(path: string, init: RequestInit & { token?: string; storeId?: string | null; deviceToken?: string | null } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...(init.storeId ? { 'x-store-id': init.storeId } : {}),
        ...(init.deviceToken ? { 'x-device-token': init.deviceToken } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError('Could not reach the server. Check the connection and try again.', 0);
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new ApiError(json.error ?? 'Something went wrong. Please try again.', res.status, json.code);
  return json;
}

export const post = <T>(path: string, body: unknown) => raw<T>(path, { method: 'POST', body: JSON.stringify(body) });

interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number }

let refreshing: Promise<Session | null> | null = null;

/** Trade the refresh token for a new pair. Concurrent callers share one refresh. */
export function refreshSession(current: Session): Promise<Session | null> {
  refreshing ??= (async () => {
    try {
      // A caller holding a copy from before another refresh finished must not
      // send the token that refresh already rotated away (15 Oct 2026).
      const saved = await loadSession();
      if (saved && saved.refreshToken !== current.refreshToken && Date.now() < saved.accessExpiresAt) return saved;
      const pair = await post<TokenPair>('/api/v1/auth/refresh', { refreshToken: (saved ?? current).refreshToken });
      const next: Session = {
        ...current,
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
        accessExpiresAt: expiryFrom(pair.expiresIn),
      };
      await saveSession(next);
      return next;
    } catch (e) {
      // Only a definite "no" signs the person out. No signal is not a no.
      if (e instanceof ApiError && e.status === 401) {
        await clearSession();
        return null;
      }
      return current;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** A signed-in request. Returns null when the session has ended (the caller sends the person to login). */
export async function authed<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  let s = await loadSession();
  if (!s) return null;
  /**
   * Offline (F-13, 13 Oct 2026): a read is answered from the last good copy
   * when there is no signal (lib/net). The token refresh needs signal too, so
   * an expired token offline still gets the copy rather than the sign-in screen.
   */
  const read = !init.method || init.method === 'GET';
  const who = `${s.kind}:${s.profile.id}:${s.storeId ?? ''}`;
  const fromCopy = async (e: unknown) => {
    if (read && isNoSignal(e)) {
      const copy = await lastCopy<T>(who, path);
      if (copy !== null) return copy;
    }
    throw e;
  };
  if (Date.now() >= s.accessExpiresAt) {
    try { s = await refreshSession(s); } catch (e) { return fromCopy(e); }
  }
  if (!s) return null;
  const done = (v: T) => { markOnline(); if (read && v !== null && v !== undefined) void keepCopy(who, path, v); return v; };
  try {
    return done(await raw<T>(path, { ...init, token: s.accessToken, storeId: s.storeId }));
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) return fromCopy(e);
    const again = await refreshSession(s);
    if (!again) return null;
    return done(await raw<T>(path, { ...init, token: again.accessToken, storeId: again.storeId }));
  }
}

/** A request nobody needs to be signed in for - browsing a shop (3 Oct 2026). */
export function openGet<T>(path: string): Promise<T> {
  return raw<T>(path);
}

export async function signOut(): Promise<void> {
  const s = await loadSession();
  /**
   * The push token goes with the logout call (F-05, 10 Oct 2026), so the
   * server knows this phone is empty and strips every word of business detail
   * out of the Urgent alerts it keeps sending here. The alert still rings -
   * being reached is the point of an Urgent alert - it just says only that
   * something is waiting and to sign in.
   *
   * Read BEFORE clearSession and sent after, because the session is gone by
   * the time the request goes out.
   */
  const pushToken = await registeredPushToken().catch(() => null);
  await clearSession();
  // Nothing of this person stays on the phone (F-13).
  await wipeCopies();
  rememberBrand(null);
  if (s) {
    await post('/api/v1/auth/logout', {
      refreshToken: s.refreshToken,
      ...(pushToken ? { pushToken } : {}),
    }).catch(() => undefined);
  }
}

// ------------------------------------------------------------ sign-in calls

interface UserLogin extends TokenPair {
  role: string;
  user: { id: string; fullName: string; username: string; email: string | null; phone: string | null };
}

export interface Me {
  kind: 'user';
  user: { id: string; fullName: string; username: string; email: string | null };
  /** `brand`: the business's colours (servers from 4 Oct 2026). */
  organization: { id: string; name: string; brand?: { primary: string | null; navy: string | null } };
  stores: { id: string; name: string; branchCode: string }[];
  activeStoreId: string | null;
  roles: string[];
  permissions: string[];
  readOnly: boolean;
  home: 'owner' | 'employee';
  /** Settings > Roles > Phone app (servers from 26 Sep 2026 on). */
  app?: AppAccess;
}

/** Who this business user is and what they may do - the website's own rules, from /auth/me. */
export function fetchMe(): Promise<Me | null> {
  return authed<Me>('/api/v1/auth/me');
}

export async function businessLogin(username: string, password: string, deviceToken: string | null): Promise<Session> {
  // The phone's device token goes with the login: an employee may sign in
  // only on the phone paired to them (server/device-trust).
  const r = await raw<UserLogin>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, deviceLabel: deviceLabel() }),
    deviceToken,
  });
  const s: Session = {
    kind: 'user',
    accessToken: r.accessToken,
    refreshToken: r.refreshToken,
    accessExpiresAt: expiryFrom(r.expiresIn),
    destination: r.role,
    profile: { id: r.user.id, name: r.user.fullName, username: r.user.username, phone: r.user.phone, email: r.user.email },
  };
  await saveSession(s);
  // Owner or employee, and which store to work in. A person with one store
  // works in it; with several, the first until they switch. Asked with the
  // new token straight away so the right home opens on the first screen.
  const me = await fetchMe().catch(() => null);
  if (me) rememberBrand(me.organization.brand);
  if (me) {
    const next: Session = {
      ...s,
      home: me.home,
      stores: me.stores,
      permissions: me.permissions,
      app: me.app,
      storeId: me.stores.length === 1 ? me.stores[0].id : me.stores[0]?.id ?? null,
    };
    await saveSession(next);
    return next;
  }
  return s;
}

interface PartyLogin extends TokenPair {
  party: { id: string; firstName: string; lastName: string | null; companyName: string | null; phone: string | null; email: string | null };
  mustReset?: boolean;
}

export interface BusinessChoice { partyId: string; businessName: string; branchName: string }

/** One number, several businesses - the login screen shows these to pick from. */
export class ChooseBusiness extends Error {
  constructor(readonly choices: BusinessChoice[]) { super('Choose a business'); }
}

export async function customerLogin(phone: string, password: string, partyId?: string): Promise<Session> {
  const r = await post<PartyLogin | { chooseBusiness: BusinessChoice[] }>(
    '/api/v1/auth/customer-login', { phone, password, partyId, deviceLabel: deviceLabel() },
  );
  if ('chooseBusiness' in r) throw new ChooseBusiness(r.chooseBusiness);
  const p = r.party;
  const s: Session = {
    kind: 'party',
    accessToken: r.accessToken,
    refreshToken: r.refreshToken,
    accessExpiresAt: expiryFrom(r.expiresIn),
    profile: { id: p.id, name: p.companyName || [p.firstName, p.lastName].filter(Boolean).join(' '), phone: p.phone, email: p.email },
    mustReset: r.mustReset === true,
  };
  await saveSession(s);
  return s;
}

/** Re-read who this business user is (permissions and stores can change on the website). */
export async function refreshMe(): Promise<Session | null> {
  const s = await loadSession();
  if (!s || s.kind !== 'user') return s;
  const me = await fetchMe().catch(() => null);
  if (!me) return s;
  rememberBrand(me.organization.brand);
  const storeId = s.storeId && me.stores.some((x) => x.id === s.storeId) ? s.storeId : me.stores[0]?.id ?? null;
  const next: Session = { ...s, home: me.home, stores: me.stores, permissions: me.permissions, app: me.app, storeId };
  await saveSession(next);
  return next;
}

/**
 * A file upload (multipart) with the session - a job photo or voice note
 * (13 Oct 2026). Its own fetch because `raw` sends JSON: the form must set
 * its own content type with the boundary. Longer timeout: a minute of voice
 * on a weak signal takes a while.
 */
export async function authedUpload<T>(path: string, form: FormData): Promise<T | null> {
  let s = await loadSession();
  if (!s) return null;
  if (Date.now() >= s.accessExpiresAt) s = await refreshSession(s);
  if (!s) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST', body: form, signal: controller.signal,
      headers: { authorization: `Bearer ${s.accessToken}`, ...(s.storeId ? { 'x-store-id': s.storeId } : {}) },
    });
  } catch {
    throw new ApiError('Could not reach the server. Check the connection and try again.', 0);
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (res.status === 413) throw new ApiError('This file is too large to send (the limit is 4 MB).', 413);
  if (!res.ok) throw new ApiError(json.error ?? 'Something went wrong. Please try again.', res.status, json.code);
  return json;
}
