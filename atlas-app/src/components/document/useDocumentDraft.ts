'use client';

import { useEffect, useMemo, useState } from 'react';
import { computeTotals } from '@/lib/quotation-totals';

/**
 * The state every sales document shares.
 *
 * Quotation, sales order and invoice are the same document at three points in
 * its life: the same buyer, the same lines, the same tax rules, the same
 * summary. They differ in what they are allowed to do, not in what they hold.
 *
 * Keeping this in one hook rather than three copies of the same twenty
 * `useState` calls is not tidiness. Three copies means the GST rule gets fixed
 * in one of them, and the other two quietly keep charging the wrong tax.
 */

import {
  offerIsUsable, isAutomatic, termMonths, termPricePaise, type AmcOffer,
} from '@/lib/amc-offer';

export interface DraftLine {
  key: string;
  productId: string | null;
  productName: string;
  productCode: string | null;
  hsn: string | null;
  qty: number;
  unitPricePaise: number;
  mrpPaise: number;
  discountPct: number;
  taxRatePct: number;
  note: string;

  /**
   * Whether this line carries an AMC.
   *
   * Pre-ticked and locked for a product whose AMC is `included` - the customer
   * did not choose it, it came with the purchase. A free choice when the AMC
   * costs extra. Ignored entirely for a product that offers none.
   *
   * Deliberately NOT part of `lineTotalPaise` or the GST totals: an extra-cost
   * AMC is billed on its own separate invoice (the client's decision), so
   * adding it into this line would charge for it twice and overstate the tax on
   * the goods. It travels to the server as a flag plus a snapshot, and
   * `createContractsForInvoice` turns it into a contract when the invoice is
   * issued.
   */
  amcOpted: boolean;
  amcMonths: number | null;
  amcPricePaise: number | null;
}

export interface BuyerOption {
  id: string;
  name: string;
  company: string | null;
  phone: string;
  email: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  address: string | null;
}

export interface CatalogueItem {
  id: string;
  code: string | null;
  name: string;
  dlpPaise: number;
  mrpPaise: number;
  category: string | null;
  subCategory?: string | null;
  brand?: string | null;
  stock: number;
  /**
   * Already promised to confirmed, undispatched orders (Rule 3, 3 Oct 2026).
   *
   * Optional because several pickers build a catalogue that has nothing to do
   * with promising stock - a return, a challan - and absent reads as nothing
   * promised, which is the behaviour every one of them had before.
   */
  promised?: number;
  hsn?: string | null;
  taxRatePct?: number;

  /**
   * The product's AMC offer, so a line can be seeded from it.
   *
   * Optional because several screens build a catalogue for a picker that has
   * nothing to do with AMC - a challan, a return - and forcing them all to
   * carry these five fields would be noise. Absent reads as "no AMC offered".
   */
  amcAvailable?: boolean;
  amcPricingMode?: string | null;
  amcDurationMonths?: number | null;
  amcAnnualPricePaise?: number | null;
  amcTerms?: string | null;
}

export function useDocumentDraft({
  catalogue,
  storeState,
  initialTerms = '',
}: {
  catalogue: CatalogueItem[];
  storeState: string | null;
  initialTerms?: string;
}) {
  // --- buyer ---------------------------------------------------------------
  const [buyerId, setBuyerId] = useState('');
  const [name, setName] = useState('');
  const [org, setOrg] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gstin, setGstin] = useState('');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [shipSame, setShipSame] = useState(true);
  const [shipAddress, setShipAddress] = useState('');

  // --- lines ---------------------------------------------------------------
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pick, setPick] = useState('');
  const [catFilter, setCatFilter] = useState('');
  /** Which price the picker offers - the reference calls them DLP and MRP. */
  const [priceBasis, setPriceBasis] = useState<'dlp' | 'mrp'>('dlp');

  // --- money ---------------------------------------------------------------
  /**
   * CHARGE GST ON THIS DOCUMENT? (Vcare, 8 Oct 2026.)
   *
   * Off when a document is started, which is Pravin's call and the safe one
   * either way: a document that should have carried tax and did not is a
   * conversation before it is sent, while one that quietly added 18% to a
   * price already agreed is a conversation after.
   *
   * It lives in the shared draft rather than in each form, so the sales order
   * and the invoice get the same switch from one place - 7 Oct put it on the
   * quotation alone, which left the other two with no way to turn tax off and
   * their papers printing a zero tax line.
   */
  const [gstOn, setGstOn] = useState(false);
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState(0);
  const [delivery, setDelivery] = useState(0);
  const [deliveryExempt, setDeliveryExempt] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState('road');
  const [courier, setCourier] = useState('');

  // --- words ---------------------------------------------------------------
  const [terms, setTerms] = useState(initialTerms);
  const [notes, setNotes] = useState('');

  // --- margin, internal ----------------------------------------------------
  const [autoMargin, setAutoMargin] = useState(true);
  const [costPrice, setCostPrice] = useState(0);
  const [transport, setTransport] = useState(0);
  const [incentive, setIncentive] = useState(0);

  const fillFromBuyer = (b: BuyerOption | undefined) => {
    if (!b) return;
    setName(b.name);
    setOrg(b.company ?? '');
    setPhone(b.phone.replace(/\D/g, '').slice(-10));
    setEmail(b.email ?? '');
    setGstin(b.gstin ?? '');
    setState(b.state ?? '');
    setCity(b.city ?? '');
    setAddress(b.address ?? '');
  };

  const addLine = (productId: string) => {
    const p = catalogue.find((x) => x.id === productId);
    if (!p) return;

    /**
     * Seed the AMC from the product's offer.
     *
     * An `included` AMC is ticked automatically - it is part of what the
     * customer is buying, not a decision. An `extra` one starts unticked so
     * somebody has to sell it: pre-ticking a chargeable add-on would put money
     * on an invoice nobody agreed to.
     *
     * The price and period are SNAPSHOTTED onto the line here, not read again
     * later, so repricing the product next April cannot change what this
     * customer was charged.
     */
    const offer: AmcOffer = {
      amcAvailable: p.amcAvailable ?? false,
      amcPricingMode: p.amcPricingMode ?? null,
      amcDurationMonths: p.amcDurationMonths ?? null,
      amcAnnualPricePaise: p.amcAnnualPricePaise ?? null,
      amcTerms: p.amcTerms ?? null,
    };
    const usable = offerIsUsable(offer);

    setLines((ls) => [
      ...ls,
      {
        key: `${p.id}-${Date.now()}`,
        productId: p.id,
        productName: p.name,
        productCode: p.code,
        hsn: p.hsn ?? null,
        qty: 1,
        unitPricePaise: priceBasis === 'mrp' ? p.mrpPaise : p.dlpPaise,
        mrpPaise: p.mrpPaise,
        discountPct: 0,
        taxRatePct: p.taxRatePct ?? 18,
        note: '',
        amcOpted: usable && isAutomatic(offer),
        amcMonths: usable ? termMonths(offer) : null,
        amcPricePaise: usable ? termPricePaise(offer) : null,
      },
    ]);
    setPick('');
  };

  /** A line typed by hand, for something not in the catalogue. */
  const addFreeLine = () =>
    setLines((ls) => [
      ...ls,
      {
        key: `free-${Date.now()}`,
        productId: null,
        productName: '',
        productCode: null,
        hsn: null,
        qty: 1,
        unitPricePaise: 0,
        mrpPaise: 0,
        discountPct: 0,
        taxRatePct: 18,
        note: '',
        // A hand-typed line has no product behind it, so there is no AMC offer
        // to read. Staff can still sell one by creating the contract directly
        // on the AMC screen.
        amcOpted: false,
        amcMonths: null,
        amcPricePaise: null,
      },
    ]);

  const patchLine = (key: string, p: Partial<DraftLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  /**
   * Same rule as the server: same state means CGST+SGST, anything else means
   * IGST, and the switch above beats both with NONE. Duplicated here only so
   * the summary updates as you type - the server decides what is actually
   * charged, and never trusts this.
   *
   * NONE is not "0%". A zero rate is a rate somebody chose and it still
   * prints; NONE means the document does not deal in tax at all, and the line
   * rates are left alone so switching back on restores the right tax without
   * anybody remembering what the rates were.
   */
  const taxMode: 'CGST_SGST' | 'IGST' | 'NONE' = !gstOn
    ? 'NONE'
    : storeState && state && storeState === state ? 'CGST_SGST' : 'IGST';

  const totals = useMemo(
    () =>
      computeTotals(
        lines.map((l) => ({
          qty: l.qty,
          unitPricePaise: l.unitPricePaise,
          discountPct: l.discountPct,
          taxRatePct: l.taxRatePct,
        })),
        {
          taxMode,
          discountType,
          discountValue:
            discountType === 'percent' ? discountValue : Math.round(discountValue * 100),
          deliveryPaise: Math.round(delivery * 100),
          deliveryExempt,
        },
      ),
    [lines, taxMode, discountType, discountValue, delivery, deliveryExempt],
  );

  // Auto margin follows the delivery charge already entered. Switching to
  // manual stops it, so an override is not silently undone the next time a
  // line changes.
  useEffect(() => {
    if (!autoMargin) return;
    setTransport(delivery);
  }, [autoMargin, delivery]);

  const basicPaise = totals.taxableBasePaise;
  const marginPaise =
    basicPaise
    - Math.round(costPrice * 100)
    - Math.round(transport * 100)
    - Math.round(incentive * 100);
  const marginPct = basicPaise > 0 ? (marginPaise / basicPaise) * 100 : 0;

  const categories = [...new Set(catalogue.map((p) => p.category).filter(Boolean))] as string[];
  const visibleProducts = catFilter ? catalogue.filter((p) => p.category === catFilter) : catalogue;
  const picked = catalogue.find((p) => p.id === pick);

  return {
    buyer: {
      buyerId, setBuyerId, name, setName, org, setOrg, phone, setPhone,
      email, setEmail, gstin, setGstin, state, setState, city, setCity,
      address, setAddress, shipSame, setShipSame, shipAddress, setShipAddress,
      fillFromBuyer,
    },
    items: {
      lines, setLines, pick, setPick, catFilter, setCatFilter,
      priceBasis, setPriceBasis, addLine, addFreeLine, patchLine, removeLine,
      picked, visibleProducts, categories,
    },
    money: {
      gstOn, setGstOn,
      discountType, setDiscountType, discountValue, setDiscountValue,
      delivery, setDelivery, deliveryExempt, setDeliveryExempt,
      deliveryMode, setDeliveryMode, courier, setCourier, taxMode, totals,
    },
    words: { terms, setTerms, notes, setNotes },
    margin: {
      autoMargin, setAutoMargin, costPrice, setCostPrice,
      transport, setTransport, incentive, setIncentive,
      basicPaise, marginPaise, marginPct,
    },
  };
}

export type DocumentDraft = ReturnType<typeof useDocumentDraft>;
