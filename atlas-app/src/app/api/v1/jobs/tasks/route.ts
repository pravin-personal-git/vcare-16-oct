import { field } from '@/server/auth/v1-staff';
import { inScope } from '@/lib/app-access';
import { teamIds } from '@/server/team-reach';
import { listTasks } from '@/server/tasks';

/**
 * A person's tasks on the phone - their own by default; `?all=1` for the
 * whole branch when they manage tasks. Open ones first (overdue, then by due
 * date), then the last 30 days of finished ones.
 */
export async function GET(req: Request) {
  return field(req, null, 'tasks', async (ctx, access) => {
    // The owner's "Tasks they see" setting; the whole branch still needs tasks.edit (lib/app-access).
    const scope = access.scope.tasks;
    const canManage = scope === 'branch';
    const all = canManage && new URL(req.url).searchParams.get('all') === '1';
    // "Mine + my team" (B4 step 2) - the same reach as the website.
    const team = scope === 'team' ? await teamIds(ctx.scope, ctx.user.id) : undefined;
    const rows = (await listTasks(ctx.scope)).filter((t) => all || inScope(scope === 'branch' ? 'mine' : scope, [t.assignedToId], ctx.user.id, team));
    const done = (s: string) => s === 'Completed' || s === 'Cancelled';
    const monthAgo = Date.now() - 30 * 86_400_000;
    const open = rows.filter((t) => !done(t.status))
      .sort((a, b) => (a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER));
    const finished = rows.filter((t) => done(t.status) && (t.completedAt ?? t.createdAt).getTime() >= monthAgo);
    return { open: open.slice(0, 300), finished: finished.slice(0, 100), canManage, me: ctx.user.id };
  });
}
