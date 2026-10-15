import 'server-only';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { scopeForWrite, type StoreScope } from './store-scope';

/**
 * Daily staff checklist (25 Sep 2026). Each day, a manager ticks the points
 * the business checks for every person - present, on time, dress code,
 * WhatsApp update. The points are the branch's own list (StaffChecklistItem);
 * a branch that has none gets the five below the first time the page opens,
 * which are exactly the five Vcare's old app kept as "KPI".
 *
 * "Present" is filled in from attendance when nobody has marked the day yet,
 * so the manager only corrects it.
 */

export class ChecklistError extends Error {}

export const DEFAULT_ITEMS = [
  { key: 'attendance', label: 'Present' },
  { key: 'leave', label: 'On leave' },
  { key: 'in_time', label: 'On time' },
  { key: 'whatsapp_update', label: 'WhatsApp update sent' },
  { key: 'in_dress_code', label: 'In dress code' },
] as const;

export interface ChecklistItemRow { id: string; key: string; label: string; sort: number; isActive: boolean }

export interface ChecklistDayRow {
  userId: string;
  fullName: string;
  department: string | null;
  values: Record<string, boolean>;
  /** True when nothing is saved yet and values came from attendance. */
  suggested: boolean;
  note: string | null;
  recordedByName: string | null;
  updatedAt: string | null;
}

const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

export async function listItems(storeId: string, includeHidden = false): Promise<ChecklistItemRow[]> {
  let items = await db.staffChecklistItem.findMany({ where: { storeId }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
  if (items.length === 0) {
    await db.staffChecklistItem.createMany({
      data: DEFAULT_ITEMS.map((d, i) => ({ storeId, key: d.key, label: d.label, sort: i })),
      skipDuplicates: true,
    });
    items = await db.staffChecklistItem.findMany({ where: { storeId }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
  }
  return items
    .filter((i) => includeHidden || i.isActive)
    .map((i) => ({ id: i.id, key: i.key, label: i.label, sort: i.sort, isActive: i.isActive }));
}

/** Everyone working in the branch, with the day's marks (or attendance-based suggestions). */
export async function checklistDay(scope: StoreScope, workDate: string): Promise<ChecklistDayRow[]> {
  const storeId = scopeForWrite(scope);
  if (!isDay(workDate)) throw new ChecklistError('Pick a date.');
  const [users, entries, days] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, storeRoles: { some: { storeId } } },
      select: { id: true, fullName: true, department: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
    }),
    db.staffChecklistEntry.findMany({ where: { storeId, workDate } }),
    db.attendanceDay.findMany({ where: { storeId, workDate }, select: { userId: true, firstInAt: true } }),
  ]);
  const byUser = new Map(entries.map((e) => [e.userId, e]));
  const present = new Set(days.filter((d) => d.firstInAt).map((d) => d.userId));
  const recorderIds = [...new Set(entries.map((e) => e.recordedBy).filter((x): x is string => !!x))];
  const recorders = new Map((recorderIds.length
    ? await db.user.findMany({ where: { id: { in: recorderIds } }, select: { id: true, fullName: true } })
    : []).map((u) => [u.id, u.fullName]));
  return users.map((u) => {
    const e = byUser.get(u.id);
    return {
      userId: u.id,
      fullName: u.fullName,
      department: u.department?.name ?? null,
      values: e ? (e.values as Record<string, boolean>) : { attendance: present.has(u.id) },
      suggested: !e,
      note: e?.note ?? null,
      recordedByName: e?.recordedBy ? recorders.get(e.recordedBy) ?? null : null,
      updatedAt: e?.updatedAt.toISOString() ?? null,
    };
  });
}

export async function saveChecklist(
  scope: StoreScope, input: { userId: string; workDate: string; values: Record<string, boolean>; note?: string | null }, actorId: string,
): Promise<void> {
  const storeId = scopeForWrite(scope);
  if (!isDay(input.workDate)) throw new ChecklistError('Pick a date.');
  if (input.workDate > new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)) {
    throw new ChecklistError('You cannot mark a day that has not happened yet.');
  }
  const member = await db.userStoreRole.findFirst({ where: { userId: input.userId, storeId }, select: { userId: true } });
  if (!member) throw new ChecklistError('That person does not work in this branch.');
  const keys = new Set((await listItems(storeId, true)).map((i) => i.key));
  const values: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(input.values)) if (keys.has(k)) values[k] = !!v;
  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
  await db.staffChecklistEntry.upsert({
    where: { storeId_userId_workDate: { storeId, userId: input.userId, workDate: input.workDate } },
    create: { storeId, userId: input.userId, workDate: input.workDate, values: values as Prisma.InputJsonValue, note, recordedBy: actorId },
    update: { values: values as Prisma.InputJsonValue, note, recordedBy: actorId },
  });
}

export interface ChecklistMonthRow {
  userId: string;
  fullName: string;
  daysMarked: number;
  /** Per item key: days ticked. */
  ticked: Record<string, number>;
}

/** Per person for a month: days marked and how many days each point was ticked. */
export async function checklistMonth(scope: StoreScope, year: number, month: number): Promise<ChecklistMonthRow[]> {
  const storeId = scopeForWrite(scope);
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = `${year}-${String(month).padStart(2, '0')}-31`;
  const entries = await db.staffChecklistEntry.findMany({
    where: { storeId, workDate: { gte: from, lte: to } },
    select: { userId: true, values: true, user: { select: { fullName: true } } },
  });
  const by = new Map<string, ChecklistMonthRow>();
  for (const e of entries) {
    const r = by.get(e.userId) ?? { userId: e.userId, fullName: e.user.fullName, daysMarked: 0, ticked: {} };
    r.daysMarked += 1;
    for (const [k, v] of Object.entries(e.values as Record<string, boolean>)) if (v) r.ticked[k] = (r.ticked[k] ?? 0) + 1;
    by.set(e.userId, r);
  }
  return [...by.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}

// --------------------------------------------------------------- the list

export async function addItem(scope: StoreScope, label: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const clean = label.trim().slice(0, 60);
  if (!clean) throw new ChecklistError('Name the point, for example "Uniform clean".');
  const items = await listItems(storeId, true);
  if (items.some((i) => i.label.toLowerCase() === clean.toLowerCase())) throw new ChecklistError(`"${clean}" is already on the list.`);
  const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'point';
  let key = base; let n = 2;
  while (items.some((i) => i.key === key)) key = `${base}_${n++}`;
  await db.staffChecklistItem.create({ data: { storeId, key, label: clean, sort: items.length } });
}

export async function updateItem(scope: StoreScope, id: string, patch: { label?: string; isActive?: boolean }): Promise<void> {
  const storeId = scopeForWrite(scope);
  const item = await db.staffChecklistItem.findFirst({ where: { id, storeId }, select: { id: true } });
  if (!item) throw new ChecklistError('That point is not in this branch.');
  const label = patch.label !== undefined ? patch.label.trim().slice(0, 60) : undefined;
  if (label === '') throw new ChecklistError('A point needs a name.');
  // Hiding keeps past marks; a key is never reused, so history stays readable.
  await db.staffChecklistItem.update({ where: { id }, data: { ...(label ? { label } : {}), ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}) } });
}
