/**
 * What a client is entitled to (workstream F, 1 Oct 2026).
 *
 * THE PLATFORM OWNER'S HALF OF CONFIGURATION.
 *
 * Everything else in the Vcare roadmap lets a CLIENT configure their own
 * Atlas. This is the layer above: what Pravin, as the owner of the platform,
 * allows each client to have at all - which modules exist for them, how many
 * people may sign in, and whether they are on a trial.
 *
 * It sits ABOVE a client's own settings, not beside them. A client switching
 * a module on in Settings > Role & User Menu cannot grant themselves a module
 * their plan does not include; the platform decision wins and is applied
 * first, in `server/context.ts`, before role and user visibility are even
 * consulted.
 *
 * Pure module - no database - so the catalogue is the same everywhere and a
 * limit can be reasoned about in a test without a tenant.
 */

/**
 * A module is a top-level sidebar group.
 *
 * This WAS the only grain, on the argument that the platform owner sells "do
 * they get HRM" and should never be the person deciding whether one screen
 * inside it is visible. Pravin overruled that on 10 Oct 2026 - "hum har cheez
 * ko hide kar sake as a platform owner" - because the cases are real: HRM
 * without Payroll, Sales without the cost trail, a client who bought the
 * service desk but not manufacturing. Inventing a module for each of those
 * pairs is worse than naming the page.
 *
 * So there are now three grains, coarse to fine, and all three are the
 * platform owner's, applied in `server/context.ts` before the client's own
 * settings are consulted:
 *
 *   SELLABLE_MODULES  - whole sidebar groups. What a plan is made of.
 *   excludedPages     - one page at a time, by route. See NEVER_HIDEABLE
 *                       below and `lib/modules.isPageHidden`.
 *   PLATFORM_FEATURES - a capability that cuts across modules (expiry dates).
 */
export const SELLABLE_MODULES = [
  'Sales',
  'Inventory',
  'Customer Service',
  'Task Manager',
  'Products',
  'Suppliers',
  'Accounts',
  'Purchase',
  'HRM',
  'HRM Configurations',
  'Financial Reports',
  'Common Hub',
  'Reference Data',
] as const;

export type SellableModule = (typeof SELLABLE_MODULES)[number];

/**
 * Never sellable - switching any of these off produces an Atlas nobody can
 * use or administer, and a support call that starts "I cannot log in".
 */
// 'Settings' is the single settings entry since 5 Oct 2026; 'Users & Roles'
// and 'System Settings' stay listed for databases that still carry them.
export const ALWAYS_INCLUDED = ['Dashboard', 'My Desk', 'Settings', 'Users & Roles', 'System Settings', 'Help & Handbook', 'SOP Guidebook'];

/**
 * PAGES THE PLATFORM OWNER MAY NOT HIDE, whatever is stored (10 Oct 2026).
 *
 * The page grain is sharp enough to lock a client out of their own Atlas by
 * accident - hide `/settings/users` and nobody can ever add a user again, and
 * the only person who can undo it is the platform owner, who is not the one
 * on the phone at 9pm. So the same reasoning as ALWAYS_INCLUDED, one level
 * down: the ways in, the ways to administer, and a person's own things.
 *
 * Longest-prefix again, so `/settings` protects every settings screen except
 * the ones named in HIDEABLE_SETTINGS below - a client CAN be sold Atlas
 * without the payroll settings, they cannot be sold Atlas without Settings.
 */
export const NEVER_HIDEABLE: readonly string[] = [
  '/dashboard', '/my', '/employee', '/handbook', '/sop', '/no-access', '/login', '/terms',
  '/settings', '/users', '/profile', '/messages', '/notifications',
];

/**
 * ...except these, which sit under a NEVER_HIDEABLE prefix and are genuinely
 * sellable on their own. Each one is a setup screen for a capability, not a
 * way in or a way to administer.
 */
export const HIDEABLE_SETTINGS: readonly string[] = [
  '/settings/attendance', '/settings/field-jobs', '/settings/incentive', '/settings/user-target',
  '/settings/chart-of-accounts', '/settings/opening-balance', '/settings/period-lock',
  '/settings/custom-fields', '/settings/masters', '/settings/documents', '/settings/employees',
  '/settings/messaging',
];

/** Longest prefix match, shared by the two lists above. */
function matches(path: string, list: readonly string[]): string | null {
  let best: string | null = null;
  for (const p of list) {
    if ((path === p || path.startsWith(`${p}/`)) && (!best || p.length > best.length)) best = p;
  }
  return best;
}

/**
 * May the platform owner switch this page off for a client?
 *
 * Protection wins unless a longer, explicitly hideable prefix beats it - which
 * is how `/settings/attendance` is offered while `/settings/users` is not.
 */
export function isHideable(route: string | null | undefined): boolean {
  if (!route || !route.startsWith('/')) return false;
  const guard = matches(route, NEVER_HIDEABLE);
  if (!guard) return true;
  const allowed = matches(route, HIDEABLE_SETTINGS);
  return !!allowed && allowed.length > guard.length;
}

/** Drops anything stored that may not be hidden - a stale row cannot lock a client out. */
export const resolveExcludedPages = (stored: readonly string[] | null | undefined): string[] =>
  [...new Set(stored ?? [])].filter(isHideable);

/**
 * CAPABILITIES THAT ARE NOT A MODULE (2 Oct 2026).
 *
 * `SELLABLE_MODULES` above deals in sidebar groups, which is the right grain
 * for "do they get HRM". It is the wrong grain for a capability that cuts
 * across modules and is simply inappropriate for most clients.
 *
 * Expiry dates are the first of these. They belong to Products, Inventory,
 * Goods Receipt and the stock reports at once, and they are vital to a chemist
 * and pure noise to a CCTV installer - a box on every product form that 1,339
 * products out of 1,339 will leave blank. Excluding a whole module is far too
 * blunt; a client-side setting is too weak, because the point is that the
 * PLATFORM decides.
 *
 * So: a short, named list. Off by default, every one of them, because a feature
 * that appears for everyone did not need to be here.
 */
export const PLATFORM_FEATURES = [
  {
    id: 'expiry',
    label: 'Expiry dates and shelf life',
    hint: 'Per-product expiry tracking with a reminder before stock goes out of '
      + 'date. For food, chemists, cosmetics, cleaning products - anything that '
      + 'spoils. Adds nothing to a client who sells hardware.',
  },
] as const;

export type PlatformFeatureId = (typeof PLATFORM_FEATURES)[number]['id'];

export const featureById = (id: string) =>
  PLATFORM_FEATURES.find((f) => f.id === id) ?? null;

/**
 * What a tenant's stored feature list actually grants.
 *
 * Unknown ids are dropped rather than passed through. A feature removed from
 * the catalogue leaves its id behind in some tenant's row, and a stale id that
 * silently reads as "on" would switch a half-removed capability back on.
 */
export function resolveFeatures(stored: readonly string[] | null | undefined): PlatformFeatureId[] {
  const known = new Set<string>(PLATFORM_FEATURES.map((f) => f.id));
  return [...new Set(stored ?? [])].filter((id): id is PlatformFeatureId => known.has(id));
}

export interface Plan {
  id: string;
  label: string;
  /** One line for the platform console. */
  hint: string;
  /** Null means no cap. */
  userLimit: number | null;
  /** Modules this plan does NOT include. */
  excludedModules: SellableModule[];
}

/**
 * The catalogue.
 *
 * Deliberately short. A long plan list is a pricing page, and pricing has not
 * been decided - these are the shapes the product actually supports today,
 * and `custom` exists so a client never has to be squeezed into one.
 */
export const PLANS: readonly Plan[] = [
  {
    id: 'full',
    label: 'Full',
    hint: 'Everything Atlas does. What Vcare are on.',
    userLimit: null,
    excludedModules: [],
  },
  {
    id: 'trade',
    label: 'Trade',
    hint: 'Buying, selling and stock. No field service, no HR.',
    userLimit: 25,
    excludedModules: ['Customer Service', 'HRM', 'HRM Configurations'],
  },
  {
    id: 'service',
    label: 'Service',
    hint: 'Field jobs, complaints and people. No purchasing or manufacturing.',
    userLimit: 25,
    excludedModules: ['Purchase', 'Suppliers'],
  },
  {
    id: 'starter',
    label: 'Starter',
    hint: 'Billing, customers and stock for a small shop.',
    userLimit: 5,
    excludedModules: [
      'Customer Service', 'HRM', 'HRM Configurations',
      'Purchase', 'Suppliers', 'Task Manager', 'Common Hub', 'Financial Reports',
    ],
  },
  {
    id: 'custom',
    label: 'Custom',
    hint: 'Set the modules and the user limit by hand. Nothing is assumed.',
    userLimit: null,
    excludedModules: [],
  },
];

export const DEFAULT_PLAN_ID = 'full';

export const planById = (id: string | null | undefined): Plan =>
  PLANS.find((p) => p.id === id) ?? PLANS.find((p) => p.id === DEFAULT_PLAN_ID)!;

export interface Entitlement {
  planId: string;
  planLabel: string;
  userLimit: number | null;
  /** Module names this tenant may not see, whatever their own settings say. */
  excludedModules: string[];
  trialEndsAt: Date | null;
  /** True once a trial end date has passed. */
  trialExpired: boolean;
  /** Cross-module capabilities the platform owner switched on - see above. */
  features: PlatformFeatureId[];
  /**
   * Individual pages switched off for this tenant, as routes (10 Oct 2026).
   * Finer than `excludedModules`; see NEVER_HIDEABLE above for what cannot
   * be switched off at all.
   */
  excludedPages: string[];
}

/**
 * What a tenant actually gets.
 *
 * The stored overrides win over the plan's defaults, so a client on Trade who
 * negotiated HR gets HR without inventing a plan for them. `null` on an
 * override means "use the plan".
 */
export function resolveEntitlement(input: {
  planId: string | null;
  userLimitOverride: number | null;
  excludedModulesOverride: string[] | null;
  trialEndsAt: Date | null;
  enabledFeatures?: readonly string[] | null;
  excludedPages?: readonly string[] | null;
  now?: Date;
}): Entitlement {
  const plan = planById(input.planId);
  const now = input.now ?? new Date();

  const excluded = input.excludedModulesOverride
    ?? [...plan.excludedModules];

  return {
    planId: plan.id,
    planLabel: plan.label,
    userLimit: input.userLimitOverride ?? plan.userLimit,
    // Nothing in ALWAYS_INCLUDED may be excluded, whatever is stored. A plan
    // that hides System Settings leaves a client unable to fix anything.
    excludedModules: excluded.filter((m) => !ALWAYS_INCLUDED.includes(m)),
    trialEndsAt: input.trialEndsAt,
    trialExpired: input.trialEndsAt !== null && input.trialEndsAt.getTime() < now.getTime(),
    features: resolveFeatures(input.enabledFeatures),
    // Filtered through `isHideable`, so a route stored before it was protected
    // - or one that was protected afterwards - cannot shut a client out of
    // their own Settings.
    excludedPages: resolveExcludedPages(input.excludedPages),
  };
}

/** Whether another person may be added. */
export function canAddUser(
  entitlement: Entitlement, currentUsers: number,
): { allowed: boolean; reason?: string } {
  if (entitlement.userLimit === null) return { allowed: true };
  if (currentUsers < entitlement.userLimit) return { allowed: true };
  return {
    allowed: false,
    reason: `This plan allows ${entitlement.userLimit} ${entitlement.userLimit === 1 ? 'person' : 'people'}, `
      + `and ${currentUsers} are already set up. Ask your account manager to raise the limit.`,
  };
}
