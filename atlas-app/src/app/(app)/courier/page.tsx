import { requireContext } from '@/server/context';
import { listCouriers } from '@/server/couriers';
import { CourierClient } from './CourierClient';

export default async function CourierPage() {
  const ctx = await requireContext();
  const couriers = await listCouriers(ctx.scope);

  return (
    <CourierClient
      couriers={couriers.map((c) => ({
        id: c.id,
        name: c.name,
        contactPhone: c.contactPhone,
        trackingUrlTemplate: c.trackingUrlTemplate,
        notes: c.notes,
        isActive: c.isActive,
      }))}
      canEdit={ctx.permissions.has('settings.edit')}
      isSingleStore={ctx.scope.kind === 'single'}
    />
  );
}
