/**
 * THE CONFIGURABILITY REGISTRY - what a client may switch off, rename, or
 * hand to somebody else (F1a, spec 09-documentation/04-roadmap/CONFIGURABILITY-SPEC.md,
 * decisions D15 and D16 in DEVELOPMENT-PLAN.md §1b).
 *
 * WHY A REGISTRY IN CODE AND NOT A TABLE.
 *
 * A table would let a row exist for an element no screen renders, and let a
 * screen render an element no row describes. Both are invisible until a client
 * asks why a switch does nothing. Declared in code, the coverage test
 * (`config-registry-coverage.test.ts`) can hold the two sides together, the
 * same choice `app-access.ts` already made for the phone and F2 makes for sync
 * classes.
 *
 * WHY THE PHONE'S KEYS ARE IMPORTED RATHER THAN REWRITTEN.
 *
 * `lib/app-access.ts` (26 Sep, PHONE-APP-ACCESS-SPEC.md) already got this
 * right for one surface: flat keys, per-role and per-person, only narrows,
 * most-open-role wins, enforced server-side. Vcare's technicians run on it
 * today. So this file ADOPTS those keys as the `phone` surface instead of
 * replacing them - one catalogue, one set of merge rules, and no migration of
 * a live client's phone settings. The expand→contract rule (AGENTS.md §6) is
 * why the old storage stays for now; see `server/config.ts` for the adapter.
 *
 * THE TWO KINDS OF THING IN HERE ARE NOT THE SAME.
 *
 *   ELEMENTS are things you see. Hiding one hides information.
 *   FLOW STEPS are things you do. Hiding one changes who does the work, and a
 *   step switched off with no declared fallback strands the job (D16). That is
 *   the whole reason `FLOW_STEPS` is a separate list with a separate rule and
 *   its own termination test.
 */

import { ACCESS_KEYS, type AccessKey, type AccessValue } from './app-access';

export type Surface = 'web' | 'phone' | 'portal';
export const SURFACES: readonly Surface[] = ['web', 'phone', 'portal'];

export const SURFACE_LABEL: Record<Surface, string> = {
  web: 'Website',
  phone: 'Phone app',
  portal: 'Customer portal',
};

/** How several roles combine. Same three rules as `app-access.ts`. */
export type MergeRule = 'or' | 'hide' | 'rank';

export interface ElementChoice {
  value: string;
  label: string;
}

export interface ConfigElement {
  key: string;
  surface: Surface;
  /** The screen or area it belongs to - how Settings groups the list. */
  screen: string;
  label: string;
  /** What switching it off actually does, in the client's words. */
  hint: string;
  kind: 'bool' | 'choice';
  choices?: ElementChoice[];
  /** Website permissions, any one of which must be held for this to matter. */
  needs?: string[];
  /**
   * `or` - on if any role says on (a capability).
   * `hide` - hidden only if every role says hide (a restriction).
   * `rank` - widest wins, listed narrowest first.
   */
  merge: MergeRule;
  rank?: string[];
  default: AccessValue;
  /** False for elements whose wording is structural and must not be renamed. */
  renamable?: boolean;
}

// ---------------------------------------------------------------- phone

/**
 * The phone surface, adopted wholesale from `ACCESS_KEYS`. `group` becomes
 * `screen` so one settings screen can group all three surfaces the same way.
 */
const PHONE_SCREEN: Record<AccessKey['group'], string> = {
  home: 'Home',
  sections: 'Sections',
  actions: 'Actions',
  scope: 'What they see',
  hide: 'Hidden details',
  tracking: 'Tracking',
  clockin: 'Clock in',
  layout: 'Layout',
};

const PHONE_ELEMENTS: ConfigElement[] = ACCESS_KEYS.map((k) => ({
  key: k.key,
  surface: 'phone' as const,
  screen: PHONE_SCREEN[k.group],
  label: k.label,
  hint: k.hint,
  kind: k.kind,
  choices: k.choices,
  needs: k.needs,
  merge: k.merge,
  rank: k.rank,
  default: k.default,
}));

// ---------------------------------------------------------------- website

/**
 * The website surface. Starts with the restrictions a client has actually
 * asked for; it grows one entry at a time as F1b converts each page, and the
 * coverage test is what stops a page hiding something it never declared.
 */
const WEB_ELEMENTS: ConfigElement[] = [
  {
    key: 'web.show.purchaseRate', surface: 'web', screen: 'Stock and purchase',
    label: 'Show purchase rates', kind: 'bool', merge: 'or', default: true,
    needs: ['stock.view', 'purchase.view'],
    hint: 'Off: cost and supplier rates are blank. What a business pays for its goods is usually its most guarded figure.',
  },
  {
    key: 'web.show.margin', surface: 'web', screen: 'Sales',
    label: 'Show margin and profit columns', kind: 'bool', merge: 'or', default: true,
    hint: 'Off: sales staff see the selling price but not what it earns.',
  },
  {
    key: 'web.show.customerPhone', surface: 'web', screen: 'Customers',
    label: 'Show customer phone numbers', kind: 'bool', merge: 'or', default: true,
    hint: 'Off: call buttons still dial, but the number is never printed on screen or in an export.',
  },
  {
    key: 'web.show.branchSwitcher', surface: 'web', screen: 'Everywhere',
    label: 'Show the branch switcher', kind: 'bool', merge: 'or', default: true,
    hint: 'Off: a person works in one branch only and cannot look at another, even if their role allows it.',
  },
  {
    key: 'web.export', surface: 'web', screen: 'Everywhere',
    label: 'Allow export to CSV / Excel', kind: 'bool', merge: 'or', default: true,
    hint: 'Off: no list can be downloaded. Some businesses want their data to stay in the system.',
  },
  {
    key: 'web.showDocumentTrail', surface: 'web', screen: 'Everywhere',
    label: 'Show the document trail strip', kind: 'bool', merge: 'or', default: true,
    hint: 'The quotation to order to invoice to payment strip across the top of a document.',
  },
];

// ---------------------------------------------------------------- portal

/**
 * The customer portal. NEW - before this, the only configuration a customer
 * had was `Party.portalEnabled`, one boolean for "may log in at all". Every
 * key here is a hole a client asked us to close on 29 Sep.
 *
 * `CUSTOMER_VISIBLE_KINDS` in lib/job-flow.ts already guarantees a challan or
 * an internal cost can never reach a customer's timeline whatever a caller
 * passes. These switches narrow what is left, they do not widen it.
 */
const PORTAL_ELEMENTS: ConfigElement[] = [
  {
    key: 'portal.job.technicianName', surface: 'portal', screen: 'Job',
    label: 'Show the technician’s name', kind: 'bool', merge: 'or', default: true,
    hint: 'Off: the customer sees "a technician" and never who.',
  },
  {
    key: 'portal.job.technicianPhone', surface: 'portal', screen: 'Job',
    label: 'Show the technician’s phone number', kind: 'bool', merge: 'or', default: false,
    hint: 'Off (the default): customers reach the office, not the technician directly.',
  },
  // DELIBERATELY ABSENT: a switch to show a customer the parts used on a job.
  //
  // A customer never sees parts, challans or costs - `CUSTOMER_VISIBLE_KINDS` in
  // lib/job-flow.ts enforces it, and it exists because challans DID leak onto
  // customers' timelines (bug fixed 27 Sep 2026). A switch here would have to
  // WIDEN what a customer sees, and this registry only ever narrows. Offering
  // it would promise a capability the product intends not to have.
  {
    key: 'portal.amounts', surface: 'portal', screen: 'Invoices',
    label: 'Show amounts and what is outstanding', kind: 'bool', merge: 'or', default: true,
    hint: 'Off: the customer sees their invoices listed but no figures - some businesses discuss money only in person.',
  },
  {
    key: 'portal.job.photos', surface: 'portal', screen: 'Job',
    label: 'Show job photos', kind: 'bool', merge: 'or', default: true,
    hint: 'Before / after photos the technician took.',
  },
  {
    key: 'portal.job.timestamps', surface: 'portal', screen: 'Job',
    label: 'Show exact times', kind: 'bool', merge: 'or', default: true,
    hint: 'Off: the customer sees the day, not "arrived 14:42, left 15:10".',
  },
  {
    key: 'portal.job.timeline', surface: 'portal', screen: 'Job',
    label: 'Show the full progress timeline', kind: 'bool', merge: 'or', default: true,
    hint: 'Off: only the current status, no history.',
  },
  {
    key: 'portal.raise', surface: 'portal', screen: 'Home',
    label: 'Customers may raise a complaint', kind: 'bool', merge: 'or', default: true,
    hint: 'Off: complaints come in by phone and the office enters them.',
  },
  {
    key: 'portal.invoices', surface: 'portal', screen: 'Invoices',
    label: 'Customers may see their invoices', kind: 'bool', merge: 'or', default: true,
    hint: 'Their own invoices and what is outstanding.',
  },
  {
    key: 'portal.documents', surface: 'portal', screen: 'Invoices',
    label: 'Customers may download documents', kind: 'bool', merge: 'or', default: true,
    hint: 'PDF of an invoice or a job report.',
  },
  {
    key: 'portal.shop', surface: 'portal', screen: 'Shop',
    label: 'Customers see your shop in their portal', kind: 'bool', merge: 'or', default: true,
    hint: 'Browse your catalogue, make a list and send it for a quote - without registering again.',
  },
];

export const CONFIG_ELEMENTS: readonly ConfigElement[] = [
  ...WEB_ELEMENTS, ...PHONE_ELEMENTS, ...PORTAL_ELEMENTS,
];

const ELEMENT_BY_KEY = new Map(CONFIG_ELEMENTS.map((e) => [e.key, e]));
export const configElement = (key: string) => ELEMENT_BY_KEY.get(key);

export const elementsFor = (surface: Surface) => CONFIG_ELEMENTS.filter((e) => e.surface === surface);

export const DEFAULT_CONFIG: Record<string, AccessValue> =
  Object.fromEntries(CONFIG_ELEMENTS.map((e) => [e.key, e.default]));

// ============================================================ FLOW STEPS

/**
 * WHAT HAPPENS WHEN A STEP IS SWITCHED OFF (D16).
 *
 * Pravin's example on 29 Sep: a technician can raise a parts challan from the
 * phone; a client who does not want that must be able to hide it. But the job
 * still needs its parts issued and costed. So "hidden" is not an answer on its
 * own - a step must say where the work goes instead:
 *
 *   delegate - hidden here, and a request is raised for whoever still holds it.
 *              The work still happens; somebody else does it.
 *   skip     - the flow genuinely tolerates its absence. Nothing replaces it.
 *   block    - the step is load-bearing and may not be hidden from everyone.
 *
 * Without this rule a client switches off a step, jobs stop reaching Closed,
 * and they correctly call it our bug rather than their setting. The
 * termination test in `flow-termination.test.ts` is what makes the rule real:
 * it enumerates every legal configuration and fails the build if any of them
 * can strand a job short of Closed.
 */
export type Fallback = 'delegate' | 'skip' | 'block';

export const FALLBACK_LABEL: Record<Fallback, string> = {
  delegate: 'Somebody else does it',
  skip: 'Skip this step',
  block: 'Cannot be switched off',
};

export interface FlowStep {
  key: string;
  /** Which flow. Only the field job exists today; renewals and purchase follow. */
  flow: 'job';
  label: string;
  hint: string;
  /**
   * Non-transition OPERATIONS this step governs.
   *
   * `actions` are status moves and every one of them must exist in
   * lib/job-flow.ts TRANSITIONS - a test asserts it both ways. But not every
   * step of a job is a status change: raising a parts challan leaves the job
   * exactly where it was. Those belong here, where the gate can still find
   * them and the TRANSITIONS coverage test correctly ignores them.
   *
   * This field exists because `job.challan` shipped with `actions: []`, which
   * made it unreachable by the gate and invisible to every check - the switch
   * saved to the database and nothing read it (found live, 30 Sep 2026).
   */
  operations?: readonly string[];
  /** The `action` names in lib/job-flow.ts TRANSITIONS this step enables. */
  actions: readonly string[];
  /** Which fallbacks a client may choose. `block` alone = not switchable. */
  fallbacks: readonly Fallback[];
  /** Chosen when a client switches the step off without saying more. */
  defaultFallback: Fallback;
  /** Who normally takes it - whose screen loses the button. */
  actor: 'technician' | 'office' | 'customer' | 'approver';
  /** Where the work goes under `delegate`. A permission, not a person, so it survives staff changes. */
  delegateTo?: string;
}

export const FLOW_STEPS: readonly FlowStep[] = [
  {
    key: 'job.accept', flow: 'job', label: 'Technician accepts or declines the job',
    actions: ['accept', 'decline'], actor: 'technician',
    fallbacks: ['delegate', 'skip'], defaultFallback: 'skip',
    delegateTo: 'complaints.edit',
    hint: 'Off with Skip: the office assigns and the job is simply accepted. Some businesses do not ask.',
  },
  {
    key: 'job.bookVisit', flow: 'job', label: 'Technician books the visit',
    actions: ['book_visit'], actor: 'technician',
    fallbacks: ['delegate', 'skip'], defaultFallback: 'delegate',
    delegateTo: 'complaints.edit',
    hint: 'Off with Somebody else: the office schedules every visit. The technician sees the time, does not set it.',
  },
  {
    key: 'job.onTheWay', flow: 'job', label: '“On the way”',
    actions: ['on_the_way'], actor: 'technician',
    fallbacks: ['skip'], defaultFallback: 'skip',
    hint: 'A courtesy step. Off: the technician goes straight to Working on site.',
  },
  {
    key: 'job.onSite', flow: 'job', label: '“Working on site” (location-checked)',
    actions: ['on_site', 'leave_site'], actor: 'technician',
    fallbacks: ['skip'], defaultFallback: 'skip',
    hint: 'Off: no location check and no time on site. The route and the visit record lose their strongest evidence, so switch it off only where GPS is genuinely unusable.',
  },
  {
    key: 'job.challan', flow: 'job', label: 'Technician raises a parts challan',
    // Raising a challan moves no status, so it is an operation, not an action.
    actions: [], operations: ['raise_challan'], actor: 'technician',
    fallbacks: ['delegate', 'block'], defaultFallback: 'delegate',
    delegateTo: 'stock.edit',
    hint: 'Off with Somebody else: the technician taps "Request parts" and the store raises the challan. The parts are still issued and still costed - which is why Skip is not offered.',
  },
  {
    key: 'job.estimate', flow: 'job', label: 'Estimate sent to the customer for approval',
    actions: ['estimate_sent', 'estimate_decided', 'estimate_declined'], actor: 'office',
    fallbacks: ['skip'], defaultFallback: 'skip',
    hint: 'Off: work proceeds without a priced approval step. Used where jobs are covered by a contract.',
  },
  {
    key: 'job.workDone', flow: 'job', label: 'Technician marks the work done',
    actions: ['work_done', 'work_done_confirmed'], actor: 'technician',
    fallbacks: ['delegate'], defaultFallback: 'delegate',
    delegateTo: 'complaints.edit',
    hint: 'Off with Somebody else: the office closes the work off for technicians who do not use the app. Never skippable - a job nobody marks done is never finished.',
  },
  {
    key: 'job.customerConfirm', flow: 'job', label: 'Customer confirms the job is resolved',
    actions: ['confirm', 'not_resolved'], actor: 'customer',
    fallbacks: ['delegate', 'skip'], defaultFallback: 'delegate',
    delegateTo: 'complaints.edit',
    hint: 'Off with Skip: the work done by the technician is enough. Off with Somebody else: the office confirms on the customer’s behalf, which is what already happens for walk-ins.',
  },
  {
    key: 'job.approverClose', flow: 'job', label: 'A manager closes the job',
    actions: ['close', 'send_back'], actor: 'approver',
    fallbacks: ['block'], defaultFallback: 'block',
    hint: 'Cannot be switched off. Something must move a finished job to Closed, or nothing ever completes.',
  },
];

const STEP_BY_KEY = new Map(FLOW_STEPS.map((s) => [s.key, s]));
export const flowStep = (key: string) => STEP_BY_KEY.get(key);

/** A step is switchable when it offers any fallback other than `block`. */
export const isSwitchable = (s: FlowStep) => s.fallbacks.some((f) => f !== 'block');

/** Config keys for a step: whether it is on, and what happens when it is not. */
export const stepOnKey = (key: string) => `flow.${key}.on`;
export const stepFallbackKey = (key: string) => `flow.${key}.fallback`;

export interface StepSetting {
  on: boolean;
  fallback: Fallback;
}

export const DEFAULT_FLOW: Record<string, StepSetting> = Object.fromEntries(
  FLOW_STEPS.map((s) => [s.key, { on: true, fallback: s.defaultFallback }]),
);

export class FlowConfigError extends Error {}

/**
 * Validate one step's setting. Refuses in the client's own words - this text
 * reaches Settings › Customisation, so it must say what to do instead.
 */
export function validateStep(key: string, setting: StepSetting): void {
  const step = STEP_BY_KEY.get(key);
  if (!step) throw new FlowConfigError(`There is no flow step called "${key}".`);
  if (setting.on) return;

  if (!isSwitchable(step)) {
    throw new FlowConfigError(`"${step.label}" cannot be switched off. ${step.hint}`);
  }
  if (!step.fallbacks.includes(setting.fallback)) {
    const offered = step.fallbacks.filter((f) => f !== 'block').map((f) => FALLBACK_LABEL[f]);
    throw new FlowConfigError(
      `"${step.label}" needs to say what happens instead. Choose ${offered.join(' or ')}.`,
    );
  }
}

/**
 * Which transition actions survive a configuration.
 *
 * `skip` removes the step's actions - nobody takes them. `delegate` keeps them,
 * because the work still happens; only whose screen shows the button changes,
 * and that is an actor question settled at the call site, not here. This
 * distinction is exactly what the termination test checks.
 */
export function enabledActions(flow: Record<string, StepSetting>): Set<string> {
  const off = new Set<string>();
  for (const step of FLOW_STEPS) {
    const s = flow[step.key] ?? DEFAULT_FLOW[step.key];
    if (!s.on && s.fallback === 'skip') for (const a of step.actions) off.add(a);
  }
  const all = [...FLOW_STEPS.flatMap((s) => s.actions), ...OFFICE_ALWAYS, ...LEGACY_ACTIONS];
  return new Set(all.filter((a) => !off.has(a)));
}

/**
 * Actions the office keeps whatever is configured, from the TRANSITIONS table's
 * own "office fallback powers" note in lib/job-flow.ts: a business must be able
 * to run without the phone app at all. They are listed here so the termination
 * test cannot accidentally credit a configuration with a path it would not
 * really have.
 */
export const OFFICE_ALWAYS: readonly string[] = [
  'assign', 'cancel', 'office_progress', 'office_done', 'office_work_done', 'reopen',
];

/**
 * Transitions kept for phone builds older than the step they were replaced by
 * (`start`, and the pre-1.0.5 paths noted in lib/app-access.ts). A client's
 * configuration does not reach them: an old handset in the field cannot be
 * reconfigured, and the server still has to accept what it sends.
 */
export const LEGACY_ACTIONS: readonly string[] = ['start'];

/**
 * Every `action` in lib/job-flow.ts TRANSITIONS must be claimed by exactly one
 * of the three lists above. `config-registry-coverage.test.ts` asserts it.
 *
 * This is the same discipline as the store-scope and audit coverage tests: an
 * action nobody classified is an action the termination test silently ignores,
 * which is precisely how a configuration that strands jobs would pass.
 */
export function classifyAction(action: string): 'step' | 'office' | 'legacy' | 'unclassified' {
  if (FLOW_STEPS.some((s) => s.actions.includes(action))) return 'step';
  if (FLOW_STEPS.some((s) => s.operations?.includes(action))) return 'step';
  if (OFFICE_ALWAYS.includes(action)) return 'office';
  if (LEGACY_ACTIONS.includes(action)) return 'legacy';
  return 'unclassified';
}
