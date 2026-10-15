import { useEffect, useState } from 'react';
import { loadSession } from './session';

/**
 * What the owner lets this person see and do in the app - Settings > Roles >
 * Phone app on the website (26 Sep 2026). The server sends it with /auth/me
 * and enforces the same rules on every call; the app uses it to show only
 * the tiles and buttons that will work. Re-read on every app open.
 *
 * A server older than this feature sends nothing: then everything is allowed
 * here and the website permissions decide, exactly as before.
 */
export type AccessScope = 'mine' | 'mine_unassigned' | 'branch';

export interface AppAccess {
  home: 'field' | 'website';
  sections: {
    attendance: boolean; complaints: boolean; stock: boolean; leads: boolean; tasks: boolean;
    /** Fittings on their own screen, and the van (2 Oct 2026). A server older
     *  than this sends neither, and both default on - the website's own
     *  permissions still decide, exactly as every other section here. */
    installations: boolean; van: boolean;
  };
  actions: Record<string, boolean>;
  scope: { complaints: AccessScope; leads: AccessScope; tasks: AccessScope };
  hide: { prices: boolean; purchaseRate: boolean; customerPhone: boolean; customerAddress: boolean };
  /**
   * `selfie` is the one flag here that is OFF when the server says nothing.
   * Everything else in this file opens up on an older server, because the
   * website's own permissions still decide. A selfie is the opposite: an
   * unknown answer must not make the app start demanding a photograph
   * (F2.5, D14).
   */
  tracking: { clockIn: boolean; location: boolean; callLog: boolean; selfie: boolean };
  /** How the app looks (13 Oct 2026) - Settings > Roles > Phone app > Layout. An older server sends none: standard. */
  layout: PhoneLayout;
  isOwner: boolean;
}

export interface PhoneLayout {
  preset: 'simple' | 'standard' | 'web';
  filters: { today: boolean; pending: boolean; week: boolean; all: boolean };
  types: { complaints: boolean; installations: boolean };
  schedule: boolean;
  job: { callnav: boolean; photo: boolean; voice: boolean; parts: boolean; items: boolean; visits: boolean; calls: boolean; history: boolean };
  lang: 'hi' | 'en';
  textSize: 'large' | 'normal';
}

export const STANDARD_LAYOUT: PhoneLayout = {
  preset: 'standard',
  filters: { today: true, pending: true, week: false, all: false },
  types: { complaints: true, installations: true },
  schedule: true,
  job: { callnav: true, photo: true, voice: true, parts: true, items: true, visits: true, calls: true, history: true },
  lang: 'en',
  textSize: 'normal',
};

export const OPEN_ACCESS: AppAccess = {
  home: 'field',
  sections: { attendance: true, complaints: true, stock: true, leads: true, tasks: true, installations: true, van: true },
  actions: {},
  scope: { complaints: 'branch', leads: 'branch', tasks: 'branch' },
  hide: { prices: false, purchaseRate: false, customerPhone: false, customerAddress: false },
  tracking: { clockIn: true, location: true, callLog: true, selfie: false },
  layout: STANDARD_LAYOUT,
  isOwner: false,
};

/** An action is allowed unless the owner switched it off (unknown = allowed; the server has the final say). */
export const can = (a: AppAccess, action: string) => a.actions[action] !== false;

export async function loadAccess(): Promise<AppAccess> {
  const s = await loadSession();
  if (!(s?.kind === 'user' && s.app)) return OPEN_ACCESS;
  /**
   * Sections the server has never heard of default to ON, not to undefined.
   *
   * A phone updates before the server it talks to, every time. Reading
   * `sections.installations` straight off an older server's reply gives
   * `undefined`, which is falsy, which silently hides a tab the owner never
   * switched off - and nobody would know to look for it. Spreading the
   * defaults underneath makes an unknown section behave like every other
   * section here: open, with the website's own permissions still deciding.
   */
  return withDefaults(s.app);
}

/** Fill what an older server does not send (sections, layout) with the defaults - see loadAccess. */
export function withDefaults(app: AppAccess): AppAccess {
  return {
    ...app,
    sections: { ...OPEN_ACCESS.sections, ...app.sections },
    layout: app.layout ? { ...STANDARD_LAYOUT, ...app.layout, job: { ...STANDARD_LAYOUT.job, ...app.layout.job } } : STANDARD_LAYOUT,
  };
}

/** The number to dial - shown or not, per the owner's setting. */
export const dialable = (shown: string | null | undefined, hidden?: string | null) => (shown || hidden || '').replace(/[^\d+]/g, '');

/** The settings for a screen - open until loaded, so nothing flickers away that the server allows. */
export function useAccess(): AppAccess {
  const [a, setA] = useState<AppAccess>(OPEN_ACCESS);
  useEffect(() => { void loadAccess().then(setA); }, []);
  return a;
}
