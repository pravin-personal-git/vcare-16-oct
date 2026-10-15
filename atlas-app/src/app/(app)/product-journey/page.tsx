import { redirect } from 'next/navigation';
import { requireContext } from '@/server/context';
import { browseCatalogue, productHistory } from '@/server/product-history';
import { productJourney } from '@/server/product-journey';
import { HistoryClient } from './HistoryClient';
import { serialiseProduct, serialiseUnit } from './serialise';

/**
 * Product history (rebuilt 2 Oct 2026).
 *
 * `?product=<id>` opens a model's whole life - which is what the products list
 * links to. `?unit=<id>` opens one physical item's own trail, for the places
 * that already hold a unit id: the stock-units list, a replacement case, a
 * scanner.
 *
 * Both, because the two questions are genuinely different. "What happens with
 * this model, and where has our money gone on it" is answerable for every
 * product today. "Where is this exact camera" is answerable only where the
 * unit chain is complete, and the model view is the honest place to find out
 * whether it is.
 */
export default async function ProductHistoryPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const ctx = await requireContext();
  if (!ctx.permissions.has('stock.view')) redirect('/dashboard');

  const sp = await searchParams;

  const [catalogue, product, unit] = await Promise.all([
    /**
     * The whole catalogue, so the screen can offer a PICKER rather than only a
     * text box. Typing a code from memory is fine for a technician holding the
     * item; it is miserable for anybody working through a category.
     */
    browseCatalogue(ctx.scope).catch(() => ({ products: [], categories: [], subCategories: [] })),
    sp.product ? productHistory(ctx.scope, sp.product).catch(() => null) : null,
    sp.unit ? productJourney(ctx.scope, sp.unit).catch(() => null) : null,
  ]);

  /**
   * A `?unit=` link also loads that unit's product, so the page opens with the
   * full picture rather than with the thin slice. Nobody arriving from a
   * scanner wants to search again to see what the model has done.
   */
  const productForUnit = unit && !product
    ? await productHistory(ctx.scope, unit.productId).catch(() => null)
    : null;

  const shown = product ?? productForUnit;

  return (
    <HistoryClient
      catalogue={catalogue}
      initialProduct={shown ? serialiseProduct(shown) : null}
      initialUnit={unit ? serialiseUnit(unit) : null}
    />
  );
}
