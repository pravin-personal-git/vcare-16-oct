import { requireContext } from '@/server/context';
import { getProject, listProjectAssignableUsers } from '@/server/projects';
import { ProjectDetailClient } from './ProjectDetailClient';
import { DocumentActivity } from '@/components/document/DocumentActivity';

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireContext();

  const [project, employees] = await Promise.all([
    getProject(ctx.scope, id),
    listProjectAssignableUsers(ctx.scope),
  ]);

  return (
    <>
    <ProjectDetailClient
      project={{
        ...project,
        startDate: project.startDate.toISOString(),
        endDate: project.endDate?.toISOString() ?? null,
        stages: project.stages.map((s) => ({
          ...s,
          tasks: s.tasks.map((t) => ({
            ...t,
            startDate: t.startDate?.toISOString() ?? null,
            endDate: t.endDate?.toISOString() ?? null,
          })),
        })),
      }}
      employees={employees}
      canManage={ctx.permissions.has('hrm.edit')}
    />
      <DocumentActivity table="Project" rowId={id} />
    </>
  );
}
