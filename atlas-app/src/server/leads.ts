import 'server-only';
import { db } from './db';
import { scopeWhere, scopeForWrite, userInScope, type StoreScope } from './store-scope';
import type { LeadRow } from '@/lib/lead-metrics';

export type { LeadRow } from '@/lib/lead-metrics';
export {
  matchesFilter, summarise, waitingMinutes, filterImpliesClosed,
  CLOSED_ONLY_FILTERS, type LeadFilter,
} from '@/lib/lead-metrics';

export async function listLeads(scope: StoreScope): Promise<LeadRow[]> {
  const [rows, users] = await Promise.all([
    db.lead.findMany({
      where: { ...scopeWhere(scope), archivedAt: null },
      include: {
        stage: { select: { name: true, isGroupHeader: true, isWon: true, isLost: true } },
        dealStage: { select: { name: true } },
        source: { select: { name: true } },
        tags: { select: { tag: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.user.findMany({ where: userInScope(scope), select: { id: true, fullName: true } }),
  ]);

  const userName = new Map(users.map((u) => [u.id, u.fullName]));

  return rows.map((l) => ({
    id: l.id,
    leadCode: l.leadCode,
    businessName: l.businessName,
    displayName: [l.title, l.firstName, l.lastName].filter(Boolean).join(' '),
    mobile: `${l.mobileCc} ${l.mobile}`,
    email: l.email,
    city: l.city,
    state: l.state,
    addressLine1: l.addressLine1,
    stageName: l.stage?.name ?? null,
    stageIsGroupHeader: l.stage?.isGroupHeader ?? false,
    dealStageName: l.dealStage?.name ?? null,
    sourceName: l.source?.name ?? null,
    assignedToUserId: l.assignedToUserId,
    assignedToName: l.assignedToUserId ? userName.get(l.assignedToUserId) ?? null : null,
    assignedAt: l.assignedAt,
    potentialPaise: l.potentialPaise,
    requirement: l.requirement,
    sinceDate: l.sinceDate,
    lastTalkAt: l.lastTalkAt,
    nextActionAt: l.nextActionAt,
    isClosed: l.isClosed,
    isWon: l.stage?.isWon ?? false,
    convertedCustomerId: l.convertedCustomerId,
    convertedAt: l.convertedAt,
    isLost: l.stage?.isLost ?? false,
    createdAt: l.createdAt,
    tags: l.tags.map((t) => t.tag),
  }));
}

async function nextLeadCode(storeId: string): Promise<string> {
  const last = await db.lead.findFirst({
    where: { storeId }, orderBy: { leadCode: 'desc' }, select: { leadCode: true },
  });
  const n = last ? Number(last.leadCode.split('-')[1] ?? 0) + 1 : 1;
  return `LEAD-${String(n).padStart(3, '0')}`;
}

export interface LeadInput {
  businessName: string | null;
  gstin: string | null;
  title: string | null;
  firstName: string;
  lastName: string | null;
  designation: string | null;
  mobile: string;
  altMobile: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  state: string | null;
  city: string | null;
  pincode: string | null;
  refCode: string | null;
  dealStageId: string | null;
  stageId: string | null;
  sourceId: string | null;
  assignedToUserId: string | null;
  requirement: string | null;
  notes: string | null;
  potentialPaise: number;
  lastTalkAt: Date | null;
  nextActionAt: Date | null;
  tags: string[];
  latitude: number | null;
  longitude: number | null;
  locationNote: string | null;
}

export async function createLead(scope: StoreScope, input: LeadInput) {
  const storeId = scopeForWrite(scope);

  const policy = await db.leadPolicy.findUnique({ where: { storeId } });
  const allowDuplicate = policy?.allowDuplicateMobile ?? true;

  const duplicate = await db.lead.findFirst({
    where: { storeId, mobile: input.mobile },
    select: { leadCode: true },
  });

  // Policy-driven, per 02-leads.md §4.8 - reject or warn, configurable.
  if (duplicate && !allowDuplicate) {
    return { lead: null, duplicateOf: duplicate.leadCode, rejected: true as const };
  }

  const { tags, ...rest } = input;

  const lead = await db.lead.create({
    data: {
      storeId,
      leadCode: await nextLeadCode(storeId),
      ...rest,
      tags: { create: tags.map((tag) => ({ tag })) },
    },
  });

  return { lead, duplicateOf: duplicate?.leadCode ?? null, rejected: false as const };
}

/** Round-robin assignment. Rotation state is derived from existing load so it
 *  survives restarts - see 02-leads.md §4.7. */
export async function nextRoundRobinUser(storeId: string): Promise<string | null> {
  const assignments = await db.userStoreRole.findMany({
    where: { storeId }, select: { userId: true }, distinct: ['userId'],
  });
  if (assignments.length === 0) return null;

  const counts = await Promise.all(
    assignments.map(async (a) => ({
      userId: a.userId,
      n: await db.lead.count({ where: { storeId, assignedToUserId: a.userId, isClosed: false } }),
    })),
  );
  counts.sort((a, b) => a.n - b.n);
  return counts[0].userId;
}
