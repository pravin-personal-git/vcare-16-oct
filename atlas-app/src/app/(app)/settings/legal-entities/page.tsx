import { requireContext } from '@/server/context';
import { listLegalEntities } from '@/server/administration';
import { LegalEntitiesClient } from './LegalEntitiesClient';

export default async function LegalEntitiesPage() {
  const ctx = await requireContext();
  const entities = await listLegalEntities(ctx.organization.id);

  return (
    <LegalEntitiesClient
      entities={entities.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))}
    />
  );
}
