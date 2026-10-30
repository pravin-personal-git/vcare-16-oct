import 'server-only';
import { db } from './db';
import { scopeForWrite, type StoreScope } from './store-scope';
import { ROLE_MODULES, isModuleLevel, levelsOf, moduleByKey, moduleState, type ModuleLevel } from '@/lib/role-modules';

/**
 * Each person's own access, per module, in one branch (30 Oct 2026, Settings >
 * Operations & approvals). Their roles give the starting level; a row in
 * UserAccessOverride replaces it for that module only, and server/context
 * applies it on every request, web and phone alike.
 */
export class UserAccessError extends Error {}

/** Modules an owner keeps whatever this page says: a business must never lose its last owner. */
const OWNER_LOCKED = ['settings', 'users'];

export interface PersonAccess {
  id: string;
  name: string;
  roles: string[];
  isOwner: boolean;
  /** Level from roles, per module. */
  role: Record<string, ModuleLevel>;
  /** Saved personal level, per module, where there is one. */
  own: Record<string, ModuleLevel>;
}

export async function listPeopleAccess(storeId: string): Promise<PersonAccess[]> {
  const [staff, rows] = await Promise.all([
    db.userStoreRole.findMany({
      where: { storeId, user: { isActive: true } },
      select: {
        user: { select: { id: true, fullName: true } },
        role: { select: { name: true, permissions: { select: { permission: { select: { key: true } } } } } },
      },
    }),
    db.userAccessOverride.findMany({ where: { storeId }, select: { userId: true, moduleKey: true, level: true } }),
  ]);
  const people = new Map<string, { id: string; name: string; roles: string[]; keys: Set<string> }>();
  for (const s of staff) {
    const p = people.get(s.user.id) ?? { id: s.user.id, name: s.user.fullName, roles: [], keys: new Set<string>() };
    p.roles.push(s.role.name);
    for (const rp of s.role.permissions) p.keys.add(rp.permission.key);
    people.set(s.user.id, p);
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({
    id: p.id, name: p.name, roles: p.roles, isOwner: p.keys.has('settings.edit'),
    role: Object.fromEntries(ROLE_MODULES.map((m) => [m.key, moduleState(m, p.keys).level])),
    own: Object.fromEntries(rows.filter((r) => r.userId === p.id && isModuleLevel(r.level)).map((r) => [r.moduleKey, r.level as ModuleLevel])),
  }));
}

export interface AccessChange { userId: string; moduleKey: string; level: ModuleLevel }

/**
 * Save the switches. A level equal to what the roles give removes the
 * person's own row - "sirf is aadmi ke liye" then disappears, which is true.
 */
export async function saveAccessChanges(scope: StoreScope, actorId: string, changes: AccessChange[]): Promise<{ saved: number }> {
  const storeId = scopeForWrite(scope);
  if (!changes.length) return { saved: 0 };
  if (changes.length > 500) throw new UserAccessError('Too many changes at once - save in parts.');
  const people = new Map((await listPeopleAccess(storeId)).map((p) => [p.id, p]));

  for (const c of changes) {
    const p = people.get(c.userId);
    const m = moduleByKey(c.moduleKey);
    if (!p) throw new UserAccessError('That person does not work in this branch.');
    if (!m || !isModuleLevel(c.level) || !levelsOf(m).includes(c.level)) throw new UserAccessError(`"${c.moduleKey}" cannot be set to ${c.level}.`);
    if (c.userId === actorId) throw new UserAccessError('Apni access khud nahi badal sakte - kisi aur owner se karwaiye.');
    if (p.isOwner && OWNER_LOCKED.includes(m.key)) throw new UserAccessError(`${p.name} owner hain - unki ${m.label} access unke role se hi tay hoti hai.`);
  }

  await db.$transaction(changes.map((c) => {
    const p = people.get(c.userId)!;
    const key = { storeId_userId_moduleKey: { storeId, userId: c.userId, moduleKey: c.moduleKey } };
    return p.role[c.moduleKey] === c.level
      ? db.userAccessOverride.deleteMany({ where: { storeId, userId: c.userId, moduleKey: c.moduleKey } })
      : db.userAccessOverride.upsert({ where: key, create: { storeId, userId: c.userId, moduleKey: c.moduleKey, level: c.level, setBy: actorId }, update: { level: c.level, setBy: actorId } });
  }));
  return { saved: changes.length };
}
