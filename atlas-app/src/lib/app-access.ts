/**
 * What a person sees and may do in the Vcare phone app (26 Sep 2026,
 * spec 09-documentation/04-roadmap/PHONE-APP-ACCESS-SPEC.md).
 *
 * The owner sets it per role (Settings > Roles > Phone app) and can override
 * it per person (Settings > Users > Phone app). Three rules:
 *   1. The app setting only narrows - a switch never shows what the person's
 *      website permissions do not already allow.
 *   2. Several roles: the most open wins.
 *   3. The owner (settings.edit) always gets the full website.
 *
 * Settings are a flat map of keys, so an override is simply the keys a person
 * differs on, and a key added later needs no migration: missing = default.
 * Shared by the server (enforcement), the website (settings screens) and,
 * as a resolved block from /api/v1/auth/me, the phone.
 */

/** 'team' (B4, 11 Oct 2026): mine + everyone who reports to me, at any depth, + unassigned. Complaints, leads and tasks. */
export type AccessScope = 'mine' | 'mine_unassigned' | 'team' | 'branch';
export type ClockAllow = 'store_default' | 'anywhere' | 'zones' | 'zones_or_sites';
export type ClockOutside = 'flag' | 'block';
export type AccessValue = boolean | string;
export type AccessSettings = Record<string, AccessValue>;

import { OWNER_PERMISSION } from './mobile-home';
export { OWNER_PERMISSION };

interface Choice { value: string; label: string }
export interface AccessKey {
  key: string;
  group: 'home' | 'sections' | 'actions' | 'scope' | 'hide' | 'tracking' | 'clockin' | 'layout';
  label: string;
  /** What the phone does - shown under the switch. */
  hint: string;
  kind: 'bool' | 'choice';
  choices?: Choice[];
  /** Website permissions, any one of which must be held for this to take effect. */
  needs?: string[];
  /** Section this belongs to - off with the section. */
  section?: string;
  /** How several roles combine: most open wins, written per kind of switch. */
  merge: 'or' | 'hide' | 'rank';
  /** For rank: the order from narrowest to widest. */
  rank?: string[];
  default: AccessValue;
}

const SCOPES: Choice[] = [
  { value: 'mine', label: 'Only mine' },
  { value: 'mine_unassigned', label: 'Mine + unassigned' },
  { value: 'branch', label: 'Whole branch' },
];
const SCOPE_RANK = ['mine', 'mine_unassigned', 'team', 'branch'];
/**
 * Data reach, step 1 (B4, ROLES-DATA-REACH-SPEC, 11 Oct 2026): complaints get
 * "Mine + my team" - a team lead sees their own jobs, their reports' (and
 * theirs, down the chain) and unassigned ones. The reach lives HERE, in the
 * role's existing phone-app setting, rather than a new table: the phone and
 * the website already read it through one function, so they cannot disagree.
 * Step 2 (same day): leads and tasks have it too.
 */
/** Attendance and leave: there is no "unassigned" person, so three steps. */
const PEOPLE_SCOPES: Choice[] = [
  { value: 'mine', label: 'Only mine' },
  { value: 'team', label: 'Mine + my team' },
  { value: 'branch', label: 'Whole branch' },
];
const TEAM_SCOPES: Choice[] = [
  SCOPES[0]!, SCOPES[1]!,
  { value: 'team', label: 'Mine + my team (+ unassigned)' },
  SCOPES[2]!,
];

const COMPLAINTS = ['complaints.view', 'complaints.edit'];
const LEADS = ['leads.view', 'leads.edit', 'leads.create'];
const STOCK = ['stock.view', 'purchase.view', 'purchase.edit'];
const ORDERS = ['orders.view', 'orders.edit'];

export const ACCESS_KEYS: AccessKey[] = [
  {
    key: 'home', group: 'home', label: 'App home', kind: 'choice', merge: 'rank', rank: ['field', 'website'], default: 'field',
    choices: [{ value: 'field', label: 'Field app (tiles)' }, { value: 'website', label: 'Full website' }],
    hint: 'Field app: clock in and the sections below. Full website: the whole website inside the app, as the owner sees it.',
  },

  { key: 'section.attendance', group: 'sections', label: 'Attendance', kind: 'bool', merge: 'or', default: true, hint: 'The clock in / out card on the home screen.' },
  { key: 'section.complaints', group: 'sections', label: 'Complaints', kind: 'bool', merge: 'or', default: true, needs: COMPLAINTS, hint: 'Jobs and site visits.' },
  { key: 'section.stock', group: 'sections', label: 'Stock', kind: 'bool', merge: 'or', default: true, needs: STOCK, hint: 'Scan, look up, receive goods.' },
  { key: 'section.leads', group: 'sections', label: 'Leads', kind: 'bool', merge: 'or', default: true, needs: LEADS, hint: 'Follow-ups and new leads.' },
  { key: 'section.tasks', group: 'sections', label: 'Tasks', kind: 'bool', merge: 'or', default: true, hint: 'Work assigned to them.' },
  // Installations are NOT complaints (2 Oct 2026). A complaint is something
  // that broke; an installation challan is work that was sold. Sharing one
  // list made a technician read past four repairs to find the fitting they
  // were standing outside, which is Pravin's point 3.
  { key: 'section.installations', group: 'sections', label: 'Installations', kind: 'bool', merge: 'or', default: true, needs: ORDERS, hint: 'Fittings to do: the challan, what goes in, scanning each item as it is fitted.' },
  // What the person is carrying. Switched off, the app never mentions a van -
  // which is right for a shop whose technicians draw parts per job.
  { key: 'section.van', group: 'sections', label: 'Van stock', kind: 'bool', merge: 'or', default: true, needs: STOCK, hint: 'What they are carrying, and marking it used on site.' },

  { key: 'action.complaints.jobSteps', group: 'actions', section: 'complaints', label: 'Job steps', kind: 'bool', merge: 'or', default: true, needs: ['complaints.edit'], hint: 'Accept or decline, book visits, on my way, working on site (location-checked), parts challans, work done and the customer\'s code. Switch off only for people who must never work jobs.' },
  { key: 'action.complaints.work', group: 'actions', section: 'complaints', label: 'Older app (1.0.4 and before): Start / Resolved buttons', kind: 'bool', merge: 'or', default: true, needs: ['complaints.edit'], hint: 'Only phones not yet updated to Vcare 1.0.5. The new app uses Job steps above.' },
  // Its own switch (10 Oct 2026, repair flow stage 8) - never folded into Job steps (test-like-live rule).
  { key: 'action.complaints.pickup', group: 'actions', section: 'complaints', label: 'Take items for repair', kind: 'bool', merge: 'or', default: true, needs: ['complaints.edit'], hint: 'Take faulty items from the customer on a pickup receipt (works without signal). They go to the supplier and come back on the same complaint.' },
  { key: 'action.complaints.note', group: 'actions', section: 'complaints', label: 'Add notes', kind: 'bool', merge: 'or', default: true, needs: ['complaints.edit'], hint: 'Write what was done.' },
  { key: 'action.complaints.siteCheckin', group: 'actions', section: 'complaints', label: 'Older app (1.0.4 and before): check in / complete visit', kind: 'bool', merge: 'or', default: true, needs: ['complaints.edit'], hint: 'Only phones not yet updated. In the new app, Working on site is the check-in and Work done completes the visit.' },
  { key: 'action.leads.create', group: 'actions', section: 'leads', label: 'Add new leads', kind: 'bool', merge: 'or', default: true, needs: ['leads.create'], hint: 'New lead form on the phone.' },
  { key: 'action.leads.scanCard', group: 'actions', section: 'leads', label: 'Scan visiting cards', kind: 'bool', merge: 'or', default: true, needs: ['leads.create'], hint: 'Fill a new lead from a photo of the card (AI).' },
  { key: 'action.leads.log', group: 'actions', section: 'leads', label: 'Log calls and follow-ups', kind: 'bool', merge: 'or', default: true, needs: ['leads.edit', 'leads.create'], hint: 'Note how a call went and set the next follow-up.' },
  { key: 'action.stock.lookup', group: 'actions', section: 'stock', label: 'Look up / scan', kind: 'bool', merge: 'or', default: true, needs: STOCK, hint: 'Scan a code or serial to see what it is and where it is.' },
  { key: 'action.stock.receive', group: 'actions', section: 'stock', label: 'Receive goods', kind: 'bool', merge: 'or', default: true, needs: ['purchase.edit'], hint: 'Record a delivery with serials (a goods receipt).' },
  { key: 'action.stock.scanBill', group: 'actions', section: 'stock', label: 'Photograph supplier bill', kind: 'bool', merge: 'or', default: true, needs: ['purchase.edit'], hint: 'Fill the receipt from a photo of the bill (AI).' },
  { key: 'action.tasks.update', group: 'actions', section: 'tasks', label: 'Start / mark done', kind: 'bool', merge: 'or', default: true, hint: 'Move their tasks along.' },

  { key: 'scope.complaints', group: 'scope', section: 'complaints', label: 'Complaints they see', kind: 'choice', choices: TEAM_SCOPES, merge: 'rank', rank: SCOPE_RANK, default: 'branch', hint: 'Mine = assigned to them or with their visit.' },
  { key: 'scope.leads', group: 'scope', section: 'leads', label: 'Leads they see', kind: 'choice', choices: TEAM_SCOPES, merge: 'rank', rank: SCOPE_RANK, default: 'branch', hint: 'Mine = assigned to them.' },
  // B4 step 3 (11 Oct 2026): whose quotations, orders and invoices - by the
  // document's salesperson. Website only (the phone has no sales documents),
  // so no section. Default whole branch: nothing changes until a role is set.
  { key: 'scope.sales', group: 'scope', label: 'Quotations, orders and invoices they see', kind: 'choice', choices: TEAM_SCOPES, merge: 'rank', rank: SCOPE_RANK, default: 'branch', needs: ['quotation.view', 'orders.view', 'invoice.view', 'quotation.create', 'orders.create', 'invoice.create'], hint: 'By the salesperson on the document - lists, counts, exports, search, the Sales dashboard, the customer page and the document itself.' },
  // B4 step 4 (12 Oct 2026): whose attendance and leave a manager sees - for
  // people who may see others' at all (attendance.view). Own is always shown.
  { key: 'scope.people', group: 'scope', label: 'Attendance and leave they see', kind: 'choice', choices: PEOPLE_SCOPES, merge: 'rank', rank: SCOPE_RANK, default: 'branch', needs: ['attendance.view', 'attendance.edit', 'hrm.view', 'hrm.edit'], hint: 'For people who may see the attendance of others: every attendance screen, leave on the grid, the People dashboard and the employee page.' },
  { key: 'scope.tasks', group: 'scope', section: 'tasks', label: 'Tasks they see', kind: 'choice', choices: TEAM_SCOPES, merge: 'rank', rank: SCOPE_RANK, default: 'branch', hint: 'Whole branch also needs the Tasks: edit permission.' },

  { key: 'hide.prices', group: 'hide', label: 'Hide prices and amounts', kind: 'bool', merge: 'hide', default: false, hint: 'No rates, DLP / MRP or cost in stock look-ups.' },
  { key: 'hide.purchaseRate', group: 'hide', label: 'Hide purchase rate when receiving', kind: 'bool', merge: 'hide', default: false, hint: 'Receipts are saved at ₹0 and the office fills in the rate.' },
  { key: 'hide.customerPhone', group: 'hide', label: 'Hide customer phone numbers', kind: 'bool', merge: 'hide', default: false, hint: 'The Call button still dials; the number is never shown.' },
  { key: 'hide.customerAddress', group: 'hide', label: 'Hide customer address', kind: 'bool', merge: 'hide', default: false, hint: 'The Navigate button still works; the address is never shown.' },

  { key: 'track.clockIn', group: 'tracking', label: 'Clock in / out from the app', kind: 'bool', merge: 'or', default: true, hint: 'Off: attendance is marked another way (website, biometric machine).' },
  { key: 'track.location', group: 'tracking', label: 'Location tracking during shift', kind: 'bool', merge: 'or', default: true, hint: 'The route on the Shift Log. Off: only the clock-in and clock-out points.' },
  { key: 'track.selfie', group: 'tracking', label: 'Photo at clock in / out', kind: 'bool', merge: 'or', default: false, hint: 'The phone takes a picture with the front camera when somebody clocks in, stamped with the time and place. A PHOTO, not a face scan - no fingerprint or face data is ever stored.' },
  { key: 'track.callLog', group: 'tracking', label: 'Call-log sync', kind: 'bool', merge: 'or', default: true, hint: 'Calls on the phone appear in Call Logs. Off: calls are not read.' },

  /*
    LAYOUT - HOW THE PHONE LOOKS, NOT ONLY WHAT IT SHOWS (13 Oct 2026, decision
    10, HANDOFF-2026-10-13 section 4.2). Pravin: "customisable from the web, not
    rigid". Per role with a per-person override, like every switch here.
    Simple = the technician app: My work (complaints + installations in one
    list), Schedule, Me - nothing else. Standard = the app as it was before.
    The rest only apply to Simple.
  */
  {
    key: 'layout.preset', group: 'layout', label: 'Phone layout', kind: 'choice', merge: 'rank', rank: ['simple', 'standard', 'web'], default: 'standard',
    choices: [
      { value: 'simple', label: 'Simple - field worker' },
      { value: 'standard', label: 'Standard - every section' },
      { value: 'web', label: 'Full website' },
    ],
    hint: 'Simple: only their jobs (complaints and installations in one list), their visits, and clock in. Big text, Hindi first. Standard: the tiles and screens as before.',
  },
  { key: 'layout.filter.today', group: 'layout', label: 'Filter: Today', kind: 'bool', merge: 'or', default: true, hint: 'Jobs with a visit today, or given to them today.' },
  { key: 'layout.filter.pending', group: 'layout', label: 'Filter: Pending', kind: 'bool', merge: 'or', default: true, hint: 'Every open job not done yet, late ones on top in red.' },
  { key: 'layout.filter.week', group: 'layout', label: 'Filter: This week', kind: 'bool', merge: 'or', default: false, hint: 'Jobs with a visit in the next 7 days.' },
  { key: 'layout.filter.all', group: 'layout', label: 'Filter: All', kind: 'bool', merge: 'or', default: false, hint: 'Everything in their list, in one go.' },
  { key: 'layout.type.complaints', group: 'layout', label: 'Show complaints', kind: 'bool', merge: 'or', default: true, needs: COMPLAINTS, hint: 'Service jobs assigned to them.' },
  { key: 'layout.type.installations', group: 'layout', label: 'Show installations', kind: 'bool', merge: 'or', default: true, needs: ORDERS, hint: 'Installation jobs they are on, in the same list with an "Installation" tag.' },
  { key: 'layout.schedule', group: 'layout', label: 'Schedule screen', kind: 'bool', merge: 'or', default: true, hint: 'Their visits by time - today, then tomorrow.' },
  { key: 'layout.job.callnav', group: 'layout', label: 'Job: Call and Navigate', kind: 'bool', merge: 'or', default: true, hint: 'Big Call and Navigate buttons. "Hide customer phone numbers" still applies.' },
  { key: 'layout.job.photo', group: 'layout', label: 'Job: Photo', kind: 'bool', merge: 'or', default: true, hint: 'Take a photo, saved on the job.' },
  { key: 'layout.job.voice', group: 'layout', label: 'Job: Voice note', kind: 'bool', merge: 'or', default: true, hint: 'Record what was done instead of typing it, saved on the job.' },
  { key: 'layout.job.parts', group: 'layout', label: 'Job: Parts', kind: 'bool', merge: 'or', default: true, hint: 'Parts used, unused parts back, faulty part.' },
  { key: 'layout.job.items', group: 'layout', label: 'Job: Items and serial numbers', kind: 'bool', merge: 'or', default: true, hint: 'The serials on the job.' },
  { key: 'layout.job.visits', group: 'layout', label: 'Job: Earlier visits', kind: 'bool', merge: 'or', default: false, hint: 'Past visits and when they were moved.' },
  { key: 'layout.job.calls', group: 'layout', label: 'Job: Calls with the customer', kind: 'bool', merge: 'or', default: false, hint: 'The call log for this customer.' },
  { key: 'layout.job.history', group: 'layout', label: 'Job: History log', kind: 'bool', merge: 'or', default: false, hint: 'Every change on the job, oldest to newest.' },
  {
    key: 'layout.lang', group: 'layout', label: 'Language', kind: 'choice', merge: 'rank', rank: ['hi', 'en'], default: 'hi',
    choices: [{ value: 'hi', label: 'Hindi' }, { value: 'en', label: 'English' }],
    hint: 'What the app starts in. Each person can still switch on their phone.',
  },
  {
    key: 'layout.textSize', group: 'layout', label: 'Text size', kind: 'choice', merge: 'rank', rank: ['large', 'normal'], default: 'large',
    choices: [{ value: 'large', label: 'Large' }, { value: 'normal', label: 'Normal' }],
    hint: 'Large is easier to read in the sun and on a small phone.',
  },

  {
    key: 'clockin.allow', group: 'clockin', label: 'Clock in from', kind: 'choice', merge: 'rank',
    rank: ['store_default', 'zones', 'zones_or_sites', 'anywhere'], default: 'store_default',
    choices: [
      { value: 'store_default', label: 'Branch setting' },
      { value: 'anywhere', label: 'Anywhere' },
      { value: 'zones', label: 'Office zones only' },
      { value: 'zones_or_sites', label: 'Office zones or job sites' },
    ],
    hint: 'An employee’s own clock-in rule (Attendance config) still wins over this.',
  },
  {
    key: 'clockin.outside', group: 'clockin', label: 'Outside the allowed places', kind: 'choice', merge: 'rank',
    rank: ['block', 'flag'], default: 'flag',
    choices: [{ value: 'flag', label: 'Allow and flag' }, { value: 'block', label: 'Block' }],
    hint: 'Block refuses the clock-in with a sentence the employee can act on.',
  },
];

const BY_KEY = new Map(ACCESS_KEYS.map((k) => [k.key, k]));
export const accessKey = (key: string) => BY_KEY.get(key);

export const DEFAULT_ACCESS: AccessSettings = Object.fromEntries(ACCESS_KEYS.map((k) => [k.key, k.default]));

/** Keep only known keys with a valid value. */
export function cleanAccess(raw: unknown): AccessSettings {
  const out: AccessSettings = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const def = BY_KEY.get(k);
    if (!def) continue;
    if (def.kind === 'bool' && typeof v === 'boolean') out[k] = v;
    if (def.kind === 'choice' && typeof v === 'string' && def.choices!.some((c) => c.value === v)) out[k] = v;
  }
  return out;
}

/**
 * The release-day starting point for a role, from its name (decided 26 Sep:
 * "sensible presets by role name"). Written once as the role's row; editable
 * afterwards. A name matching nothing keeps exactly today's behaviour.
 */
export function presetForRole(name: string): AccessSettings {
  const n = name.toLowerCase();
  const has = (...w: string[]) => w.some((x) => new RegExp(`\\b${x}`).test(n));
  const only = (on: string[]) => Object.fromEntries(
    ['attendance', 'complaints', 'stock', 'leads', 'tasks'].map((s) => [`section.${s}`, on.includes(s)]),
  );

  if (has('technician', 'helper', 'engineer', 'service', 'field')) {
    return {
      ...DEFAULT_ACCESS, ...only(['attendance', 'complaints', 'tasks']),
      'scope.complaints': has('head', 'senior', 'lead', 'supervisor') ? 'mine_unassigned' : 'mine',
      'scope.tasks': 'mine',
      'hide.prices': true, 'hide.purchaseRate': true,
      // The simple field-worker app (13 Oct 2026) for the people doing the work.
      ...(has('head', 'senior', 'lead', 'supervisor') ? {} : { 'layout.preset': 'simple' }),
    };
  }
  if (has('sales', 'marketing', 'telecaller', 'executive')) {
    return { ...DEFAULT_ACCESS, ...only(['attendance', 'leads', 'tasks']), 'scope.leads': 'mine', 'scope.tasks': 'mine' };
  }
  if (has('store', 'stock', 'warehouse', 'inventory', 'godown')) {
    return { ...DEFAULT_ACCESS, ...only(['attendance', 'stock', 'tasks']), 'scope.tasks': 'mine' };
  }
  if (has('admin', 'owner', 'manager', 'gm', 'hod', 'director', 'head', 'accountant')) {
    return { ...DEFAULT_ACCESS, home: 'website' };
  }
  return { ...DEFAULT_ACCESS };
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

export interface ResolvedAccess {
  home: 'field' | 'website';
  sections: Record<'attendance' | 'complaints' | 'stock' | 'leads' | 'tasks' | 'installations' | 'van', boolean>;
  actions: Record<string, boolean>;
  scope: Record<'complaints' | 'leads' | 'tasks' | 'sales' | 'people', AccessScope>;
  hide: Record<'prices' | 'purchaseRate' | 'customerPhone' | 'customerAddress', boolean>;
  tracking: Record<'clockIn' | 'location' | 'callLog' | 'selfie', boolean>;
  clockIn: { allow: ClockAllow; outside: ClockOutside };
  /** How the phone looks (13 Oct 2026). Older phones ignore it. */
  layout: PhoneLayout;
  isOwner: boolean;
  /** The flat values, for the settings screens' "what they see" card. */
  values: AccessSettings;
}

/** Combine several roles' settings - most open wins. */
export function combine(list: AccessSettings[]): AccessSettings {
  if (!list.length) return { ...DEFAULT_ACCESS };
  const out: AccessSettings = {};
  for (const def of ACCESS_KEYS) {
    const vals = list.map((s) => (s[def.key] === undefined ? def.default : s[def.key]));
    if (def.merge === 'or') out[def.key] = vals.some(Boolean);
    else if (def.merge === 'hide') out[def.key] = vals.every(Boolean);
    else {
      const rank = def.rank!;
      out[def.key] = vals.reduce((best, v) => (rank.indexOf(String(v)) > rank.indexOf(String(best)) ? v : best), vals[0]);
    }
  }
  return out;
}

/**
 * Everything the phone may show and do: the roles combined, the person's
 * override applied, then narrowed by website permissions.
 */
export function resolveAccess(
  roles: AccessSettings[], override: AccessSettings, permissions: Iterable<string>,
): ResolvedAccess {
  const perms = new Set(permissions);
  const isOwner = perms.has(OWNER_PERMISSION);
  const v: AccessSettings = { ...combine(roles), ...cleanAccess(override) };

  const allowed = (key: string) => {
    const def = BY_KEY.get(key)!;
    return !def.needs || def.needs.some((p) => perms.has(p));
  };
  const on = (key: string) => v[key] === true && allowed(key);

  const sections = {
    attendance: on('section.attendance'),
    complaints: on('section.complaints'),
    stock: on('section.stock'),
    leads: on('section.leads'),
    tasks: on('section.tasks'),
    installations: on('section.installations'),
    van: on('section.van'),
  };
  const actions: Record<string, boolean> = {};
  for (const def of ACCESS_KEYS.filter((k) => k.group === 'actions')) {
    actions[def.key.slice('action.'.length)] = on(def.key) && sections[def.section as keyof typeof sections];
  }
  const scopeOf = (s: 'complaints' | 'leads' | 'tasks' | 'sales' | 'people'): AccessScope => {
    const want = String(v[`scope.${s}`]) as AccessScope;
    // Seeing every task in the branch has always needed tasks.edit.
    if (s === 'tasks' && want !== 'mine' && !perms.has('tasks.edit')) return 'mine';
    return want;
  };

  return {
    home: isOwner || v.home === 'website' ? 'website' : 'field',
    sections,
    actions,
    scope: { complaints: scopeOf('complaints'), leads: scopeOf('leads'), tasks: scopeOf('tasks'), sales: scopeOf('sales'), people: scopeOf('people') },
    hide: {
      prices: !isOwner && v['hide.prices'] === true,
      purchaseRate: !isOwner && v['hide.purchaseRate'] === true,
      customerPhone: !isOwner && v['hide.customerPhone'] === true,
      customerAddress: !isOwner && v['hide.customerAddress'] === true,
    },
    tracking: {
      clockIn: v['track.clockIn'] === true,
      location: v['track.clockIn'] === true && v['track.location'] === true,
      callLog: v['track.callLog'] === true,
      // Only meaningful for somebody who clocks in from the app at all.
      selfie: v['track.clockIn'] === true && v['track.selfie'] === true,
    },
    clockIn: { allow: String(v['clockin.allow']) as ClockAllow, outside: String(v['clockin.outside']) as ClockOutside },
    layout: layoutOf(v, on, isOwner),
    isOwner,
    values: v,
  };
}

/**
 * The layout block the phone reads. A filter list left empty by the owner
 * falls back to Pending, so the screen never has nothing to show. The owner
 * always gets the full website, as `home` does.
 */
function layoutOf(v: AccessSettings, on: (key: string) => boolean, isOwner: boolean): PhoneLayout {
  const preset = isOwner ? 'web' : (String(v['layout.preset']) as PhoneLayout['preset']);
  const filters = { today: on('layout.filter.today'), pending: on('layout.filter.pending'), week: on('layout.filter.week'), all: on('layout.filter.all') };
  if (!Object.values(filters).some(Boolean)) filters.pending = true;
  return {
    preset,
    filters,
    types: { complaints: on('layout.type.complaints'), installations: on('layout.type.installations') },
    schedule: on('layout.schedule'),
    job: {
      callnav: on('layout.job.callnav'), photo: on('layout.job.photo'), voice: on('layout.job.voice'), parts: on('layout.job.parts'),
      items: on('layout.job.items'), visits: on('layout.job.visits'), calls: on('layout.job.calls'), history: on('layout.job.history'),
    },
    lang: v['layout.lang'] === 'en' ? 'en' : 'hi',
    textSize: v['layout.textSize'] === 'normal' ? 'normal' : 'large',
  };
}

/**
 * Whether a record is in a person's "whose records" scope. `team` is the set
 * of people who report to `me` (server/team-reach `teamIds`); without it a
 * 'team' scope narrows to mine + unassigned - never wider.
 */
export function inScope(scope: AccessScope, assigneeIds: (string | null | undefined)[], me: string, team?: ReadonlySet<string>): boolean {
  const ids = assigneeIds.filter((x): x is string => !!x);
  if (scope === 'branch') return true;
  if (ids.includes(me)) return true;
  if (scope === 'team') return ids.length === 0 || (!!team && ids.some((id) => team.has(id)));
  return scope === 'mine_unassigned' && ids.length === 0;
}

const PHONE_KEYS = new Set(['customerPhone', 'phone', 'mobile', 'altMobile', 'altPhone', 'contactPhone', 'whatsapp']);
const ADDRESS_KEYS = new Set([
  'siteLocation', 'address', 'addressLine1', 'addressLine2', 'billingAddress', 'shippingAddress',
  'deliveryAddress', 'pincode', 'siteAddress',
]);
const isMoneyKey = (k: string) => /Paise$/.test(k) || ['price', 'rate', 'mrp', 'dlp', 'cost', 'amount', 'total'].includes(k);

/**
 * Take hidden details out of a phone response - done once, on the way out of
 * every /api/v1 staff route, so no route can forget. A hidden phone number
 * or address stays usable: it moves to `<key>Dial` / `<key>Navigate`, which
 * the app uses for its Call and Navigate buttons and never shows. Older app
 * versions know neither key, so they show and dial nothing. Coordinates are
 * kept - Navigate needs them and they print nothing on screen.
 */
export function redact<T>(value: T, hide: ResolvedAccess['hide']): T {
  if (!hide.prices && !hide.customerPhone && !hide.customerAddress) return value;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object' || v instanceof Date) return v;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (hide.prices && isMoneyKey(k) && (typeof x === 'number' || typeof x === 'string' || x === null)) continue;
      if (hide.customerPhone && PHONE_KEYS.has(k) && typeof x === 'string') {
        out[k] = '';
        if (x.trim()) out[`${k}Dial`] = x.replace(/[^\d+]/g, '');
        continue;
      }
      if (hide.customerAddress && ADDRESS_KEYS.has(k) && typeof x === 'string') {
        out[k] = '';
        if (x.trim()) out[`${k}Navigate`] = x;
        continue;
      }
      out[k] = walk(x);
    }
    return out;
  };
  return walk(value) as T;
}


/**
 * WHERE EACH PHONE-APP SETTING ACTUALLY COMES FROM (workstream I, 1 Oct 2026).
 *
 * A person's phone access is decided in two places - their ROLE and their own
 * USER override - and the screens showed them separately with no indication of
 * which was winning. An admin would switch something on for the role, see no
 * change for one technician, and have no way to discover that a user override
 * was quietly beating it.
 *
 * This is the explanation, not a new rule: `resolveAccess` already merges the
 * same way (`{ ...combine(roles), ...cleanAccess(override) }` - the override
 * last, so it wins). Both read the same precedence, so the screen cannot
 * describe behaviour the product does not have.
 */
export type AccessSource = 'role' | 'user' | 'default' | 'permission';

export interface AccessOrigin {
  /** What the person actually gets. */
  value: boolean | string;
  source: AccessSource;
  /** One line for the screen, saying why. */
  because: string;
  /** True when a user override is overruling the role - the confusing case. */
  overridesRole: boolean;
}

export function explainAccess(
  key: string,
  roles: AccessSettings[],
  override: AccessSettings,
  permissions: Iterable<string>,
): AccessOrigin {
  const def = BY_KEY.get(key);
  const perms = new Set(permissions);

  if (def?.needs && !def.needs.some((p) => perms.has(p))) {
    /**
     * Checked FIRST, because a missing permission beats every switch. An
     * admin who turns something on for a role and sees nothing happen is
     * usually looking at this, and no amount of toggling will fix it.
     */
    return {
      value: false,
      source: 'permission',
      because: `This person's role does not have the ${def.needs.join(' or ')} permission, `
        + 'so the switch has no effect until that is granted.',
      overridesRole: false,
    };
  }

  const fromRoles = combine(roles);
  const clean = cleanAccess(override);
  const hasOverride = Object.prototype.hasOwnProperty.call(clean, key);

  if (hasOverride) {
    const roleValue = fromRoles[key];
    const differs = roleValue !== undefined && roleValue !== clean[key];
    return {
      value: clean[key] as boolean | string,
      source: 'user',
      because: differs
        ? 'Set for this person, which overrules their role.'
        : 'Set for this person.',
      overridesRole: differs,
    };
  }

  if (Object.prototype.hasOwnProperty.call(fromRoles, key)) {
    return {
      value: fromRoles[key] as boolean | string,
      source: 'role',
      because: roles.length > 1
        ? 'From their roles, combined - any role allowing it is enough.'
        : 'From their role.',
      overridesRole: false,
    };
  }

  return {
    value: (def?.default ?? false) as boolean | string,
    source: 'default',
    because: 'Nobody has set this, so the Atlas default applies.',
    overridesRole: false,
  };
}
