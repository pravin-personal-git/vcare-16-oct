import { requireContext } from '@/server/context';
import { listProjects, listAllTasks, listTimesheets, listProjectAssignableUsers } from '@/server/projects';
import { Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { ProjectClient } from './ProjectClient';

export default async function ProjectPage() {
  const ctx = await requireContext();

  if (ctx.scope.kind === 'all') {
    return (
      <div>
        <PageHeader badge="PR" title="Project" subtitle="Projects, kanban stages, tasks and timesheets" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="Projects are kept per branch." />
        </Card>
      </div>
    );
  }

  const [projects, tasks, timesheets, employees] = await Promise.all([
    listProjects(ctx.scope),
    listAllTasks(ctx.scope),
    listTimesheets(ctx.scope),
    listProjectAssignableUsers(ctx.scope),
  ]);

  return (
    <ProjectClient
      projects={projects.map((p) => ({
        ...p, startDate: p.startDate.toISOString(), endDate: p.endDate?.toISOString() ?? null, createdAt: p.createdAt.toISOString(),
      }))}
      tasks={tasks.map((t) => ({ ...t, endDate: t.endDate?.toISOString() ?? null }))}
      timesheets={timesheets.map((t) => ({ ...t, date: t.date.toISOString() }))}
      employees={employees}
      canManage={ctx.permissions.has('hrm.edit')}
    />
  );
}
