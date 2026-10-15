import { requireContext } from '@/server/context';
import { db } from '@/server/db';
import { scopeWhere } from '@/server/store-scope';
import { fieldSettings } from '@/server/custom-fields';
import { FIELD_ENTITIES, type FieldEntity } from '@/lib/custom-fields';
import { CustomFieldsClient } from './CustomFieldsClient';

export default async function CustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string }>;
}) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const entity: FieldEntity = FIELD_ENTITIES.some((e) => e.key === sp.for) ? (sp.for as FieldEntity) : 'customer';
  const scopeIsAll = ctx.scope.kind === 'all';

  const [settings, categories] = scopeIsAll
    ? [{ custom: [], standard: [] }, []]
    : await Promise.all([
      fieldSettings(ctx.scope, entity),
      db.category.findMany({
        where: { ...scopeWhere(ctx.scope), parentId: null, isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);

  const { scope } = ctx;
  const storeName = scope.kind === 'single' ? ctx.stores.find((s) => s.id === scope.storeId)?.name ?? '' : '';

  return (
    <CustomFieldsClient
      entity={entity}
      custom={settings.custom}
      standard={settings.standard}
      categories={categories}
      canEdit={ctx.permissions.has('settings.edit')}
      scopeIsAll={scopeIsAll}
      storeName={storeName}
    />
  );
}
