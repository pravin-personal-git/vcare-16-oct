import { requireContext } from '@/server/context';
import { listInterviews, listCandidates, listLinkableUsers } from '@/server/recruitment';
import { Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { InterviewsClient } from './InterviewsClient';

export default async function InterviewsPage() {
  const ctx = await requireContext();

  if (ctx.scope.kind === 'all') {
    return (
      <div>
        <PageHeader badge="IN" title="Interviews" subtitle="Schedule and record interview feedback" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="Interviews are kept per branch." />
        </Card>
      </div>
    );
  }

  const [interviews, candidates, interviewers] = await Promise.all([
    listInterviews(ctx.scope),
    listCandidates(ctx.scope),
    listLinkableUsers(ctx.scope),
  ]);

  const openCandidates = candidates.filter((c) => c.stage !== 'hired' && c.stage !== 'rejected');

  return (
    <InterviewsClient
      interviews={interviews.map((i) => ({ ...i, scheduledAt: i.scheduledAt.toISOString() }))}
      candidates={openCandidates.map((c) => ({ id: c.id, fullName: c.fullName, jobOpeningTitle: c.jobOpeningTitle }))}
      interviewers={interviewers}
      canManage={ctx.permissions.has('hrm.edit')}
    />
  );
}
