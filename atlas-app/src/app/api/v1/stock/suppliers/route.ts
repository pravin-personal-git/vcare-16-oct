import { field } from '@/server/auth/v1-staff';
import { searchSuppliers } from '@/server/stock-lookup';

export async function GET(req: Request) {
  return field(req, ['purchase.edit', 'purchase.view'], 'stock', async (ctx) => ({
    suppliers: await searchSuppliers(ctx.scope, new URL(req.url).searchParams.get('q') ?? ''),
  }));
}
