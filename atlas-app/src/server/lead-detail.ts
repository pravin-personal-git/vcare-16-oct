import 'server-only';
import { db } from './db';
import { scopeWhere, type StoreScope } from './store-scope';
import { LIST_MAX_ROWS } from '@/lib/list-limits';

export interface LeadDetail {
  id: string;
  leadCode: string;
  displayName: string;
  businessName: string | null;
  mobile: string;
  email: string | null;
  location: string;
  stageId: string | null;
  stageName: string | null;
  dealStageId: string | null;
  dealStageName: string | null;
  sourceName: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  requirement: string | null;
  potentialPaise: number;
  sinceDate: Date;
  lastTalkAt: Date | null;
  nextActionAt: Date | null;
  isClosed: boolean;
  convertedCustomerId: string | null;
  tags: string[];
  notes: { id: string; body: string; createdAt: Date; author: string | null }[];
  comments: { id: string; body: string; createdAt: Date; author: string | null }[];
  activities: {
    id: string; channel: string; outcome: string | null; note: string | null;
    occurredAt: Date; durationSec: number | null; author: string | null;
  }[];
  channelCounts: Record<string, number>;
  ageDays: number;
  sharedWithPartner: string | null;
  /** Raw, unformatted fields the edit form needs - the fields above are already
   * display-formatted (joined name, "+91 xxxxx" mobile) and stay that way for
   * every other reader of this type. */
  editable: {
    firstName: string;
    lastName: string | null;
    businessName: string | null;
    mobileCc: string;
    mobile: string;
    email: string | null;
    requirement: string | null;
  };
  quotations: {
    id: string;
    quotationNo: string;
    status: string;
    grandTotalPaise: number;
    quotationDate: Date;
  }[];
}

/**
 * Loads everything the drawer needs in one pass.
 * Scoped: a lead outside the caller's stores simply is not found.
 */
export async function getLeadDetail(
  scope: StoreScope,
  leadId: string,
): Promise<LeadDetail | null> {
  const lead = await db.lead.findFirst({
    where: { id: leadId, ...scopeWhere(scope) },
    include: {
      stage: { select: { id: true, name: true } },
      dealStage: { select: { id: true, name: true } },
      source: { select: { name: true } },
      tags: { select: { tag: true } },
      leadNotes: { orderBy: { createdAt: 'desc' } },
      activities: { orderBy: { occurredAt: 'desc' }, take: LIST_MAX_ROWS },
    },
  });
  if (!lead) return null;

  const userIds = new Set<string>();
  if (lead.assignedToUserId) userIds.add(lead.assignedToUserId);
  lead.leadNotes.forEach((n) => n.createdBy && userIds.add(n.createdBy));
  lead.activities.forEach((a) => a.createdBy && userIds.add(a.createdBy));

  const users = await db.user.findMany({
    where: { id: { in: [...userIds] } },
    select: { id: true, fullName: true },
  });
  const name = new Map(users.map((u) => [u.id, u.fullName]));

  const quotations = await db.quotation.findMany({
    where: { leadId, ...scopeWhere(scope) },
    orderBy: { quotationDate: 'desc' },
    select: { id: true, quotationNo: true, status: true, grandTotalPaise: true, quotationDate: true },
  });

  const channelCounts: Record<string, number> = {};
  for (const a of lead.activities) {
    channelCounts[a.channel] = (channelCounts[a.channel] ?? 0) + 1;
  }

  const mapNote = (n: typeof lead.leadNotes[number]) => ({
    id: n.id, body: n.body, createdAt: n.createdAt,
    author: n.createdBy ? name.get(n.createdBy) ?? null : null,
  });

  return {
    id: lead.id,
    leadCode: lead.leadCode,
    displayName: [lead.title, lead.firstName, lead.lastName].filter(Boolean).join(' '),
    businessName: lead.businessName,
    mobile: `${lead.mobileCc} ${lead.mobile}`,
    email: lead.email,
    location: [lead.city, lead.state].filter(Boolean).join(', '),
    stageId: lead.stage?.id ?? null,
    stageName: lead.stage?.name ?? null,
    dealStageId: lead.dealStage?.id ?? null,
    dealStageName: lead.dealStage?.name ?? null,
    sourceName: lead.source?.name ?? null,
    assignedToUserId: lead.assignedToUserId,
    assignedToName: lead.assignedToUserId ? name.get(lead.assignedToUserId) ?? null : null,
    requirement: lead.requirement,
    sharedWithPartner: lead.sharedWithPartner,
    potentialPaise: lead.potentialPaise,
    sinceDate: lead.sinceDate,
    lastTalkAt: lead.lastTalkAt,
    nextActionAt: lead.nextActionAt,
    isClosed: lead.isClosed,
    convertedCustomerId: lead.convertedCustomerId,
    tags: lead.tags.map((t) => t.tag),
    notes: lead.leadNotes.filter((n) => n.kind === 'note').map(mapNote),
    comments: lead.leadNotes.filter((n) => n.kind === 'comment').map(mapNote),
    activities: lead.activities.map((a) => ({
      id: a.id, channel: a.channel, outcome: a.outcome, note: a.note,
      occurredAt: a.occurredAt, durationSec: a.durationSec,
      author: a.createdBy ? name.get(a.createdBy) ?? null : null,
    })),
    channelCounts,
    ageDays: Math.floor((Date.now() - lead.sinceDate.getTime()) / 86_400_000),
    editable: {
      firstName: lead.firstName,
      lastName: lead.lastName,
      businessName: lead.businessName,
      mobileCc: lead.mobileCc,
      mobile: lead.mobile,
      email: lead.email,
      requirement: lead.requirement,
    },
    quotations: quotations.map((q) => ({
      id: q.id,
      quotationNo: q.quotationNo,
      status: q.status,
      grandTotalPaise: q.grandTotalPaise,
      quotationDate: q.quotationDate,
    })),
  };
}
