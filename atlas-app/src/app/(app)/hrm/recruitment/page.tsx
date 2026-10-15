import { requireContext } from '@/server/context';
import { listJobOpenings, listCandidates } from '@/server/recruitment';
import { RecruitmentClient } from './RecruitmentClient';

export default async function RecruitmentPage() {
  const ctx = await requireContext();
  const [openings, candidates] = await Promise.all([
    listJobOpenings(ctx.scope),
    listCandidates(ctx.scope),
  ]);

  return (
    <RecruitmentClient
      openings={openings.map((o) => ({ ...o, createdAt: o.createdAt.toISOString() }))}
      candidates={candidates.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() }))}
      canManage={ctx.permissions.has('hrm.edit')}
    />
  );
}
