import { Icon } from './Icon';
import { formatCurrency } from '@/lib/format';
import { offerIsUsable, termMonths, type AmcOffer } from '@/lib/amc-offer';

/**
 * "Does this product come with maintenance, and on what terms."
 *
 * One component so the answer reads the same wherever a product appears -
 * the catalogue, the invoice line picker, a challan, a complaint. The client's
 * ask was that a product's details show up everywhere and be connected; this
 * is the AMC half of that, and it is a single import rather than four
 * near-identical snippets that drift.
 *
 * Says nothing at all when the product offers no AMC. A badge reading "No AMC"
 * on every cable and connector in a 1,325-product catalogue is noise that
 * makes the products that DO carry one harder to spot.
 */
export function AmcOfferBadge({
  offer, size = 'sm',
}: {
  offer: AmcOffer;
  size?: 'sm' | 'md';
}) {
  if (!offerIsUsable(offer)) return null;

  const months = termMonths(offer);
  const included = offer.amcPricingMode === 'included';
  const text = included
    ? `AMC included · ${months} mo`
    : `AMC ${formatCurrency(offer.amcAnnualPricePaise ?? 0)}/yr`;

  return (
    <span
      title={offer.amcTerms ?? undefined}
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${
        included
          ? 'border-success/30 bg-success/[0.08] text-on-tint-success'
          : 'border-info/30 bg-info/[0.08] text-on-tint-info'
      } ${size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-0.5 text-xs'}`}
    >
      <Icon name="refresh" className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      {text}
    </span>
  );
}

/*
 * There was an `AmcOfferDetail` here. Deleted 24 Sep 2026, unused.
 *
 * It was a read-only expansion of the offer, written before the product form
 * had its own editable AMC section. That section now shows the same facts
 * where somebody can act on them, and the badge above covers every list and
 * picker. Two components rendering one offer differently is how a screen ends
 * up contradicting the form that fills it in.
 */
