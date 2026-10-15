import 'server-only';
import { db } from './db';
import { scopeForWrite, type StoreScope } from './store-scope';
import { generateTasksForUser, listTasksForUser, summarizeProgress, type LifecycleTaskRow, type PhaseProgress } from './lifecycle';

export class OnboardingError extends Error {}

export interface JoinerRow {
  userId: string;
  fullName: string;
  dateOfJoining: Date | null;
  employmentType: string;
  confirmedAt: Date | null;
  progress: PhaseProgress;
}

/** Everyone holding a role in this store, with whatever onboarding has been started for them. */
export async function listJoiners(scope: StoreScope): Promise<JoinerRow[]> {
  const storeId = scopeForWrite(scope);
  const roles = await db.userStoreRole.findMany({
    where: { storeId },
    distinct: ['userId'],
    select: { user: { select: { id: true, fullName: true, profile: true } } },
  });

  const tasks = await db.lifecycleTask.findMany({
    where: { storeId, phase: 'onboarding' },
    include: { user: { select: { fullName: true } } },
  });
  const tasksByUser = new Map<string, LifecycleTaskRow[]>();
  for (const t of tasks) {
    const row: LifecycleTaskRow = {
      id: t.id, userId: t.userId, userName: t.user.fullName, phase: 'onboarding',
      label: t.label, status: t.status as LifecycleTaskRow['status'],
      completedBy: t.completedBy, completedAt: t.completedAt, note: t.note, createdAt: t.createdAt,
    };
    tasksByUser.set(t.userId, [...(tasksByUser.get(t.userId) ?? []), row]);
  }

  return roles
    .map((r) => r.user)
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map((u) => ({
      userId: u.id, fullName: u.fullName,
      dateOfJoining: u.profile?.dateOfJoining ?? null,
      employmentType: u.profile?.employmentType ?? 'full_time',
      confirmedAt: u.profile?.confirmedAt ?? null,
      progress: summarizeProgress(tasksByUser.get(u.id) ?? []),
    }));
}

export interface OnboardingDetailsInput {
  dateOfJoining: Date | null;
  employmentType: string;
  personalEmail: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

/**
 * Record a new joiner's basic details and kick off their onboarding
 * checklist in one action - the two things an admin does the moment
 * someone actually starts, back to back.
 */
export async function startOnboarding(
  scope: StoreScope, userId: string, input: OnboardingDetailsInput,
): Promise<{ tasksCreated: number }> {
  const storeId = scopeForWrite(scope);
  const holdsRole = await db.userStoreRole.findFirst({ where: { storeId, userId } });
  if (!holdsRole) throw new OnboardingError('That person does not have access to this store.');

  await db.employeeProfile.upsert({
    where: { userId },
    create: {
      userId,
      dateOfJoining: input.dateOfJoining,
      employmentType: input.employmentType,
      personalEmail: input.personalEmail?.trim() || null,
      address: input.address?.trim() || null,
      emergencyContactName: input.emergencyContactName?.trim() || null,
      emergencyContactPhone: input.emergencyContactPhone?.trim() || null,
    },
    update: {
      dateOfJoining: input.dateOfJoining,
      employmentType: input.employmentType,
      personalEmail: input.personalEmail?.trim() || null,
      address: input.address?.trim() || null,
      emergencyContactName: input.emergencyContactName?.trim() || null,
      emergencyContactPhone: input.emergencyContactPhone?.trim() || null,
    },
  });

  const { created } = await generateTasksForUser(scope, userId, 'onboarding');
  return { tasksCreated: created };
}

export async function markConfirmed(scope: StoreScope, userId: string): Promise<void> {
  const storeId = scopeForWrite(scope);
  const holdsRole = await db.userStoreRole.findFirst({ where: { storeId, userId } });
  if (!holdsRole) throw new OnboardingError('That person does not have access to this store.');

  await db.employeeProfile.upsert({
    where: { userId },
    create: { userId, confirmedAt: new Date() },
    update: { confirmedAt: new Date() },
  });
}

export { listTasksForUser as listOnboardingTasks };
