import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, type StoreScope } from './store-scope';
import { raiseApproval, openApprovalRequest, decideApprovalStep, HierarchyError } from './hierarchy';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

/**
 * Common Hub - Asset Management: laptops, vehicles, tools - what the company
 * owns and who currently has it.
 *
 * "assigned to whom" lives on the Asset row, not derived from history - a
 * single current holder is a real, simple fact, and deriving "who currently
 * holds this" by replaying every history row on every list-screen render
 * would be the aggregate-vs-event class of bug this codebase already avoids
 * elsewhere, in the other direction: the CURRENT state is the fact that
 * changes rarely, and the HISTORY is the append-only log of how it got there.
 */

export class AssetError extends Error {}

export type AssetStatus = 'unassigned' | 'assigned' | 'maintenance' | 'retired';

export interface AssetRow {
  id: string;
  name: string;
  assetType: string;
  serialNumber: string | null;
  purchaseDate: Date | null;
  costPaise: number | null;
  status: AssetStatus;
  assignedToId: string | null;
  assignedToName: string | null;
  notes: string | null;
  isActive: boolean;
}

export async function listAssets(scope: StoreScope): Promise<AssetRow[]> {
  const rows = await db.asset.findMany({
    where: scopeWhere(scope),
    orderBy: { name: 'asc' },
    include: { assignedTo: { select: { fullName: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    assetType: r.assetType,
    serialNumber: r.serialNumber,
    purchaseDate: r.purchaseDate,
    costPaise: r.costPaise,
    status: r.status as AssetStatus,
    assignedToId: r.assignedToId,
    assignedToName: r.assignedTo?.fullName ?? null,
    notes: r.notes,
    isActive: r.isActive,
  }));
}

export async function listAssetHistory(scope: StoreScope, assetId: string) {
  const asset = await db.asset.findFirst({ where: { id: assetId, ...scopeWhere(scope) }, select: { id: true } });
  if (!asset) throw new AssetError('That asset is not in your scope.');

  return db.assetHistoryEntry.findMany({
    where: { assetId },
    orderBy: { at: 'desc' },
  });
}

export interface AssetInput {
  name: string;
  assetType: string;
  serialNumber: string | null;
  purchaseDate: Date | null;
  costPaise: number | null;
  notes: string | null;
}

function validate(input: AssetInput) {
  if (!input.name.trim()) throw new AssetError('Asset name is required.');
  if (!input.assetType.trim()) throw new AssetError('Asset type is required.');
}

export async function createAsset(scope: StoreScope, input: AssetInput) {
  const storeId = scopeForWrite(scope);
  validate(input);

  return db.asset.create({
    data: {
      storeId,
      name: input.name.trim(),
      assetType: input.assetType.trim(),
      serialNumber: input.serialNumber?.trim() || null,
      purchaseDate: input.purchaseDate,
      costPaise: input.costPaise,
      notes: input.notes?.trim() || null,
      history: { create: { action: 'note', note: 'Asset added' } },
    },
  });
}

export async function updateAsset(scope: StoreScope, id: string, input: AssetInput) {
  const storeId = scopeForWrite(scope);
  validate(input);

  const found = await db.asset.findFirst({ where: { id, storeId } });
  if (!found) throw new AssetError('That asset is not in your scope.');

  return db.asset.update({
    where: { id },
    data: {
      name: input.name.trim(),
      assetType: input.assetType.trim(),
      serialNumber: input.serialNumber?.trim() || null,
      purchaseDate: input.purchaseDate,
      costPaise: input.costPaise,
      notes: input.notes?.trim() || null,
    },
  });
}

/** Everyone holding a role in this store - the pool an asset can be assigned to. */
export async function listAssignableUsers(scope: StoreScope) {
  const storeId = scopeForWrite(scope);
  const roles = await db.userStoreRole.findMany({
    where: { storeId },
    distinct: ['userId'],
    select: { user: { select: { id: true, fullName: true } } },
  });
  return roles.map((r) => r.user).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function assignAsset(scope: StoreScope, id: string, userId: string) {
  const storeId = scopeForWrite(scope);
  const asset = await db.asset.findFirst({ where: { id, storeId } });
  if (!asset) throw new AssetError('That asset is not in your scope.');
  if (asset.status === 'retired') throw new AssetError('A retired asset cannot be assigned.');

  const holdsRole = await db.userStoreRole.findFirst({ where: { storeId, userId } });
  if (!holdsRole) throw new AssetError('That person does not have access to this store.');
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true } });

  await db.$transaction([
    db.asset.update({ where: { id }, data: { status: 'assigned', assignedToId: userId } }),
    db.assetHistoryEntry.create({
      data: { assetId: id, action: 'assigned', byUserId: userId, note: `Assigned to ${user.fullName}` },
    }),
  ]);
}

export async function returnAsset(scope: StoreScope, id: string) {
  const storeId = scopeForWrite(scope);
  const asset = await db.asset.findFirst({ where: { id, storeId } });
  if (!asset) throw new AssetError('That asset is not in your scope.');

  await db.$transaction([
    db.asset.update({ where: { id }, data: { status: 'unassigned', assignedToId: null } }),
    db.assetHistoryEntry.create({ data: { assetId: id, action: 'returned' } }),
  ]);
}

export async function setAssetStatus(scope: StoreScope, id: string, status: AssetStatus, note: string | null) {
  const storeId = scopeForWrite(scope);
  const asset = await db.asset.findFirst({ where: { id, storeId } });
  if (!asset) throw new AssetError('That asset is not in your scope.');

  const action = status === 'maintenance' ? 'sent_for_maintenance'
    : status === 'unassigned' && asset.status === 'maintenance' ? 'back_in_service'
      : status === 'retired' ? 'retired' : 'note';

  await db.$transaction([
    db.asset.update({
      where: { id },
      data: {
        status,
        ...(status !== 'assigned' ? { assignedToId: null } : {}),
        ...(status === 'retired' ? { isActive: false } : {}),
      },
    }),
    db.assetHistoryEntry.create({ data: { assetId: id, action, note } }),
  ]);
}

// ---------------------------------------------------------------- batches

export interface AssetBatchRow {
  id: string;
  name: string;
  assetType: string;
  totalQty: number;
  unitCostPaise: number | null;
  purchaseDate: Date | null;
  assetCount: number;
  assignedCount: number;
}

export async function listAssetBatches(scope: StoreScope): Promise<AssetBatchRow[]> {
  const batches = await db.assetBatch.findMany({
    where: scopeWhere(scope),
    orderBy: { createdAt: 'desc' },
    include: { assets: { select: { status: true } } },
  });
  return batches.map((b) => ({
    id: b.id, name: b.name, assetType: b.assetType, totalQty: b.totalQty,
    unitCostPaise: b.unitCostPaise, purchaseDate: b.purchaseDate,
    assetCount: b.assets.length,
    assignedCount: b.assets.filter((a) => a.status === 'assigned').length,
  }));
}

export interface AssetBatchInput {
  name: string;
  assetType: string;
  totalQty: number;
  unitCostPaise: number | null;
  purchaseDate: Date | null;
  notes: string | null;
}

/**
 * Bulk-add identical assets in one go - "50 Dell Laptops" becomes one
 * `AssetBatch` row and 50 real `Asset` rows underneath it, each individually
 * assignable/returnable/retirable exactly like a one-at-a-time asset. The
 * batch is the procurement record; the assets it creates are the same
 * first-class rows every other asset screen already works with.
 */
export async function createAssetBatch(
  scope: StoreScope, input: AssetBatchInput, userId: string,
): Promise<{ id: string }> {
  const storeId = scopeForWrite(scope);
  if (!input.name.trim()) throw new AssetError('Batch name is required.');
  if (!input.assetType.trim()) throw new AssetError('Asset type is required.');
  if (input.totalQty <= 0) throw new AssetError('Quantity must be at least 1.');
  if (input.totalQty > 1000) throw new AssetError('That is more than 1000 units in one batch. Check the number.');

  const batch = await db.assetBatch.create({
    data: {
      storeId,
      name: input.name.trim(),
      assetType: input.assetType.trim(),
      totalQty: input.totalQty,
      unitCostPaise: input.unitCostPaise,
      purchaseDate: input.purchaseDate,
      notes: input.notes?.trim() || null,
      createdBy: userId,
      assets: {
        create: Array.from({ length: input.totalQty }, (_, i) => ({
          storeId,
          name: `${input.name.trim()} #${i + 1}`,
          assetType: input.assetType.trim(),
          purchaseDate: input.purchaseDate,
          costPaise: input.unitCostPaise,
          history: { create: { action: 'note', note: `Added from batch "${input.name.trim()}"` } },
        })),
      },
    },
    select: { id: true },
  });
  return { id: batch.id };
}

// ---------------------------------------------------------- requests & allocation

export interface AssetRequestRow {
  id: string;
  requestedById: string;
  requestedByName: string;
  assetType: string;
  reason: string | null;
  status: string;
  decidedAt: Date | null;
  decisionNote: string | null;
  fulfilledAssetName: string | null;
  createdAt: Date;
}

export async function listAssetRequests(scope: StoreScope, opts: { status?: string } = {}): Promise<AssetRequestRow[]> {
  const rows = await db.assetRequest.findMany({
    where: { ...scopeWhere(scope), ...(opts.status ? { status: opts.status } : {}) },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      requestedBy: { select: { fullName: true } },
      fulfilledAsset: { select: { name: true } },
    },
    take: LIST_MAX_ROWS,
  });
  return rows.map((r) => ({
    id: r.id, requestedById: r.requestedById, requestedByName: r.requestedBy.fullName,
    assetType: r.assetType, reason: r.reason, status: r.status,
    decidedAt: r.decidedAt, decisionNote: r.decisionNote,
    fulfilledAssetName: r.fulfilledAsset?.name ?? null,
    createdAt: r.createdAt,
  }));
}

export async function requestAsset(
  scope: StoreScope, input: { assetType: string; reason: string | null }, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!input.assetType.trim()) throw new AssetError('Say what kind of asset you need.');

  const request = await db.assetRequest.create({
    data: { storeId, requestedById: userId, assetType: input.assetType.trim(), reason: input.reason?.trim() || null },
  });

  await raiseApproval(scope, 'asset_request', request.id, userId);
}

/**
 * Decide a pending request - the same "chain if configured, direct if not"
 * shape as `decideLeaveRequest`. Approving does NOT hand over a real asset;
 * see `fulfillAssetRequest` for that separate step.
 */
export async function decideAssetRequest(
  scope: StoreScope, requestId: string, decision: 'approved' | 'rejected', userId: string, note?: string | null,
): Promise<void> {
  const existing = await db.assetRequest.findFirst({ where: { id: requestId, ...scopeWhere(scope) } });
  if (!existing) throw new AssetError('Request not found in your scope.');
  if (existing.status !== 'pending') throw new AssetError(`That request was already ${existing.status}.`);

  const openRequest = await openApprovalRequest(scope, 'asset_request', existing.id);

  if (openRequest) {
    let step;
    try {
      step = await decideApprovalStep(scope, openRequest.id, decision, userId, note?.trim() || null);
    } catch (e) {
      if (e instanceof HierarchyError) throw new AssetError(e.message);
      throw e;
    }
    if (step.final === null) return;
    await db.assetRequest.update({
      where: { id: existing.id },
      data: { status: step.final === 'APPROVED' ? 'approved' : 'rejected', decidedBy: userId, decidedAt: new Date(), decisionNote: note?.trim() || null },
    });
    return;
  }

  await db.assetRequest.update({
    where: { id: existing.id },
    data: { status: decision, decidedBy: userId, decidedAt: new Date(), decisionNote: note?.trim() || null },
  });
}

/** Allocate an EXISTING unassigned asset against an approved request - assigns it and closes the request in one step. */
export async function fulfillAssetRequestWithExisting(scope: StoreScope, requestId: string, assetId: string, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const request = await db.assetRequest.findFirst({ where: { id: requestId, storeId } });
  if (!request) throw new AssetError('Request not found in your scope.');
  if (request.status !== 'approved') throw new AssetError('Only an approved request can be fulfilled.');

  const asset = await db.asset.findFirst({ where: { id: assetId, storeId } });
  if (!asset) throw new AssetError('That asset is not in your scope.');
  if (asset.status === 'assigned') throw new AssetError('That asset is already assigned to someone.');
  if (asset.status === 'retired') throw new AssetError('A retired asset cannot be assigned.');

  const requester = await db.user.findUniqueOrThrow({ where: { id: request.requestedById }, select: { fullName: true } });

  await db.$transaction([
    db.asset.update({ where: { id: assetId }, data: { status: 'assigned', assignedToId: request.requestedById } }),
    db.assetHistoryEntry.create({
      data: { assetId, action: 'assigned', byUserId: request.requestedById, note: `Assigned to ${requester.fullName} - fulfilling their request` },
    }),
    db.assetRequest.update({ where: { id: requestId }, data: { status: 'fulfilled', fulfilledAssetId: assetId, fulfilledAt: new Date(), fulfilledBy: userId } }),
  ]);
}

/** Allocate a BRAND NEW asset against an approved request, in one step - for when nothing spare exists to hand over. */
export async function fulfillAssetRequestWithNew(
  scope: StoreScope, requestId: string, input: AssetInput, userId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  validate(input);
  const request = await db.assetRequest.findFirst({ where: { id: requestId, storeId } });
  if (!request) throw new AssetError('Request not found in your scope.');
  if (request.status !== 'approved') throw new AssetError('Only an approved request can be fulfilled.');

  const requester = await db.user.findUniqueOrThrow({ where: { id: request.requestedById }, select: { fullName: true } });

  const asset = await db.asset.create({
    data: {
      storeId,
      name: input.name.trim(),
      assetType: input.assetType.trim(),
      serialNumber: input.serialNumber?.trim() || null,
      purchaseDate: input.purchaseDate,
      costPaise: input.costPaise,
      notes: input.notes?.trim() || null,
      status: 'assigned',
      assignedToId: request.requestedById,
      history: {
        create: [
          { action: 'note', note: 'Asset added' },
          { action: 'assigned', byUserId: request.requestedById, note: `Assigned to ${requester.fullName} - fulfilling their request` },
        ],
      },
    },
  });

  await db.assetRequest.update({
    where: { id: requestId },
    data: { status: 'fulfilled', fulfilledAssetId: asset.id, fulfilledAt: new Date(), fulfilledBy: userId },
  });
}

// ---------------------------------------------------------------- dashboard

export interface AssetDashboard {
  total: number;
  assigned: number;
  unassigned: number;
  maintenance: number;
  retired: number;
  totalCostPaise: number;
  pendingRequests: number;
  batchCount: number;
}

export async function getAssetDashboard(scope: StoreScope): Promise<AssetDashboard> {
  // Deliberately not filtered on isActive - a retired asset is set inactive
  // (see setAssetStatus), and a dashboard that hides retired assets can
  // never show how many were retired.
  const [assets, pendingRequests, batchCount] = await Promise.all([
    db.asset.findMany({ where: scopeWhere(scope), select: { status: true, costPaise: true } }),
    db.assetRequest.count({ where: { ...scopeWhere(scope), status: 'pending' } }),
    db.assetBatch.count({ where: scopeWhere(scope) }),
  ]);

  return {
    total: assets.length,
    assigned: assets.filter((a) => a.status === 'assigned').length,
    unassigned: assets.filter((a) => a.status === 'unassigned').length,
    maintenance: assets.filter((a) => a.status === 'maintenance').length,
    retired: assets.filter((a) => a.status === 'retired').length,
    totalCostPaise: assets.reduce((n, a) => n + (a.costPaise ?? 0), 0),
    pendingRequests,
    batchCount,
  };
}
