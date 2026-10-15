import 'server-only';
import { db } from './db';
import { type StoreScope, scopeForWrite, scopeWhere } from './store-scope';

/**
 * WHO REPORTS TO WHOM, AND WHO APPROVES WHAT.
 *
 * Two questions that look like one and are not.
 *
 * The REPORTING LINE is about people: a manager sees their team's attendance,
 * a leaver's reports have to be moved before the record is closed. It is a
 * single nullable column on the user.
 *
 * The APPROVAL CHAIN is about documents: a sales order over five lakh needs a
 * second signature, and the second signature is a ROLE, not a person. Routing
 * approvals through the reporting line would stall every document the day
 * somebody went on leave, which is why the two are kept apart.
 */

// ------------------------------------------------------------------ the tree

export interface OrgNode {
  id: string;
  fullName: string;
  username: string;
  departmentName: string | null;
  roleNames: string[];
  /** The designation code of this person's most senior role (lowest `level`), or null if none of their roles carry one. */
  designationCode: string | null;
  /** That role's `level` - lower is more senior. Null alongside `designationCode`. */
  level: number | null;
  avatarColor: string | null;
  isActive: boolean;
  reportsToId: string | null;
  /** Everyone under this person, at every depth. */
  reports: OrgNode[];
  /** How many people sit below, at every depth. Cheaper than walking twice. */
  headcount: number;
}

export interface OrgChart {
  /** People with no manager. Usually one; more is legal and worth seeing. */
  roots: OrgNode[];
  /** Everyone, flat, for the assignment dropdowns. */
  everyone: { id: string; fullName: string; departmentName: string | null; reportsToId: string | null }[];
  /** People who report to nobody and have nobody reporting to them. */
  unplaced: number;
}

export async function orgChart(organizationId: string): Promise<OrgChart> {
  const users = await db.user.findMany({
    where: { organizationId },
    orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    select: {
      id: true,
      fullName: true,
      username: true,
      isActive: true,
      reportsToId: true,
      avatarColor: true,
      department: { select: { name: true } },
      storeRoles: { select: { role: { select: { name: true, level: true, designationCode: true } } } },
      // The Team Setup screen's explicit designation, if one is currently
      // assigned - preferred over a permission role's own level/code below,
      // since a person's access role and their org-chart designation are
      // deliberately independent (a "General Manager" designation is not
      // necessarily also their permission role).
      reportingAssignments: {
        where: { effectiveTo: null },
        take: 1,
        select: { designationRole: { select: { level: true, designationCode: true } } },
      },
    },
  });

  const nodes = new Map<string, OrgNode>();
  for (const u of users) {
    const assigned = u.reportingAssignments[0]?.designationRole;

    // Otherwise, the most senior PERMISSION role - lowest `level` - decides
    // the badge shown. A person with neither shows nothing rather than a
    // misleading default.
    const leveled = assigned ?? u.storeRoles
      .map((r) => r.role)
      .filter((r): r is typeof r & { level: number } => r.level !== null)
      .sort((a, b) => a.level - b.level)[0];

    nodes.set(u.id, {
      id: u.id,
      fullName: u.fullName,
      username: u.username,
      departmentName: u.department?.name ?? null,
      roleNames: [...new Set(u.storeRoles.map((r) => r.role.name))].sort(),
      designationCode: leveled?.designationCode ?? null,
      level: leveled?.level ?? null,
      avatarColor: u.avatarColor,
      isActive: u.isActive,
      reportsToId: u.reportsToId,
      reports: [],
      headcount: 0,
    });
  }

  /*
    A CYCLE MUST NOT HANG THE PAGE.

    `setReportsTo` refuses to create one, but a row written before that guard
    existed - or by a migration, or by hand - would otherwise send the walk
    below into an infinite loop and take the request down. A screen that shows
    an org chart is not the place to discover that. Anyone in a cycle is
    treated as a root, which is visibly wrong on screen and therefore fixable,
    rather than invisibly fatal.
  */
  const inCycle = new Set<string>();
  for (const node of nodes.values()) {
    const seen = new Set<string>([node.id]);
    let cursor = node.reportsToId;
    while (cursor) {
      if (seen.has(cursor)) {
        inCycle.add(node.id);
        break;
      }
      seen.add(cursor);
      cursor = nodes.get(cursor)?.reportsToId ?? null;
    }
  }

  const roots: OrgNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.reportsToId && !inCycle.has(node.id) ? nodes.get(node.reportsToId) : undefined;
    if (parent) parent.reports.push(node);
    else roots.push(node);
  }

  const countBelow = (n: OrgNode): number => {
    n.headcount = n.reports.reduce((sum, child) => sum + 1 + countBelow(child), 0);
    return n.headcount;
  };
  roots.forEach(countBelow);

  return {
    roots,
    everyone: users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      departmentName: u.department?.name ?? null,
      reportsToId: u.reportsToId,
    })),
    unplaced: roots.filter((r) => r.reports.length === 0).length,
  };
}

export class HierarchyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HierarchyError';
  }
}

/**
 * Point one person at their manager, or at nobody.
 *
 * The two refusals are both about the same failure: an org chart that cannot
 * be drawn. A person who reports to themselves, or to somebody who already
 * reports to them, produces a loop with no top - and every screen that walks
 * the tree then hangs rather than showing something wrong.
 */
export async function setReportsTo(
  organizationId: string,
  userId: string,
  managerId: string | null,
): Promise<void> {
  const user = await db.user.findFirst({ where: { id: userId, organizationId } });
  if (!user) throw new HierarchyError('User not found.');

  if (managerId === null) {
    await db.user.update({ where: { id: userId }, data: { reportsToId: null } });
    return;
  }

  if (managerId === userId) throw new HierarchyError('Somebody cannot report to themselves.');

  const manager = await db.user.findFirst({ where: { id: managerId, organizationId } });
  if (!manager) throw new HierarchyError('That manager is not in this organisation.');

  // Walk up from the proposed manager. If we meet the person we are assigning,
  // the assignment would close a loop.
  const seen = new Set<string>([managerId]);
  let cursor = manager.reportsToId;
  while (cursor) {
    if (cursor === userId) {
      throw new HierarchyError(
        `${manager.fullName} already reports to ${user.fullName}, directly or through somebody else.`,
      );
    }
    if (seen.has(cursor)) break; // pre-existing loop; refuse to make it worse
    seen.add(cursor);
    cursor = (await db.user.findUnique({ where: { id: cursor }, select: { reportsToId: true } }))?.reportsToId ?? null;
  }

  await db.user.update({ where: { id: userId }, data: { reportsToId: managerId } });
}

// -------------------------------------------------------- the approval chain

export interface ApprovalLevel {
  id: string;
  entityType: string;
  level: number;
  approverRoleId: string;
  approverRoleName: string;
  minAmount: string | null;
  maxAmount: string | null;
}

/**
 * The document types a ROLE-BASED approval chain can be set for on this
 * screen - a fixed list rather than free text, so a typo cannot produce a
 * chain that silently never fires.
 *
 * `leave` / `wfh` / `comp_off` are deliberately NOT here. Until 19 Sep 2026
 * they were - a store could name a role as "level 1" for leave the same way
 * it does for a sales order - but that meant one fixed role approved every
 * requester's leave alike, with no notion of whose manager they actually
 * were. Confirmed as a real gap: a business with a Sales role configured as
 * level 1 saw every leave request route through Sales first regardless of
 * who asked, which reads as "leave approval is department-based" and isn't
 * what anyone wants. Those three now route through `HIERARCHY_ROUTED_ENTITIES`
 * below instead - see `resolveHierarchyApprover`.
 */
export const APPROVAL_ENTITIES = [
  { value: 'sales_order', label: 'Sales Order' },
  { value: 'quotation', label: 'Quotation' },
  { value: 'purchase_bill', label: 'Purchase Bill' },
  { value: 'credit_note', label: 'Credit Note' },
  { value: 'sales_return', label: 'Sales Return' },
] as const;

/**
 * Leave, WFH and comp-off approval - routed through the REQUESTER'S OWN
 * reporting line (`User.reportsToId`, set from Team Setup) rather than a
 * role an admin names once for the whole store. Level 1 is whoever the
 * requester actually reports to, level 2 is that person's own manager, and
 * so on up to whoever sits at the top of that specific chain - typically
 * employee → supervisor → manager → department head → admin/owner, but
 * exactly as many levels as that person's real chain of command has, no
 * more and no less. Nothing to configure here: assign the reporting line in
 * Team Setup and the chain follows automatically.
 */
export const HIERARCHY_ROUTED_ENTITIES = [
  { value: 'leave', label: 'Leave Request' },
  { value: 'wfh', label: 'Work From Home' },
  { value: 'comp_off', label: 'Comp-Off Redemption' },
  // Added with the payroll schema, 19 Sep 2026 - a reimbursement claim or a
  // leave-encashment request is the same shape as a leave request: an
  // employee asking their own chain of command for a yes, not a document a
  // named role signs off on. Not yet raised from anywhere - `raiseApproval`
  // is only called once `ReimbursementClaim`/`LeaveEncashment` get their own
  // request/decide functions, matching how leave/wfh/comp_off were listed
  // here before `attendance.ts`/`leave-types.ts` ever called `raiseApproval`.
  { value: 'reimbursement', label: 'Reimbursement Claim' },
  { value: 'leave_encashment', label: 'Leave Encashment' },
  // Added with the Asset Requests & Allocation workflow, 19 Sep 2026 - "I
  // need a laptop" goes to the requester's own manager first, exactly like
  // leave, not to whoever holds a fixed "IT" role regardless of who asked.
  { value: 'asset_request', label: 'Asset Request' },
  // Added with Offboarding, 19 Sep 2026 - your own manager is exactly who
  // should decide whether to accept a resignation, same reasoning as
  // asset_request, not a fixed "HR" role regardless of who resigned.
  { value: 'resignation', label: 'Resignation' },
  // Added with Leave Allocation Request, 20 Sep 2026 - an employee asking
  // for extra days beyond their normal quota, same "your own manager
  // decides" reasoning as comp_off right above.
  { value: 'leave_allocation', label: 'Leave Allocation Request' },
] as const;

type HierarchyRoutedEntity = (typeof HIERARCHY_ROUTED_ENTITIES)[number]['value'];

function isHierarchyRouted(entityType: string): entityType is HierarchyRoutedEntity {
  return HIERARCHY_ROUTED_ENTITIES.some((e) => e.value === entityType);
}

export interface HierarchyApprover {
  userId: string;
  fullName: string;
  /** True when this person has no manager of their own - the top of THIS requester's chain, whoever that turns out to be. */
  isFinal: boolean;
}

/**
 * Walk UP from `requesterId` exactly `level` hops through `reportsToId` and
 * return whoever is standing there.
 *
 * `level` 1 is the requester's own manager, never the requester - a person
 * does not approve their own leave by being the first node in their own
 * chain. Stops early (returns the last real person found, marked `isFinal`)
 * if the chain runs out before `level` hops, which happens whenever
 * somebody sits fewer than `level` rungs below the top - the common case in
 * a small team, not an error.
 *
 * Cycle-safe for the same reason `orgChart` is: a bad row from before
 * `setReportsTo`'s guard existed must not hang an approval decision.
 */
export async function resolveHierarchyApprover(
  requesterId: string,
  level: number,
): Promise<HierarchyApprover | null> {
  const seen = new Set<string>([requesterId]);
  let cursorId: string = requesterId;

  for (let hop = 0; hop < level; hop++) {
    const cursor = await db.user.findUnique({
      where: { id: cursorId },
      select: { reportsToId: true },
    });
    const nextId: string | null = cursor?.reportsToId ?? null;
    if (!nextId || seen.has(nextId)) {
      // Chain ended (or would cycle) before reaching this many hops - whoever
      // we last stood on, if anyone, is as far as this requester's chain goes.
      if (hop === 0) return null; // requester has no manager at all
      break;
    }
    seen.add(nextId);
    cursorId = nextId;
  }

  if (cursorId === requesterId) return null;

  const person = await db.user.findUnique({
    where: { id: cursorId },
    select: { fullName: true, reportsToId: true },
  });
  if (!person) return null;

  return {
    userId: cursorId,
    fullName: person.fullName,
    isFinal: !person.reportsToId || seen.has(person.reportsToId),
  };
}

export async function listApprovalChain(scope: StoreScope): Promise<ApprovalLevel[]> {
  const rows = await db.approvalChain.findMany({
    where: scopeWhere(scope),
    orderBy: [{ entityType: 'asc' }, { level: 'asc' }],
  });

  const roleIds = [...new Set(rows.map((r) => r.approverRoleId))];
  const roles = roleIds.length
    ? await db.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } })
    : [];
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    level: r.level,
    approverRoleId: r.approverRoleId,
    approverRoleName: roleName.get(r.approverRoleId) ?? 'A role that no longer exists',
    minAmount: r.minAmount === null ? null : r.minAmount.toString(),
    maxAmount: r.maxAmount === null ? null : r.maxAmount.toString(),
  }));
}

export async function addApprovalLevel(
  scope: StoreScope,
  input: { entityType: string; approverRoleId: string; minAmount: number | null; maxAmount: number | null },
): Promise<void> {
  const storeId = scopeForWrite(scope);

  if (!APPROVAL_ENTITIES.some((e) => e.value === input.entityType)) {
    throw new HierarchyError('Unknown document type.');
  }

  const role = await db.role.findFirst({ where: { id: input.approverRoleId, storeId } });
  if (!role) throw new HierarchyError('That role does not belong to this store.');

  if (input.minAmount !== null && input.maxAmount !== null && input.minAmount > input.maxAmount) {
    throw new HierarchyError('The lower limit cannot be above the upper limit.');
  }

  // Levels are consecutive from 1, so the next one is simply one past the last.
  const last = await db.approvalChain.findFirst({
    where: { storeId, entityType: input.entityType },
    orderBy: { level: 'desc' },
    select: { level: true },
  });

  await db.approvalChain.create({
    data: {
      storeId,
      entityType: input.entityType,
      level: (last?.level ?? 0) + 1,
      approverRoleId: input.approverRoleId,
      minAmount: input.minAmount,
      maxAmount: input.maxAmount,
    },
  });
}

/**
 * Remove a level, and close the gap behind it.
 *
 * Levels must stay consecutive. Deleting level 2 of three and leaving 1 and 3
 * would give a document an approval step it can never reach, and it would sit
 * PENDING for ever with nobody able to say why.
 */
export async function removeApprovalLevel(
  scope: StoreScope, id: string, userId: string | null = null,
): Promise<void> {
  const row = await db.approvalChain.findFirst({ where: { id, ...scopeWhere(scope) } });
  if (!row) throw new HierarchyError('Approval level not found in your scope.');

  const pending = await db.approvalRequest.count({
    where: { storeId: row.storeId, entityType: row.entityType, status: 'PENDING' },
  });
  if (pending > 0) {
    throw new HierarchyError(
      `${pending} ${row.entityType.replace('_', ' ')} approval${pending === 1 ? ' is' : 's are'} still waiting on this chain. Decide those first.`,
    );
  }

  /**
   * Tombstoned, not removed (3 Oct 2026). An approval level that resurrects from
   * another machine reinstates an approver somebody took out of the chain, and the
   * levels below it have already closed the gap - so the chain would then have two
   * rows claiming the same level.
   */
  await db.$transaction([
    db.approvalChain.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: userId } }),
    db.approvalChain.updateMany({
      where: {
        storeId: row.storeId, entityType: row.entityType,
        level: { gt: row.level },
        // Only live levels shift up. A tombstoned one keeps the level it had, so
        // the history of the chain still reads correctly.
        deletedAt: null,
      },
      data: { level: { decrement: 1 } },
    }),
  ]);
}

// --------------------------------------------------------- chain execution

/**
 * THE FIRST REAL EXECUTION PATH FOR THIS ENGINE.
 *
 * `ApprovalChain` (config) and `ApprovalRequest` (a walked instance) have
 * existed since the chain-editor screen was built, but until 18 Sep 2026
 * nothing anywhere ever called `db.approvalRequest.create` - every document
 * type, `leave` included, was decided in one step by whoever held the
 * relevant `.edit` permission, with the configured chain sitting unused.
 * This pass only wires up leave/WFH/comp-off - see `attendance.ts` and
 * `leave-types.ts`.
 *
 * Raise, then decide. Both are safe to call even when nothing routes this
 * request: `raiseApproval` returns `null`, and the caller falls back to
 * deciding the document directly, exactly as it did before this file could
 * do anything else. Nobody is locked out of approving leave the day this
 * ships, and a person with nobody above them (the reporting line has no
 * entry for them) is decided the same direct way, not stuck forever.
 */
export async function raiseApproval(
  scope: StoreScope,
  entityType: string,
  entityId: string,
  requestedBy: string,
): Promise<{ id: string } | null> {
  const storeId = scopeForWrite(scope);
  // Approval rules (27 Sep 2026): a saved rule for this type decides - maybe
  // "no approval needed", which approves it right here through the module's
  // own decide function. No rule = the reporting line / role chain below, as
  // before, and the approvers (or the owner) are now told it is waiting.
  const { requestOrApprove } = await import('./approvals');
  const answer = await requestOrApprove(storeId, { type: entityType, entityId, requesterId: requestedBy });
  return !answer.auto && answer.requestId ? { id: answer.requestId } : null;
}

/** The still-open request for one document, if a chain is walking it. */
export async function openApprovalRequest(
  scope: StoreScope,
  entityType: string,
  entityId: string,
): Promise<{ id: string; currentLevel: number } | null> {
  return db.approvalRequest.findFirst({
    where: { ...scopeWhere(scope), entityType, entityId, status: 'PENDING' },
    select: { id: true, currentLevel: true },
  });
}

export interface ApprovalStepResult {
  /** `null` while the chain still has levels left to walk. */
  final: 'APPROVED' | 'REJECTED' | null;
  /** Set when an owner decided outside the route: the line written on the request. */
  overrideNote?: string;
}

/**
 * Decide the CURRENT level of a request - not necessarily the whole thing.
 *
 * Two authorization models, by entity type. `leave`/`wfh`/`comp_off` are
 * HIERARCHY-ROUTED: the decider must be the exact person `resolveHierarchyApprover`
 * names for the request's `currentLevel` in the requester's own reporting
 * line - not a role, a specific human, because that is the whole point of
 * "route it to their actual manager" instead of "route it to whoever holds
 * this role." Everything else is ROLE-based, as it always was: the decider
 * must hold whichever role `ApprovalChain` names for this level in this
 * store. Either way, a blanket `.edit` permission is not enough once a
 * chain is walking a request - that is the entire point of one existing.
 */
export async function decideApprovalStep(
  scope: StoreScope,
  requestId: string,
  decision: 'approved' | 'rejected',
  deciderId: string,
  note: string | null,
): Promise<ApprovalStepResult> {
  const storeId = scopeForWrite(scope);

  const request = await db.approvalRequest.findFirst({ where: { id: requestId, storeId } });
  if (!request) throw new HierarchyError('Approval request not found in your scope.');
  if (request.status !== 'PENDING') {
    throw new HierarchyError(`That request was already ${request.status.toLowerCase()}.`);
  }

  // A saved approval rule for this type decides who approves which level
  // (27 Sep 2026). The routes below remain for types with no rule.
  const { canDecideRuleLevel, afterStep } = await import('./approvals');
  const ruleCheck = await canDecideRuleLevel(request, deciderId);
  if (ruleCheck.ruleBased) {
    const names = ruleCheck.waitingOn.length ? (await namesOf(ruleCheck.waitingOn)).join(' or ') : 'someone else';
    const { verdict } = ruleCheck;
    if (!verdict.ok) {
      // Say the real reason. "Waits on X" for your own document sent people
      // looking at roles when the guard that fired was self-approval.
      throw new HierarchyError(verdict.reason === 'self'
        ? `You raised this yourself, so someone else has to approve it. It waits on ${names}.`
        : `This step waits on ${names}, not you.`);
    }
    if (verdict.override) {
      return ownerOverride(request, decision, deciderId, note, verdict.override, ruleCheck.waitingOn, afterStep);
    }
    const final = decision === 'rejected' ? 'REJECTED' as const : ruleCheck.isLast ? 'APPROVED' as const : null;
    await db.approvalRequest.update({
      where: { id: request.id },
      data: final
        ? { status: final, decidedBy: deciderId, decidedAt: new Date(), note }
        : { currentLevel: { increment: 1 }, note, lastNudgedAt: null, escalatedAt: null },
    });
    await afterStep(request.id, final).catch((e) => console.error('[approvals] notify failed', e));
    return { final };
  }
  const result = await legacyStep(request, decision, deciderId, note, afterStep);
  if (result.overridden) return { final: result.final, overrideNote: result.overrideNote };
  await afterStep(request.id, result.final).catch((e) => console.error('[approvals] notify failed', e));
  return { final: result.final };
}

async function namesOf(ids: string[]): Promise<string[]> {
  return (await db.user.findMany({ where: { id: { in: ids } }, select: { fullName: true } })).map((u) => u.fullName);
}

async function isOwner(storeId: string, userId: string): Promise<boolean> {
  const { ownersOf } = await import('./notify');
  return (await ownersOf(storeId)).includes(userId);
}

type AfterStep = (requestId: string, final: 'APPROVED' | 'REJECTED' | null) => Promise<void>;

/**
 * An owner deciding outside the normal route (4 Oct 2026). Owners sit above
 * every chain, so their word ends the request - it does not hand it on to a
 * next level they could only approve again. The note says plainly who did
 * it and what was stepped past; the audit trigger records it with the row.
 */
async function ownerOverride(
  request: { id: string; currentLevel: number },
  decision: 'approved' | 'rejected',
  deciderId: string,
  note: string | null,
  override: 'self' | 'skipped',
  waitingOnIds: string[],
  afterStep: AfterStep,
): Promise<ApprovalStepResult> {
  const { overrideNote } = await import('@/lib/approval-rules');
  const [me] = await namesOf([deciderId]);
  const waitingOn = (await namesOf(waitingOnIds.filter((id) => id !== deciderId)));
  const mark = overrideNote(override, decision, me ?? 'An owner', request.currentLevel, waitingOn);
  const final = decision === 'approved' ? 'APPROVED' as const : 'REJECTED' as const;
  await db.approvalRequest.update({
    where: { id: request.id },
    data: { status: final, decidedBy: deciderId, decidedAt: new Date(), note: note ? `${mark}. ${note}` : mark },
  });
  await afterStep(request.id, final).catch((e) => console.error('[approvals] notify failed', e));
  return { final, overrideNote: mark };
}

async function legacyStep(
  request: NonNullable<Awaited<ReturnType<typeof db.approvalRequest.findFirst>>>,
  decision: 'approved' | 'rejected',
  deciderId: string,
  note: string | null,
  afterStep: AfterStep,
): Promise<ApprovalStepResult & { overridden?: true }> {
  const storeId = request.storeId;

  // The old routes had no owner override at all, so an owner could decide a
  // sales order under a rule but not under a role chain, nor a leave request
  // whose manager was away. Same treatment everywhere now.
  const override = async (kind: 'self' | 'skipped', waitingOnIds: string[]) => ({
    ...(await ownerOverride(request, decision, deciderId, note, kind, waitingOnIds, afterStep)),
    overridden: true as const,
  });

  if (isHierarchyRouted(request.entityType)) {
    const approver = await resolveHierarchyApprover(request.requestedBy, request.currentLevel);
    if (!approver) {
      // The requester's reporting line was edited out from under a request
      // already in flight - decide it outright rather than leaving it stuck
      // with nobody left to walk to.
      const status = decision === 'approved' ? 'APPROVED' : 'REJECTED';
      await db.approvalRequest.update({
        where: { id: request.id },
        data: { status, decidedBy: deciderId, decidedAt: new Date(), note },
      });
      return { final: status };
    }

    if (deciderId !== approver.userId) {
      if (await isOwner(storeId, deciderId)) {
        return override(deciderId === request.requestedBy ? 'self' : 'skipped', [approver.userId]);
      }
      throw new HierarchyError(deciderId === request.requestedBy
        ? `You raised this yourself, so someone else has to approve it. It waits on ${approver.fullName}.`
        : `This step is waiting on ${approver.fullName}, not you.`);
    }

    if (decision === 'rejected') {
      await db.approvalRequest.update({
        where: { id: request.id },
        data: { status: 'REJECTED', decidedBy: deciderId, decidedAt: new Date(), note },
      });
      return { final: 'REJECTED' };
    }

    if (approver.isFinal) {
      await db.approvalRequest.update({
        where: { id: request.id },
        data: { status: 'APPROVED', decidedBy: deciderId, decidedAt: new Date(), note },
      });
      return { final: 'APPROVED' };
    }

    await db.approvalRequest.update({
      where: { id: request.id },
      data: { currentLevel: { increment: 1 } },
    });
    return { final: null };
  }

  const level = await db.approvalChain.findFirst({
    where: { storeId, entityType: request.entityType, level: request.currentLevel },
  });
  if (!level) {
    // The chain was edited out from under a request already in flight -
    // decide it outright rather than leaving it stuck with no level to walk.
    const status = decision === 'approved' ? 'APPROVED' : 'REJECTED';
    await db.approvalRequest.update({
      where: { id: request.id },
      data: { status, decidedBy: deciderId, decidedAt: new Date(), note },
    });
    return { final: status };
  }

  const holds = await db.userStoreRole.findFirst({
    where: { userId: deciderId, storeId, roleId: level.approverRoleId },
  });
  if (!holds) {
    if (await isOwner(storeId, deciderId)) {
      const holders = await db.userStoreRole.findMany({
        where: { storeId, roleId: level.approverRoleId, user: { isActive: true } }, select: { userId: true },
      });
      return override(deciderId === request.requestedBy ? 'self' : 'skipped', holders.map((h) => h.userId));
    }
    throw new HierarchyError("You do not hold the role this level's approval requires.");
  }

  if (decision === 'rejected') {
    await db.approvalRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED', decidedBy: deciderId, decidedAt: new Date(), note },
    });
    return { final: 'REJECTED' };
  }

  const isLastLevel = !(await db.approvalChain.findFirst({
    where: { storeId, entityType: request.entityType, level: request.currentLevel + 1 },
  }));

  if (isLastLevel) {
    await db.approvalRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', decidedBy: deciderId, decidedAt: new Date(), note },
    });
    return { final: 'APPROVED' };
  }

  await db.approvalRequest.update({
    where: { id: request.id },
    data: { currentLevel: { increment: 1 } },
  });
  return { final: null };
}
