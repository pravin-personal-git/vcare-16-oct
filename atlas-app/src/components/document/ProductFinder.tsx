'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { lookupUnitsAction } from '@/app/(app)/stock-units/actions';

/**
 * Find a product for a document line (26 Sep 2026).
 *
 * Replaces one long <select> of the whole catalogue (1,325 products for Vcare)
 * with a search box and three narrowing filters - category, then its
 * sub-categories, then the brands that exist inside that choice. Type part of
 * a name, code or brand; arrow keys and Enter pick; the list shows stock and
 * price so the choice is made with both in view.
 *
 * THE SEARCH BOX IS ALWAYS GLOBAL (4 Oct 2026, raised by Vcare's Param Sir).
 *
 * It used to search only inside the chosen category, so picking "GATE
 * AUTOMATION" and then typing a camera's name found nothing, and the only way
 * out was to clear the filter and start again. The filters are a shortcut for
 * browsing, never a cage around the search.
 *
 * So: with the box empty, the list is whatever the filters select. As soon as
 * you type, every product is searched, and the results come back in two
 * groups - the ones inside your chosen category first, then everything else,
 * each labelled with the category it really belongs to.
 *
 * A SERIAL NUMBER FINDS ITS PRODUCT TOO (22 Oct 2026, Vcare). Typing a unit's
 * serial - "CMW3MWPABF23521" off a camera's label - found nothing, because a
 * serial belongs to one unit in stock, not to the catalogue. The box now also
 * asks the stock units (the same lookup as the Stock units page, so the same
 * people can read it) and lists the product each unit is, with where that unit
 * is now, above the name matches. Picking it picks the product; which unit goes
 * is still chosen where it always was - the store's issue, the dispatch scan.
 */
export interface FindableProduct {
  id: string;
  code: string | null;
  name: string;
  category: string | null;
  subCategory?: string | null;
  brand?: string | null;
  /** Searched as well, so a barcode typed or scanned into the box finds the product. */
  barcode?: string | null;
  sku?: string | null;
  stock: number;
  dlpPaise: number;
  /** Kept by serial number (22 Oct 2026) - picking it by serial also names the unit. */
  serial?: boolean;
}

const sel = 'h-8 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 text-xs outline-none focus:border-brand';
const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));

/** A serial looks like one word of five or more characters with a digit in it. */
const looksLikeSerial = (q: string) => /^\S{5,}$/.test(q) && /\d/.test(q);

/** Where a unit is now, in the words the Stock units page uses. */
function unitWhere(u: { status: string; holderName: string | null }): string {
  switch (u.status) {
    case 'in_stock': return 'In stock';
    case 'reserved': return 'Reserved';
    case 'with_customer': return u.holderName ? `With ${u.holderName}` : 'With the customer';
    case 'with_supplier': return u.holderName ? `With ${u.holderName}` : 'With the supplier';
    case 'scrapped': return 'Scrapped';
    case 'lost': return 'Lost';
    default: return u.status.replace(/_/g, ' ');
  }
}

interface SerialHit { unitId: string; serialNo: string; productId: string; productName: string; where: string; onShelf: boolean }

export function ProductFinder<T extends FindableProduct>({
  products, pickedId, onPick, onPickUnit, autoFocus,
}: {
  products: T[];
  pickedId: string;
  onPick: (id: string) => void;
  /**
   * Picked by a serial number that is on the shelf (22 Oct 2026): the unit
   * too, so a challan line can name it. Called right after `onPick`.
   */
  onPickUnit?: (u: { productId: string; unitId: string; serialNo: string }) => void;
  autoFocus?: boolean;
}) {
  const [cat, setCat] = useState('');
  const [sub, setSub] = useState('');
  const [brand, setBrand] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  const inCat = useMemo(() => (cat ? products.filter((p) => p.category === cat) : products), [products, cat]);
  const inSub = useMemo(() => (sub ? inCat.filter((p) => p.subCategory === sub) : inCat), [inCat, sub]);
  const categories = useMemo(() => uniq(products.map((p) => p.category)), [products]);
  const subs = useMemo(() => uniq(inCat.map((p) => p.subCategory)), [inCat]);
  const brands = useMemo(() => uniq(inSub.map((p) => p.brand)), [inSub]);

  /**
   * Browsing (box empty) obeys the filters. Searching (box typed in) ignores
   * them and looks at the whole catalogue, with the chosen category's matches
   * sorted to the top.
   */
  const { results, insideCount } = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
      return { results: inSub.filter((p) => !brand || p.brand === brand).slice(0, 50), insideCount: 0 };
    }
    const matches = (p: T) => {
      const hay = `${p.name} ${p.code ?? ''} ${p.barcode ?? ''} ${p.sku ?? ''} ${p.brand ?? ''} ${p.subCategory ?? ''} ${p.category ?? ''}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    };
    const hits = products.filter(matches);
    if (!cat) return { results: hits.slice(0, 50), insideCount: 0 };
    const inside = hits.filter((p) => p.category === cat);
    const outside = hits.filter((p) => p.category !== cat);
    return { results: [...inside, ...outside].slice(0, 50), insideCount: Math.min(inside.length, 50) };
  }, [products, inSub, brand, q, cat]);

  const picked = products.find((p) => p.id === pickedId) ?? null;

  /**
   * Serial matches, asked of the server a moment after typing stops. Only the
   * latest answer is kept, so a slow reply to "CMW3M" cannot overwrite the
   * answer to "CMW3MWPABF23521". Someone without access to stock units simply
   * gets none - the name search works as before.
   */
  const [serialHits, setSerialHits] = useState<SerialHit[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const asked = useRef(0);
  const term = q.trim();
  const serialAsk = open && looksLikeSerial(term) ? term : '';
  useEffect(() => {
    const n = ++asked.current;
    if (!serialAsk) { setSerialHits([]); setLookingUp(false); return; }
    setLookingUp(true);
    const t = setTimeout(() => {
      lookupUnitsAction(serialAsk)
        .catch(() => ({ rows: [] }))
        .then((r) => {
          if (n !== asked.current) return;
          setSerialHits((r.rows ?? []).filter((u) => u.serialNo).map((u) => ({
            unitId: u.id, serialNo: u.serialNo as string, productId: u.productId, productName: u.productName, where: unitWhere(u), onShelf: u.status === 'in_stock',
          })));
          setLookingUp(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [serialAsk]);

  /** Serial hits for products this list offers come first and can be picked; the rest are only named. */
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const serialRows = serialAsk ? serialHits.map((h) => ({ hit: h, product: byId.get(h.productId) ?? null })) : [];
  const pickable = serialRows.filter((r): r is { hit: SerialHit; product: T } => r.product !== null);
  const options: { p: T; unit?: SerialHit }[] = [...pickable.map((r) => ({ p: r.product, unit: r.hit })), ...results.map((p) => ({ p }))];

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  const choose = (p: T, unit?: SerialHit) => {
    onPick(p.id);
    if (unit?.onShelf) onPickUnit?.({ productId: p.id, unitId: unit.unitId, serialNo: unit.serialNo });
    setOpen(false); setQ('');
  };

  return (
    <div ref={box} className="relative grid gap-1.5">
      {(categories.length > 0 || brands.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {categories.length > 0 && (
            <select aria-label="Category" value={cat} className={sel}
              onChange={(e) => { setCat(e.target.value); setSub(''); setBrand(''); setOpen(true); }}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {subs.length > 0 && (
            <select aria-label="Sub-category" value={sub} className={sel}
              onChange={(e) => { setSub(e.target.value); setBrand(''); setOpen(true); }}>
              <option value="">All sub-categories</option>
              {subs.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {brands.length > 0 && (
            <select aria-label="Brand" value={brand} className={sel}
              onChange={(e) => { setBrand(e.target.value); setOpen(true); }}>
              <option value="">All brands</option>
              {brands.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      )}

      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label="Search product"
          autoFocus={autoFocus}
          value={open || !picked ? q : `${picked.code ? `${picked.code} · ` : ''}${picked.name}`}
          placeholder={cat ? `Search every category (not just ${cat})…` : 'Search by name, code, barcode, brand or serial…'}
          onFocus={() => { setOpen(true); setQ(''); }}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Enter' && open && options[active]) { e.preventDefault(); choose(options[active].p, options[active].unit); }
            if (e.key === 'Escape') setOpen(false);
          }}
          className="h-9 w-full rounded-lg border border-border bg-card ps-8 pe-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      {open && (
        <ul id={listId} role="listbox" className="thin-scroll absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-raised">
          {serialRows.length > 0 && (
            <li role="presentation">
              <p className="px-3 pb-0.5 pt-1 text-micro font-semibold uppercase text-muted-foreground">By serial number</p>
            </li>
          )}
          {serialRows.map(({ hit, product }) => {
            const i = product ? pickable.findIndex((r) => r.hit.unitId === hit.unitId) : -1;
            return (
              <li key={hit.unitId} role="option" aria-selected={i === active} aria-disabled={!product}>
                <button type="button" disabled={!product} onMouseEnter={() => i >= 0 && setActive(i)} onClick={() => product && choose(product, hit)}
                  className={`flex w-full items-center gap-3 px-3 py-1.5 text-start disabled:cursor-not-allowed disabled:opacity-60 ${i === active ? 'bg-brand/10' : ''}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" data-no-translate>{hit.productName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span className="font-mono" data-no-translate>{hit.serialNo}</span>
                      {' · '}<span>{hit.where}</span>
                      {!product && <>{' · '}<span>not offered here</span></>}
                    </span>
                  </span>
                  {product && <span className="w-20 shrink-0 text-end font-mono text-xs tabular-nums">{formatCurrency(product.dlpPaise)}</span>}
                </button>
              </li>
            );
          })}
          {serialRows.length > 0 && results.length > 0 && (
            <li role="presentation">
              <p className="mt-1 border-t border-border px-3 pb-0.5 pt-1.5 text-micro font-semibold uppercase text-muted-foreground">By name</p>
            </li>
          )}
          {lookingUp && serialRows.length === 0 && results.length === 0 && (
            <li className="px-3 py-2 text-xs text-muted-foreground">Looking for that serial number…</li>
          )}
          {results.length === 0 && serialRows.length === 0 && !lookingUp && (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              {q.trim()
                ? (serialAsk
                  ? 'No product or serial number matches that. Add the line by hand.'
                  : 'No product anywhere in the catalogue matches that. Add the line by hand.')
                : 'Nothing in this filter. Clear it, or type to search every category.'}
            </li>
          )}
          {results.map((p, n) => { const i = n + pickable.length; return (
            <li key={p.id} role="option" aria-selected={i === active}>
              {/* Two headings only while searching inside a chosen category,
                  so it is obvious the search reached past it. */}
              {insideCount > 0 && n === 0 && (
                <p className="px-3 pb-0.5 pt-1 text-micro font-semibold uppercase text-muted-foreground">In {cat}</p>
              )}
              {insideCount > 0 && n === insideCount && (
                <p className="mt-1 border-t border-border px-3 pb-0.5 pt-1.5 text-micro font-semibold uppercase text-muted-foreground">Other categories</p>
              )}
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => choose(p)}
                className={`flex w-full items-center gap-3 px-3 py-1.5 text-start ${i === active ? 'bg-brand/10' : ''}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {/* The category is always named, so a hit from outside the
                        chosen one cannot be mistaken for a hit inside it. */}
                    {[p.code, p.brand, p.category, p.subCategory].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className={`shrink-0 text-xs tabular-nums ${p.stock <= 0 ? 'text-warning' : 'text-muted-foreground'}`}>
                  {p.stock <= 0 ? 'no stock' : `${p.stock} in stock`}
                </span>
                <span className="w-20 shrink-0 text-end font-mono text-xs tabular-nums">{formatCurrency(p.dlpPaise)}</span>
              </button>
            </li>
          ); })}
          {results.length === 50 && <li className="px-3 py-1.5 text-xs text-muted-foreground">First 50 shown - type more to narrow it.</li>}
        </ul>
      )}
    </div>
  );
}
