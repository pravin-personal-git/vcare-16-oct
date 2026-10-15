import { requireContext } from '@/server/context';
import { ImportClient } from './ImportClient';

export default async function ImportPage() {
  const ctx = await requireContext();

  return (
    <ImportClient
      canImportCustomers={ctx.permissions.has('customers.create')}
      canImportProducts={ctx.permissions.has('products.edit')}
      isSingleStore={ctx.scope.kind === 'single'}
    />
  );
}
