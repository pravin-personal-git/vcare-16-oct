import Link from 'next/link';
import { requireContext } from '@/server/context';
import { duplicateBarcodes } from '@/server/product-barcode';
import { db } from '@/server/db';
import { PageHeader, SectionCard } from '@/components/ui/Layout';

/**
 * BARCODES ON MORE THAN ONE PRODUCT (Scan-to-Stock G8, 12 Oct 2026) - the
 * one-time clean-up list. Saving a duplicate is refused from now on; these
 * were saved before the rule, and a scan lands on whichever one the database
 * returns first. Fix: open each product and correct or clear its barcode.
 */
export default async function BarcodeDuplicatesPage() {
  const ctx = await requireContext();
  const groups = await duplicateBarcodes(ctx.scope);
  const storeIds = [...new Set(groups.flatMap((g) => g.products.map((p) => p.storeId)))];
  const stores = new Map((await db.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        badge="alert-triangle"
        title="Duplicate barcodes"
        subtitle="One barcode should name one product. These were saved before Atlas refused duplicates - correct or clear the barcode on all but one."
      />
      {groups.length === 0 ? (
        <SectionCard title="All clear" icon="check-circle">
          <p className="text-sm">Every barcode in the business names one product. <Link href="/products" className="text-brand hover:underline">Back to products</Link></p>
        </SectionCard>
      ) : (
        <div className="grid gap-3">
          {groups.map((g) => (
            <SectionCard key={g.barcode} title={g.barcode} icon="scan" bodyClassName="p-0">
              <ul className="divide-y divide-border">
                {g.products.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{p.productCode}</span>
                    <Link href={`/product-journey?product=${p.id}`} className="font-medium hover:text-brand hover:underline">{p.productName}</Link>
                    <span className="text-xs text-muted-foreground">{stores.get(p.storeId) ?? ''}{p.isActive ? '' : ' · inactive'}</span>
                    <Link href={`/products?q=${encodeURIComponent(p.productCode)}`} className="ms-auto text-xs font-semibold text-brand hover:underline">Edit its barcode →</Link>
                  </li>
                ))}
              </ul>
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}
