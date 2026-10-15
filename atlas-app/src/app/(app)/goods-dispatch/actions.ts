'use server';

import { requireContext } from '@/server/context';
import { getDispatchDetail } from '@/server/goods-dispatch';

export async function loadDispatch(id: string) {
  const ctx = await requireContext();
  return getDispatchDetail(ctx.scope, id);
}
