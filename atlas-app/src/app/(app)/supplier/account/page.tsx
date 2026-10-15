import { requireContext } from '@/server/context';
import { listSupplierAccounts } from '@/server/supplier-accounts';
import { SupplierAccountClient } from './SupplierAccountClient';

export default async function SupplierAccountPage() {
  const ctx = await requireContext();
  const result = await listSupplierAccounts(ctx.scope);

  return <SupplierAccountClient rows={result.rows} cards={result.cards} />;
}
