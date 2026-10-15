import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';

/**
 * Common Hub - Terms & Policy: internal policy documents staff can read and
 * acknowledge. Distinct from `TncTemplate`, which is customer-facing boilerplate
 * printed on a quotation.
 */

export class PolicyError extends Error {}

export interface PolicyRow {
  id: string;
  title: string;
  body: string;
  version: number;
  isActive: boolean;
  acknowledgedByMe: boolean;
  acknowledgedCount: number;
  updatedAt: Date;
}

export async function listPolicies(scope: StoreScope, userId: string): Promise<PolicyRow[]> {
  const rows = await db.internalPolicy.findMany({
    where: scopeWhere(scope),
    orderBy: { title: 'asc' },
    include: {
      acknowledgements: { where: { userId } },
      _count: { select: { acknowledgements: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    version: r.version,
    isActive: r.isActive,
    // Only an acknowledgement for the CURRENT version counts - editing the
    // body bumps the version, so a stale ack for v1 must not read as "read".
    acknowledgedByMe: r.acknowledgements.some((a) => a.version === r.version),
    acknowledgedCount: r._count.acknowledgements,
    updatedAt: r.updatedAt,
  }));
}

export interface PolicyInput {
  title: string;
  body: string;
}

function validate(input: PolicyInput) {
  if (!input.title.trim()) throw new PolicyError('Title is required.');
  if (!input.body.trim()) throw new PolicyError('Policy text is required.');
}

export async function createPolicy(scope: StoreScope, input: PolicyInput) {
  const storeId = scopeForWrite(scope);
  validate(input);
  return db.internalPolicy.create({
    data: { storeId, title: input.title.trim(), body: input.body.trim() },
  });
}

/** Editing bumps the version - every past acknowledgement is for a body that no longer exists. */
export async function updatePolicy(scope: StoreScope, id: string, input: PolicyInput) {
  const storeId = scopeForWrite(scope);
  validate(input);

  const found = await db.internalPolicy.findFirst({ where: { id, storeId } });
  if (!found) throw new PolicyError('That policy is not in your scope.');

  return db.internalPolicy.update({
    where: { id },
    data: { title: input.title.trim(), body: input.body.trim(), version: { increment: 1 } },
  });
}

export async function setPolicyActive(scope: StoreScope, id: string, isActive: boolean) {
  const storeId = scopeForWrite(scope);
  const found = await db.internalPolicy.findFirst({ where: { id, storeId } });
  if (!found) throw new PolicyError('That policy is not in your scope.');
  return db.internalPolicy.update({ where: { id }, data: { isActive } });
}

export async function acknowledgePolicy(scope: StoreScope, id: string, userId: string) {
  scopeForWrite(scope);
  const policy = await db.internalPolicy.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!policy) throw new PolicyError('That policy is not in your scope.');

  // Idempotent - clicking twice, or a page reload racing the first click,
  // must not throw a unique-constraint error at the person who read the policy.
  await db.policyAcknowledgement.upsert({
    where: { policyId_userId_version: { policyId: id, userId, version: policy.version } },
    create: { policyId: id, userId, version: policy.version },
    update: {},
  });
}
