'use server';

import { revalidatePath } from 'next/cache';
import { requireContext } from '@/server/context';
import {
  createRole, updateRole, deleteRole, getRoleDetail, setRoleDesignation,
  type RoleInput, type RoleDetail,
} from '@/server/roles';

export interface ActionState {
  ok?: boolean;
  error?: string;
}

export async function loadRoleDetailAction(roleId: string): Promise<RoleDetail | null> {
  const ctx = await requireContext();
  return getRoleDetail(ctx.scope, roleId);
}

export async function createRoleAction(input: RoleInput): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('users.edit')) {
    return { error: 'You do not have permission to edit users and roles.' };
  }
  try {
    await createRole(ctx.scope, input);
    revalidatePath('/settings/roles');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save.' };
  }
}

export async function updateRoleAction(
  roleId: string, input: Omit<RoleInput, 'storeId'>,
): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('users.edit')) {
    return { error: 'You do not have permission to edit users and roles.' };
  }
  try {
    await updateRole(ctx.scope, roleId, input);
    revalidatePath('/settings/roles');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save.' };
  }
}

export async function setRoleDesignationAction(
  roleId: string, input: { designationCode: string | null; level: number | null },
): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('users.edit')) {
    return { error: 'You do not have permission to edit users and roles.' };
  }
  try {
    await setRoleDesignation(ctx.scope, roleId, input);
    revalidatePath('/settings/roles');
    revalidatePath('/hierarchy/team-setup');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not save.' };
  }
}

export async function deleteRoleAction(roleId: string): Promise<ActionState> {
  const ctx = await requireContext();
  if (!ctx.permissions.has('users.edit')) {
    return { error: 'You do not have permission to edit users and roles.' };
  }
  try {
    await deleteRole(ctx.scope, roleId);
    revalidatePath('/settings/roles');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not delete.' };
  }
}
