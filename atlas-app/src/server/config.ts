import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import type { AppContext } from './context';
import { LIST_MAX_ROWS } from '@/lib/list-limits';
import { cleanAccess, presetForRole } from '@/lib/app-access';
import {
  CONFIG_ELEMENTS, FLOW_STEPS, FlowConfigError, SURFACES, SURFACE_LABEL,
  elementsFor, flowStep, isSwitchable, validateStep,
  type ConfigElement, type Fallback, type StepSetting, type Surface,
} from '@/lib/config-registry';
import {
  cleanFlow, cleanValues, resolveConfig,
  type ConfigLayer, type ConfigValues, type FlowValues, type ResolvedConfig,
} from '@/lib/config-resolve';

/**
 * Configurability - the server half (F1a, CONFIGURABILITY-SPEC.md).
 *
 * Rules and the key catalogue live in `lib/config-registry.ts` and
 * `lib/config-resolve.ts`, pure, so this file only fetches and writes. Same
 * split as `server/app-access.ts`.
 *
 * THE PHONE SURFACE READS TWO PLACES, AND THAT IS DELIBERATE.
 *
 * `RoleAppAccess`/`UserAppAccess` hold a live client's phone settings. The
 * registry adopted their keys rather than replacing them, so this resolver
 * layers `RoleConfig` ON TOP of `RoleAppAccess` instead of migrating it. A
 * client who has never opened the new screen gets exactly today's behaviour;
 * one who has gets their override. When the contract step folds the old tables
 * in (a later release, AGENTS.md §6) only this file changes.
 */

export class ConfigError extends Error {}

export { FlowConfigError };

// ---------------------------------------------------------------- reading

async function layersFor(userId: string, storeIds: string[]): Promise<{
  client: ConfigLayer;
  roles: ConfigLayer[];
  override: ConfigLayer;
  permissions: string[];
}> {
  const [stores, assignments, overrides, legacyOverrides] = await Promise.all([
    db.storeConfig.findMany({
      where: { storeId: { in: storeIds } },
      select: { values: true, flow: true },
    }),
    db.userStoreRole.findMany({
      where: { userId, storeId: { in: storeIds } },
      select: {
        role: {
          select: {
            name: true,
            config: { select: { values: true, flow: true } },
            appAccess: { select: { settings: true } },
            permissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    }),
    db.userConfig.findMany({
      where: { userId, storeId: { in: storeIds } },
      select: { values: true, flow: true },
    }),
    db.userAppAccess.findMany({
      where: { userId, storeId: { in: storeIds } },
      select: { settings: true },
    }),
  ]);

  // Several branches in scope: take the strictest client floor by merging in
  // order. A person who can see two branches must not get the looser one's
  // rules for the stricter one's data.
  const client: ConfigLayer = {
    values: Object.assign({}, ...stores.map((s) => cleanValues(s.values))),
    flow: Object.assign({}, ...stores.map((s) => cleanFlow(s.flow))),
  };

  const roles: ConfigLayer[] = assignments.map((a) => ({
    // Legacy phone settings first, then the new row on top. A role with
    // neither falls back to the preset for its name, exactly as before.
    values: {
      ...cleanValues(a.role.appAccess ? cleanAccess(a.role.appAccess.settings) : presetForRole(a.role.name)),
      ...cleanValues(a.role.config?.values),
    },
    flow: cleanFlow(a.role.config?.flow),
  }));

  const override: ConfigLayer = {
    values: {
      ...Object.assign({}, ...legacyOverrides.map((o) => cleanValues(cleanAccess(o.settings)))),
      ...Object.assign({}, ...overrides.map((o) => cleanValues(o.values))),
    },
    flow: Object.assign({}, ...overrides.map((o) => cleanFlow(o.flow))),
  };

  const permissions = [
    ...new Set(assignments.flatMap((a) => a.role.permissions.map((p) => p.permission.key))),
  ];

  return { client, roles, override, permissions };
}

/** What one person may see and do, across the branches given. */
export async function configForUser(
  userId: string, storeIds: string[], permissions?: Iterable<string>, surface?: Surface,
): Promise<ResolvedConfig> {
  const l = await layersFor(userId, storeIds);
  return resolveConfig({
    client: l.client,
    roles: l.roles,
    override: l.override,
    permissions: permissions ?? l.permissions,
    surface,
  });
}

/** The website's usual entry point. */
export async function configFor(ctx: AppContext, surface: Surface = 'web'): Promise<ResolvedConfig> {
  const storeIds = ctx.scope.kind === 'single' ? [ctx.scope.storeId] : ctx.stores.map((s) => s.id);
  return configForUser(ctx.user.id, storeIds, ctx.permissions, surface);
}

/**
 * The customer portal's configuration. A customer has no roles and no
 * permissions, so only the business's own setting applies - and the portal's
 * restrictions must hold for them regardless, which is why no owner escape
 * hatch is passed here.
 */
export async function portalConfig(storeId: string): Promise<ResolvedConfig> {
  return storeOnlyConfig(storeId, 'portal');
}

/**
 * The business's own setting for one surface, with no person in the picture.
 *
 * For code that runs below the point where a user is known - a shared resolver
 * like `document-trail.ts`, or the portal, where the viewer is a customer with
 * no roles at all. Deliberately passes no permissions, so an element gated on a
 * permission resolves to off rather than being silently granted.
 */
export async function storeOnlyConfig(storeId: string, surface: Surface): Promise<ResolvedConfig> {
  const row = await db.storeConfig.findUnique({
    where: { storeId }, select: { values: true, flow: true },
  });
  return resolveConfig({
    client: { values: cleanValues(row?.values), flow: cleanFlow(row?.flow) },
    permissions: [],
    surface,
  });
}

export async function storeLabels(storeId: string): Promise<Record<string, { en?: string; hi?: string }>> {
  const row = await db.storeConfig.findUnique({ where: { storeId }, select: { labels: true } });
  const raw = row?.labels;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, { en?: string; hi?: string }> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const en = typeof o.en === 'string' ? o.en : undefined;
    const hi = typeof o.hi === 'string' ? o.hi : undefined;
    if (en || hi) out[k] = { en, hi };
  }
  return out;
}

// ---------------------------------------------------------------- settings screen

export interface ElementRow extends ConfigElement {
  /** The effective value for the scope being edited. */
  value: unknown;
  /** True when nothing is saved at this scope - the value shown is inherited. */
  inherited: boolean;
  /** False when the scope's permissions do not allow it, so the row is greyed. */
  available: boolean;
  /** The client's word for it, when they have set one. */
  customLabel?: string;
}

export interface StepRow {
  key: string;
  label: string;
  hint: string;
  actor: string;
  on: boolean;
  fallback: Fallback;
  switchable: boolean;
  /** Fallbacks a client may pick, `block` excluded. */
  options: Fallback[];
  inherited: boolean;
  delegateTo?: string;
}

export interface ConfigView {
  surfaces: { surface: Surface; label: string; screens: { screen: string; elements: ElementRow[] }[] }[];
  steps: StepRow[];
  /** Total configured away from default - the "X of Y customised" line. */
  customisedCount: number;
}

/** Settings › Customisation, for the business as a whole. */
export async function storeConfigView(scope: StoreScope): Promise<ConfigView> {
  const storeId = scopeForWrite(scope);
  const [row, permRows] = await Promise.all([
    db.storeConfig.findUnique({
      where: { storeId }, select: { values: true, flow: true, labels: true },
    }),
    // Every permission any role in this branch holds: an element nobody could
    // ever use is shown greyed rather than hidden, so a client can see why.
    db.rolePermission.findMany({
      where: { role: { storeId } },
      select: { permission: { select: { key: true } } },
      distinct: ['permissionId'],
    }),
  ]);

  const saved = cleanValues(row?.values);
  const savedFlow = cleanFlow(row?.flow);
  const labels = await storeLabels(storeId);
  const perms = new Set(permRows.map((p) => p.permission.key));

  const surfaces = SURFACES.map((surface) => {
    const elements = elementsFor(surface);
    const screens = [...new Set(elements.map((e) => e.screen))].map((screen) => ({
      screen,
      elements: elements.filter((e) => e.screen === screen).map<ElementRow>((e) => ({
        ...e,
        value: saved[e.key] === undefined ? e.default : saved[e.key],
        inherited: saved[e.key] === undefined,
        available: !e.needs || e.needs.some((p) => perms.has(p)),
        customLabel: labels[e.key]?.en,
      })),
    }));
    return { surface, label: SURFACE_LABEL[surface], screens };
  });

  const steps = FLOW_STEPS.map<StepRow>((s) => {
    const v = savedFlow[s.key];
    return {
      key: s.key,
      label: s.label,
      hint: s.hint,
      actor: s.actor,
      on: v?.on ?? true,
      fallback: v?.fallback ?? s.defaultFallback,
      switchable: isSwitchable(s),
      options: s.fallbacks.filter((f): f is Fallback => f !== 'block'),
      inherited: !v,
      delegateTo: s.delegateTo,
    };
  });

  return {
    surfaces,
    steps,
    customisedCount: Object.keys(saved).length + Object.keys(savedFlow).length,
  };
}

interface SaveInput {
  values?: unknown;
  flow?: unknown;
  labels?: unknown;
}

/**
 * Validate a flow map before it is stored. This is where D16 actually bites:
 * a step switched off without a legal fallback is refused with a sentence the
 * client can act on, not silently accepted and discovered later by a stranded
 * job.
 */
function checkedFlow(raw: unknown): FlowValues {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: FlowValues = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!flowStep(key)) throw new FlowConfigError(`There is no flow step called "${key}".`);
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const on = o.on !== false;
    const step = flowStep(key)!;
    const fallback = (typeof o.fallback === 'string' ? o.fallback : step.defaultFallback) as Fallback;
    const setting: StepSetting = { on, fallback };
    validateStep(key, setting);
    out[key] = setting;
  }
  return out;
}

function checkedLabels(raw: unknown): Record<string, { en?: string; hi?: string }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, { en?: string; hi?: string }> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    // Renaming something the registry does not know would be a label nothing
    // reads - refuse it rather than store a value with no effect.
    if (!CONFIG_ELEMENTS.some((e) => e.key === k) && !flowStep(k)) continue;
    if (!v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    const en = typeof o.en === 'string' ? o.en.trim() : '';
    const hi = typeof o.hi === 'string' ? o.hi.trim() : '';
    if (en || hi) out[k] = { ...(en ? { en } : {}), ...(hi ? { hi } : {}) };
  }
  return out;
}

/**
 * Settings kept in StoreConfig.values by their own pages, not the
 * configurability registry (11 Oct 2026): sales-order stages, required
 * documents. Saving the registry's values must not wipe them.
 */
const OWN_PAGE_KEYS = ['salesOrder.stages', 'attachments.required'];

export async function saveStoreConfig(scope: StoreScope, input: SaveInput, userId: string) {
  const storeId = scopeForWrite(scope);
  const existing = await db.storeConfig.findUnique({ where: { storeId }, select: { values: true } });
  const kept = Object.fromEntries(Object.entries((existing?.values && typeof existing.values === 'object' && !Array.isArray(existing.values)) ? existing.values as Record<string, unknown> : {})
    .filter(([k]) => OWN_PAGE_KEYS.includes(k)));
  const values = { ...cleanValues(input.values), ...kept } as object;
  const flow = checkedFlow(input.flow);
  const labels = checkedLabels(input.labels);

  return db.storeConfig.upsert({
    where: { storeId },
    create: { storeId, values, flow: flow as object, labels, updatedBy: userId },
    update: { values, flow: flow as object, labels, updatedBy: userId },
  });
}

export async function saveRoleConfig(scope: StoreScope, roleId: string, input: SaveInput, userId: string) {
  const role = await db.role.findFirst({
    where: { id: roleId, ...scopeWhere(scope) }, select: { id: true, storeId: true },
  });
  if (!role) throw new ConfigError('That role is not in your branch.');

  const values = cleanValues(input.values);
  const flow = checkedFlow(input.flow);

  return db.roleConfig.upsert({
    where: { roleId },
    create: { storeId: role.storeId, roleId, values, flow: flow as object, updatedBy: userId },
    update: { values, flow: flow as object, updatedBy: userId },
  });
}

export async function saveUserConfig(storeId: string, userId: string, input: SaveInput, byUserId: string) {
  const member = await db.userStoreRole.findFirst({
    where: { userId, storeId }, select: { userId: true },
  });
  if (!member) throw new ConfigError('That person has no role in this branch.');

  const values = cleanValues(input.values);
  const flow = checkedFlow(input.flow);

  // No differences left: drop the row rather than keep an empty override, so
  // "same as their role" is the absence of a row, not a row full of defaults.
  if (!Object.keys(values).length && !Object.keys(flow).length) {
    await db.userConfig.deleteMany({ where: { storeId, userId } });
    return;
  }

  await db.userConfig.upsert({
    where: { storeId_userId: { storeId, userId } },
    create: { storeId, userId, values, flow: flow as object, updatedBy: byUserId },
    update: { values, flow: flow as object, updatedBy: byUserId },
  });
}

// ---------------------------------------------------------------- delegate queue

export interface StepRequestRow {
  id: string;
  stepKey: string;
  stepLabel: string;
  refType: string;
  refId: string;
  note: string | null;
  status: string;
  requestedByName: string;
  assignedToName: string | null;
  createdAt: Date;
}

/**
 * Raise a request for a step this person may no longer take themselves.
 *
 * `needsPermission` is copied from the registry at creation, not read at
 * display time: a later change to the step's `delegateTo` must not orphan rows
 * that are already waiting for somebody.
 */
export async function raiseStepRequest(input: {
  storeId: string;
  stepKey: string;
  refType: string;
  refId: string;
  requestedById: string;
  note?: string | null;
}): Promise<{ id: string }> {
  const step = flowStep(input.stepKey);
  if (!step) throw new ConfigError('That is not a step anyone can be asked to take.');
  if (!step.delegateTo) {
    throw new ConfigError(`"${step.label}" cannot be handed to somebody else.`);
  }

  // One open request per step per document. A technician tapping twice must
  // not put two identical jobs in the store's queue.
  const existing = await db.stepRequest.findFirst({
    where: { storeId: input.storeId, stepKey: input.stepKey, refType: input.refType, refId: input.refId, status: 'open' },
    select: { id: true },
  });
  if (existing) return existing;

  return db.stepRequest.create({
    data: {
      storeId: input.storeId,
      stepKey: input.stepKey,
      refType: input.refType,
      refId: input.refId,
      needsPermission: step.delegateTo,
      requestedById: input.requestedById,
      note: input.note?.trim() || null,
    },
    select: { id: true },
  });
}

export async function listStepRequests(
  scope: StoreScope, opts: { status?: string; permissions?: Iterable<string> } = {},
): Promise<StepRequestRow[]> {
  const perms = opts.permissions ? new Set(opts.permissions) : null;
  const rows = await db.stepRequest.findMany({
    where: {
      ...scopeWhere(scope),
      status: opts.status ?? 'open',
      // Requests route by permission, not by person, so they survive somebody
      // leaving (spec §9 q3).
      ...(perms ? { needsPermission: { in: [...perms] } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
    select: {
      id: true, stepKey: true, refType: true, refId: true, note: true, status: true, createdAt: true,
      requestedBy: { select: { fullName: true } },
      assignedTo: { select: { fullName: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    stepKey: r.stepKey,
    stepLabel: flowStep(r.stepKey)?.label ?? r.stepKey,
    refType: r.refType,
    refId: r.refId,
    note: r.note,
    status: r.status,
    requestedByName: r.requestedBy.fullName,
    assignedToName: r.assignedTo?.fullName ?? null,
    createdAt: r.createdAt,
  }));
}

/** Nothing is deleted: a request is done or cancelled with a reason (AGENTS.md §4). */
export async function closeStepRequest(
  scope: StoreScope, id: string, outcome: 'done' | 'cancelled', userId: string, reason?: string,
) {
  if (outcome === 'cancelled' && !reason?.trim()) {
    throw new ConfigError('Say why this request is being cancelled.');
  }
  const updated = await db.stepRequest.updateMany({
    where: { id, ...scopeWhere(scope), status: 'open' },
    data: {
      status: outcome,
      assignedToId: userId,
      resolvedAt: new Date(),
      reason: outcome === 'cancelled' ? reason!.trim() : null,
    },
  });
  if (updated.count === 0) throw new ConfigError('That request is not open, or not in your branch.');
}

export type { ConfigValues, FlowValues, ResolvedConfig, Surface };
