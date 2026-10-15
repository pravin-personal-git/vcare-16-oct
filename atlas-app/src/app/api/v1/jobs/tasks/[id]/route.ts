import { field, jsonBody, requireAction, V1Error } from '@/server/auth/v1-staff';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { setTaskStatus } from '@/server/tasks';
import { TASK_STATUSES, type TaskStatus } from '@/lib/tasks';

/**
 * Move a task along from the phone. The person it is assigned to may change
 * its status; so may anyone who manages tasks (`tasks.edit`).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return field(req, null, 'tasks', async (ctx, access) => {
    requireAction(access, 'tasks.update', 'Changing tasks');
    const { id } = await params;
    const b = await jsonBody(req);
    const status = String(b.status ?? '') as TaskStatus;
    if (!(TASK_STATUSES as readonly string[]).includes(status)) throw new V1Error('Choose a valid status.');
    const task = await db.task.findFirst({ where: { id, ...scopeWhere(ctx.scope) }, select: { storeId: true, assignedToId: true } });
    if (!task) throw new V1Error('That task is not in your branch.', 404);
    if (task.assignedToId !== ctx.user.id && !ctx.permissions.has('tasks.edit')) {
      throw new V1Error('Only the person this task is assigned to can change it.', 403);
    }
    await setTaskStatus({ kind: 'single', storeId: task.storeId, writable: ctx.scope.writable }, id, status);
    return { ok: true };
  });
}
