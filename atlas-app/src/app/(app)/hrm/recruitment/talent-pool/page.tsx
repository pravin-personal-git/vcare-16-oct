import { requireContext } from '@/server/context';
import { listSkillZones, listCandidates } from '@/server/recruitment';
import { Card, EmptyState, PageHeader } from '@/components/ui/Layout';
import { TalentPoolClient } from './TalentPoolClient';

export default async function TalentPoolPage() {
  const ctx = await requireContext();

  if (ctx.scope.kind === 'all') {
    return (
      <div>
        <PageHeader badge="TP" title="Talent Pool" subtitle="Candidates kept for later" />
        <Card>
          <EmptyState icon="building" title="Choose a branch first" hint="Talent pools are kept per branch." />
        </Card>
      </div>
    );
  }

  const [zones, candidates] = await Promise.all([
    listSkillZones(ctx.scope),
    listCandidates(ctx.scope),
  ]);

  return (
    <TalentPoolClient
      zones={zones.map((z) => ({ ...z, createdAt: z.createdAt.toISOString() }))}
      candidates={candidates.map((c) => ({ id: c.id, fullName: c.fullName, jobOpeningTitle: c.jobOpeningTitle, stage: c.stage }))}
      canManage={ctx.permissions.has('hrm.edit')}
    />
  );
}
