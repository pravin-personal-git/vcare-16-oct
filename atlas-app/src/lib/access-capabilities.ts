/**
 * WHAT A PERSON CAN DO, IN WORDS (B2 Access check, 11 Oct 2026).
 *
 * Built from `ROLE_MODULES` - the same areas and levels the Roles screen
 * edits - rather than a second hand-written list of 77 keys, so a module
 * added to the Roles screen shows up in "Who can…" without anyone
 * remembering to. Pure: the server report and the tests share it.
 */
import { ROLE_MODULES, moduleState, type ModuleLevel } from './role-modules';

export interface Capability {
  key: string;
  /** Area name, as on the Roles screen. */
  area: string;
  group: string;
  sentence: string;
  /** Every one of these permissions is needed. */
  needs: string[];
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export const CAPABILITIES: Capability[] = ROLE_MODULES.flatMap((m) => {
  const out: Capability[] = [];
  const add = (step: string, sentence: string, needs: string[]) => {
    if (needs.length) out.push({ key: step.includes('.') ? step : `${m.key}.${step}`, area: m.label, group: m.group, sentence, needs });
  };
  add('view', `See ${lower(m.label)} - ${lower(m.hint)}`, m.view);
  add('edit', `Add and change ${lower(m.label)}`, m.edit);
  add('approve', `Approve ${lower(m.label)}`, m.approve ?? []);
  add('delete', `Delete ${lower(m.label)}`, m.delete ?? []);
  for (const x of m.extras ?? []) add(x.key, x.label, [x.key]);
  return out;
});

export const canDo = (c: Capability, perms: ReadonlySet<string>) => c.needs.every((k) => perms.has(k));

/** The None / See / Change / Approve grid cell for one area. */
export const AREA_LEVEL_LABEL: Record<ModuleLevel, string> = { none: 'None', view: 'See', edit: 'Change', approve: 'Approve' };

export function areaLevels(perms: ReadonlySet<string>): Record<string, ModuleLevel> {
  return Object.fromEntries(ROLE_MODULES.map((m) => [m.key, moduleState(m, perms).level]));
}

/** Who looks like an administrator - can change people and settings. */
export const isAdminLike = (perms: ReadonlySet<string>) => perms.has('users.edit') && perms.has('settings.edit');

/** More admins than this in one branch is worth a second look. */
export const ADMIN_WARN_OVER = 3;
