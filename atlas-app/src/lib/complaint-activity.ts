/**
 * REMARKS VERSUS THE LOG on a complaint (9 Oct 2026, layout A).
 *
 * Pravin, after the live service test: "complaint ke logs aur technician
 * remarks me koi farak samajh hi nahi aata - sab ek jaisa ek jagah dikh raha
 * hai." He was right, and the cause was in the data, not the screen: the kind
 * `note` carried both what a person wrote and what Atlas wrote about itself
 * ("Complaint raised.", "Decided: needs a field visit.", "Billed on INV-…").
 *
 * From today a person's note is written as `remark`. Rows written before that
 * are told apart here by the sentences Atlas itself writes - the only signal
 * those rows have. Pure, so the rule is tested rather than eyeballed.
 */

export type ActivityLane = 'remark' | 'log';
export type ActivityAuthor = 'technician' | 'office' | 'customer' | 'system';

export interface ActivityLike {
  kind: string;
  body: string | null;
  createdById?: string | null;
}

/** The sentences Atlas writes under the old `note` kind. Anything else under `note` a person typed. */
const SYSTEM_NOTE = [
  /^Complaint raised( by the customer)?\.$/,
  /^Decided: /,
  /^Billed on /,
  /^Repair challan .+ edited: /,
  /^Installation job raised from order /,
];

export function isSystemNote(body: string | null): boolean {
  const b = (body ?? '').trim();
  return SYSTEM_NOTE.some((re) => re.test(b));
}

/**
 * Which lane an entry belongs in, and who it reads as coming from.
 *
 * A completed visit with an outcome is the technician's own words about the
 * job, so it is a remark; "Visit completed." with nothing added is a log line.
 * A customer's request from their link is a remark from the customer.
 */
export function classifyActivity(
  a: ActivityLike,
  ctx: { technicianId: string | null },
): { lane: ActivityLane; author: ActivityAuthor } {
  const person: ActivityAuthor = a.createdById && a.createdById === ctx.technicianId ? 'technician' : 'office';
  if (a.kind === 'remark') return { lane: 'remark', author: a.createdById ? person : 'system' };
  if (a.kind === 'note') return isSystemNote(a.body) || !a.createdById ? { lane: 'log', author: 'system' } : { lane: 'remark', author: person };
  if (a.kind === 'customer_request') return { lane: 'remark', author: 'customer' };
  if (a.kind === 'visit_completed' && a.body && a.body.trim() !== 'Visit completed.') return { lane: 'remark', author: 'technician' };
  return { lane: 'log', author: a.createdById ? person : 'system' };
}
