/**
 * Resolving a configuration - client, then roles, then the person, narrowed by
 * permissions (F1a, CONFIGURABILITY-SPEC.md §5).
 *
 * Pure, so the server (enforcement), the settings screens (what they see) and
 * the tests all read the same answer. Same split as `lib/app-access.ts`.
 *
 * THE FOUR RULES, IN THIS ORDER. Order is the whole correctness argument:
 *
 *   1. Permissions first, always. A switch can only ever NARROW what a
 *      permission already allows, so an element whose `needs` are unmet is off
 *      no matter what anybody saved. This is what makes it safe to let clients
 *      edit configuration at all.
 *   2. The client's own setting is the floor for everyone in that business.
 *   3. Roles combine most-open-wins, so a person with two roles is not
 *      accidentally locked out by the stricter one.
 *   4. The person's override is last and narrowest.
 *
 * The owner keeps everything. A business that could lock itself out of its own
 * settings would need us to unlock it, which is not a support model.
 */

import { OWNER_PERMISSION, type AccessValue } from './app-access';
import {
  CONFIG_ELEMENTS, DEFAULT_FLOW, FLOW_STEPS, configElement, elementsFor,
  type ConfigElement, type Fallback, type StepSetting, type Surface,
} from './config-registry';

export type ConfigValues = Record<string, AccessValue>;
export type FlowValues = Record<string, StepSetting>;

export interface ConfigLayer {
  values: ConfigValues;
  flow: FlowValues;
}

export const EMPTY_LAYER: ConfigLayer = { values: {}, flow: {} };

/** Keep only known keys carrying a value the registry actually allows. */
export function cleanValues(raw: unknown): ConfigValues {
  const out: ConfigValues = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const def = configElement(k);
    if (!def) continue;
    if (def.kind === 'bool' && typeof v === 'boolean') out[k] = v;
    if (def.kind === 'choice' && typeof v === 'string' && def.choices?.some((c) => c.value === v)) out[k] = v;
  }
  return out;
}

const FALLBACKS: readonly Fallback[] = ['delegate', 'skip', 'block'];

/** Same for flow steps. An unknown step or an illegal fallback is dropped, not guessed. */
export function cleanFlow(raw: unknown): FlowValues {
  const out: FlowValues = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const step = FLOW_STEPS.find((s) => s.key === k);
    if (!step || !v || typeof v !== 'object') continue;
    const o = v as Record<string, unknown>;
    if (typeof o.on !== 'boolean') continue;
    const fb = typeof o.fallback === 'string' && (FALLBACKS as readonly string[]).includes(o.fallback)
      ? (o.fallback as Fallback)
      : step.defaultFallback;
    // A step that cannot be switched off stays on however it was stored - a
    // bad row must not be able to strand jobs.
    if (!o.on && !step.fallbacks.includes(fb)) continue;
    out[k] = { on: o.on, fallback: fb };
  }
  return out;
}

/** Combine several roles' values - most open wins, per the element's own rule. */
export function combineValues(list: ConfigValues[], surface?: Surface): ConfigValues {
  const elements = surface ? elementsFor(surface) : CONFIG_ELEMENTS;
  const out: ConfigValues = {};
  if (!list.length) {
    for (const def of elements) out[def.key] = def.default;
    return out;
  }
  for (const def of elements) {
    const vals = list.map((s) => (s[def.key] === undefined ? def.default : s[def.key]));
    if (def.merge === 'or') out[def.key] = vals.some(Boolean);
    else if (def.merge === 'hide') out[def.key] = vals.every(Boolean);
    else {
      const rank = def.rank ?? [];
      out[def.key] = vals.reduce(
        (best, v) => (rank.indexOf(String(v)) > rank.indexOf(String(best)) ? v : best),
        vals[0],
      );
    }
  }
  return out;
}

/**
 * A flow step is on only if every layer agrees it is on - a restriction, so the
 * `hide` rule rather than `or`. Two roles disagreeing about whether a
 * technician raises challans must not hand the stricter client the looser
 * answer.
 */
export function combineFlow(list: FlowValues[]): FlowValues {
  const out: FlowValues = {};
  for (const step of FLOW_STEPS) {
    const seen = list.map((f) => f[step.key]).filter((x): x is StepSetting => !!x);
    if (!seen.length) { out[step.key] = DEFAULT_FLOW[step.key]; continue; }
    const on = seen.every((s) => s.on);
    const offOne = seen.find((s) => !s.on);
    out[step.key] = { on, fallback: on ? step.defaultFallback : (offOne?.fallback ?? step.defaultFallback) };
  }
  return out;
}

export interface ResolvedConfig {
  /** Every element's effective value, permissions already applied. */
  values: ConfigValues;
  flow: FlowValues;
  isOwner: boolean;
  /** True when this element is on for this person. The reader most code wants. */
  on: (key: string) => boolean;
  /** True when this element is a hidden-restriction that is NOT hiding. */
  shows: (key: string) => boolean;
  /** Whether a flow step is available to the person who normally takes it. */
  stepOn: (key: string) => boolean;
  /** What happens to a switched-off step. */
  stepFallback: (key: string) => Fallback;
}

/**
 * Resolve the layers into one answer.
 *
 * `client` is the business's own setting, `roles` the roles this person holds,
 * `override` their personal one. Later layers narrow earlier ones.
 */
export function resolveConfig(input: {
  client?: ConfigLayer;
  roles?: ConfigLayer[];
  override?: ConfigLayer;
  permissions: Iterable<string>;
  surface?: Surface;
}): ResolvedConfig {
  const perms = new Set(input.permissions);
  const isOwner = perms.has(OWNER_PERMISSION);
  const elements = input.surface ? elementsFor(input.surface) : CONFIG_ELEMENTS;

  const roleValues = (input.roles ?? []).map((r) => cleanValues(r.values));
  const values: ConfigValues = {
    ...combineValues(roleValues.length ? roleValues : [{}], input.surface),
    ...cleanValues(input.client?.values),
    ...cleanValues(input.override?.values),
  };

  const flow = combineFlow([
    ...(input.roles ?? []).map((r) => cleanFlow(r.flow)),
    cleanFlow(input.client?.flow),
    cleanFlow(input.override?.flow),
  ].filter((f) => Object.keys(f).length));

  const allowed = (def: ConfigElement) => !def.needs || def.needs.some((p) => perms.has(p));

  /**
   * ONE POLARITY, ENFORCED BY NAMING: `on(key) === true` ALWAYS MEANS VISIBLE
   * OR ALLOWED.
   *
   * Every key this registry owns is phrased positively - `web.show.*`,
   * `portal.*`, `web.export`. The first draft of this file mixed `hide.*` keys
   * in and needed an inverting read at each call site; that is exactly how a
   * caller writes `!on('hide.phone')` once and leaks a column. Positive keys
   * make the wrong reading look wrong.
   *
   * The phone's inherited `hide.*` keys keep their own meaning inside
   * `lib/app-access.ts` (`resolveAccess().hide`), which is unchanged and is
   * still the reader for them. Nothing here inverts anything.
   */
  const byKey = new Map(elements.map((e) => [e.key, e]));
  const on = (key: string) => {
    const def = byKey.get(key) ?? configElement(key);
    if (!def) return false;
    if (!allowed(def)) return false;
    return values[key] === undefined ? def.default === true : values[key] === true;
  };

  return {
    values,
    flow,
    isOwner,
    on,
    shows: on,
    stepOn: (key: string) => (flow[key] ?? DEFAULT_FLOW[key])?.on ?? true,
    stepFallback: (key: string) =>
      (flow[key] ?? DEFAULT_FLOW[key])?.fallback ?? FLOW_STEPS.find((s) => s.key === key)?.defaultFallback ?? 'skip',
  };
}

/**
 * The label a client uses for something, EN or HI. Renaming reaches prints and
 * exports too (spec §9 q2): a client who calls a challan a "Parts slip" means
 * everywhere, and half-renamed is worse than not renamed at all.
 */
export function label(
  key: string, fallbackLabel: string, labels: Record<string, { en?: string; hi?: string }> | null | undefined,
  lang: 'en' | 'hi' = 'en',
): string {
  const row = labels?.[key];
  const picked = lang === 'hi' ? row?.hi?.trim() || row?.en?.trim() : row?.en?.trim();
  return picked || fallbackLabel;
}
