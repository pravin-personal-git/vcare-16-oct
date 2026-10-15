import { requireContext } from '@/server/context';
import { orderStagesFor } from '@/server/order-stages';
import { OrderStagesClient } from './OrderStagesClient';

/**
 * Settings › Sales order stages (11 Oct 2026, ops-pages demo tab 5): which
 * steps an order goes through, their names and colours. Booked and Delivered
 * always stay; every business starts on Booked → Confirmed → Dispatched →
 * Delivered.
 */
export default async function OrderStagesPage() {
  const ctx = await requireContext();
  const stages = await orderStagesFor(ctx.scope);
  return <OrderStagesClient initial={stages} canEdit={ctx.permissions.has('settings.edit') && ctx.scope.kind === 'single'} />;
}
