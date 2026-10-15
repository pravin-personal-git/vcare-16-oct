import 'server-only';
import { db } from './db';
import { FLOW_STEPS, flowStep, type Fallback } from '@/lib/config-registry';
import { cleanFlow } from '@/lib/config-resolve';
import type { JobActor } from '@/lib/job-flow';

/**
 * ENFORCING A SWITCHED-OFF FLOW STEP (F1a, decision D16).
 *
 * `lib/job-flow.ts` says which step may follow which. This says whether THIS
 * business still has that step at all, and if not, who does the work instead.
 * Both checks are needed and they are not the same question: the rulebook is
 * the product's, the configuration is the client's.
 *
 * WHY THE STORE'S SETTING AND NOT THE PERSON'S.
 *
 * Whether a step exists in a business is a property of the business. Role and
 * person layers narrow what a given phone *shows* (`server/config.ts`), but a
 * step that the client has delegated to the store room must be refused for
 * every technician, not only the ones whose role happens to say so. Scoping
 * this check per person would make the same job finishable by one technician
 * and not another, which is the kind of inconsistency nobody can debug from a
 * support call.
 *
 * WHY `delegate` REFUSES ONLY THE STEP'S OWN ACTOR.
 *
 * That is what delegation means: the technician loses the button, the store
 * keeps it. Refusing everyone would strand the job - the exact failure the
 * fallback rule exists to prevent - and the termination test would have caught
 * it, which is why that test enumerates configurations rather than trusting
 * this file.
 */

export class FlowGateError extends Error {
  constructor(message: string, readonly stepKey: string, readonly fallback: Fallback) {
    super(message);
    this.name = 'FlowGateError';
  }
}

/** Steps keyed by the transition actions they own, built once. */
/**
 * Both status moves and non-transition operations resolve to their step.
 * Without the operations half, `job.challan` was unreachable through the gate
 * and its switch did nothing at all (found live, 30 Sep 2026).
 */
const STEP_FOR_ACTION = new Map<string, string>([
  ...FLOW_STEPS.flatMap((s) => s.actions.map((a) => [a, s.key] as const)),
  ...FLOW_STEPS.flatMap((s) => (s.operations ?? []).map((a) => [a, s.key] as const)),
]);

export interface FlowConfigForStore {
  /** Whether the step exists in this business. */
  on: (stepKey: string) => boolean;
  fallback: (stepKey: string) => Fallback;
}

export async function flowConfigFor(storeId: string): Promise<FlowConfigForStore> {
  const row = await db.storeConfig.findUnique({ where: { storeId }, select: { flow: true } });
  const flow = cleanFlow(row?.flow);
  return {
    on: (key) => flow[key]?.on ?? true,
    fallback: (key) => flow[key]?.fallback ?? flowStep(key)?.defaultFallback ?? 'skip',
  };
}

/**
 * Refuse an action this business has taken away from this actor.
 *
 * Called after `findTransition` has already agreed the move is legal in
 * principle - so the message can talk about the client's own setting rather
 * than about the rulebook.
 */
export async function assertActionAllowed(
  storeId: string, action: string, actor: JobActor,
): Promise<void> {
  const stepKey = STEP_FOR_ACTION.get(action);
  if (!stepKey) return; // office fallback powers and legacy actions are never gated

  const cfg = await flowConfigFor(storeId);
  if (cfg.on(stepKey)) return;

  const step = flowStep(stepKey)!;
  const fallback = cfg.fallback(stepKey);

  if (fallback === 'skip') {
    throw new FlowGateError(
      `This business does not use the step "${step.label}". Nobody needs to do it.`,
      stepKey, fallback,
    );
  }

  // delegate: only the person who normally takes it loses the button.
  if (actor === step.actor) {
    throw new FlowGateError(
      `In this business somebody else does "${step.label}". Raise a request instead.`,
      stepKey, fallback,
    );
  }
}

/**
 * Whether the person in front of us may take this step - for deciding what to
 * draw, where throwing would be wrong. `null` means yes; a string is the reason
 * to show beside the disabled button.
 */
export async function stepBlockedReason(
  storeId: string, stepKey: string, actor: JobActor,
): Promise<string | null> {
  const step = flowStep(stepKey);
  if (!step) return null;
  const cfg = await flowConfigFor(storeId);
  if (cfg.on(stepKey)) return null;
  if (cfg.fallback(stepKey) === 'skip') return null; // the step simply is not shown
  return actor === step.actor ? `Somebody else does this here.` : null;
}

/** The steps this business has switched off - for a settings summary line. */
export async function switchedOffSteps(storeId: string): Promise<string[]> {
  const cfg = await flowConfigFor(storeId);
  return FLOW_STEPS.filter((s) => !cfg.on(s.key)).map((s) => s.label);
}
