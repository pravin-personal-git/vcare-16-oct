/**
 * Turning the ids in an audit event into names (Stage G, 3 Oct 2026).
 *
 * A third of Vcare's log - 15,092 of 43,388 events on the dev copy - had
 * nothing to say what it was about. The trigger labels a row from its own
 * number or name (invoiceNo, productName, ...), and a lead note, a checklist
 * tick, a challan assignee or a role's menu row has neither: it is a row that
 * POINTS at the thing it is about. So the log read "Lead note created", forty
 * times, and the Details table read "Lead: cmf3x9...".
 *
 * The fix is at READ time, not in the trigger. The trigger runs inside every
 * save in the product; a lookup added there slows every save to make one
 * report nicer, and a mistake there fails saves. Here, a mistake shows an id.
 *
 * Pure: which field points at what, and which fields describe a row. The
 * lookups themselves are in `server/audit-describe.ts`.
 */

export type RefKind =
  | 'user' | 'party' | 'product' | 'lead' | 'role' | 'menu' | 'permission' | 'account'
  | 'complaint' | 'installationChallan' | 'jobChallan' | 'journalEntry' | 'notification'
  | 'warehouse' | 'leaveType' | 'listing';

/** A field name means the same thing on every table that has it... */
const FIELD_REF: Record<string, RefKind> = {
  userId: 'user', technicianId: 'user', assignedToId: 'user', assigneeId: 'user',
  approvedById: 'user', createdById: 'user', ownerId: 'user', managerId: 'user', holderId: 'user',
  partyId: 'party', customerId: 'party', supplierId: 'party',
  productId: 'product',
  leadId: 'lead',
  roleId: 'role',
  menuId: 'menu',
  permissionId: 'permission',
  accountId: 'account',
  complaintId: 'complaint',
  warehouseId: 'warehouse',
  journalEntryId: 'journalEntry',
  notificationId: 'notification',
  leaveTypeId: 'leaveType',
  listingId: 'listing',
};

/**
 * ...except where it does not. `challanId` is an installation challan on some
 * tables and a job challan on others, and guessing wrong would name a
 * different document - worse than showing the id.
 */
const TABLE_FIELD_REF: Record<string, Record<string, RefKind>> = {
  InstallationChallanAssignee: { challanId: 'installationChallan' },
  InstallationChallanItem: { challanId: 'installationChallan' },
  JobChallanLine: { challanId: 'jobChallan' },
  MaterialIssue: { challanId: 'jobChallan' },
};

export function refKind(table: string, field: string): RefKind | null {
  return TABLE_FIELD_REF[table]?.[field] ?? FIELD_REF[field] ?? null;
}

/**
 * When a row has no name of its own, what it is about - most specific parent
 * first. A lead note is about its LEAD; a challan line about its CHALLAN, then
 * its product; a checklist tick about the PERSON. Two at most: "LEAD-212 ·
 * Sharma Traders" helps, five ids in a row does not.
 */
const CONTEXT_ORDER = [
  'leadId', 'complaintId', 'challanId', 'journalEntryId', 'notificationId', 'roleId',
  'userId', 'technicianId', 'partyId', 'productId', 'menuId', 'permissionId',
  'accountId', 'warehouseId', 'leaveTypeId', 'listingId',
];

export interface ContextRef { field: string; kind: RefKind; id: string }

export function contextRefs(table: string, row: Record<string, unknown> | null | undefined): ContextRef[] {
  if (!row) return [];
  const out: ContextRef[] = [];
  for (const field of CONTEXT_ORDER) {
    const id = row[field];
    const kind = refKind(table, field);
    if (kind && typeof id === 'string' && id) out.push({ field, kind, id });
    if (out.length === 2) break;
  }
  return out;
}

/** A row's own words, where it has some the trigger did not pick up. */
export function ownText(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  // `kind` last: on its own it is a code ("add_to_cart"), worth showing only
  // when the row has nothing better to say.
  for (const f of ['refNo', 'body', 'note', 'key', 'kind']) {
    const v = row[f];
    if (typeof v === 'string' && v.trim()) {
      const s = v.trim().replace(/\s+/g, ' ');
      return s.length > 60 ? `${s.slice(0, 57)}...` : s;
    }
  }
  return null;
}

export const refKey = (kind: RefKind, id: string) => `${kind}:${id}`;
