'use client';

import type { CustomerPrefill } from '@/server/customer-prefill';
import { BuyerSearch } from '@/components/document/BuyerSearch';
import { ProductFinder } from '@/components/document/ProductFinder';
import { TermsPicker } from '@/components/document/TermsPicker';
import { useFieldRules } from '@/components/fields/useFieldRules';
import { SalespersonField } from '@/components/fields/SalespersonField';
import { searchBuyersAction, searchLeadOptionsAction } from '@/app/actions/search-options';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SectionCard, Field, SummaryRow, Segmented, Badge } from '@/components/ui/Layout';
import { computeProfit, confidencePct } from '@/lib/quotation-profit';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { computeTotals } from '@/lib/quotation-totals';
import {
  offerIsUsable, isAutomatic, termMonths, termPricePaise, type AmcOffer,
} from '@/lib/amc-offer';
import { addQuotation, quickAddProduct, editQuotation, loadQuotation } from './actions';
import { PendingAttachments, usePendingFiles } from '@/components/document/PendingAttachments';
import { addCategory } from '../products/actions';
import { istDate } from '@/lib/date-ranges';
import { ask } from '@/components/ui/ask';

/**
 * The quotation form.
 *
 * The densest screen in the product: a buyer, a variable number of priced lines,
 * two levels of discount, a tax mode that depends on the buyer's state, delivery
 * that is charged after tax, and an internal margin panel that must never reach
 * the customer document.
 *
 * Laid out in two columns for a reason. The left is what the customer will read
 * - products, terms, attachments. The right is what decides the number -
 * who is buying, what tax applies, what it comes to. Salespeople work right to
 * left on this screen: pick the customer, then price the deal.
 */

export interface PartyOption {
  id: string; name: string; company: string | null; phone: string;
  email: string | null; city: string | null; state: string | null;
  gstin: string | null; address: string | null;
}
export interface LeadOption {
  id: string; name: string; company: string | null; phone: string;
  email: string | null; city: string | null; state: string | null; code: string;
}
export interface ProductOption {
  id: string; code: string; name: string;
  dlpPaise: number; mrpPaise: number; category: string | null; stock: number;
  subCategory?: string | null; brand?: string | null; hsn?: string | null;
  /** The GST master's rate for this product's HSN, when it has one. */
  taxRatePct?: number;
  /** Resolved unit cost. Null when nothing has been paid for this yet. */
  costPaise: number | null;
  /** The product's AMC offer, so a line can be seeded from it. */
  amcAvailable?: boolean;
  amcPricingMode?: string | null;
  amcDurationMonths?: number | null;
  amcAnnualPricePaise?: number | null;
  amcTerms?: string | null;
}

interface Line {
  key: string; productId: string | null; productName: string; productCode: string | null;
  qty: number; unitPricePaise: number; discountPct: number; taxRatePct: number;
  note: string;
  /**
   * The AMC quoted on this line.
   *
   * This form has its own line type rather than the shared `DraftLine`, so
   * these are declared here too. Carried to the order and then the invoice,
   * where issuing turns it into a contract - which is the whole point of AMC
   * reaching the quotation: a customer asking "how much with maintenance?"
   * gets the figure now rather than on the bill.
   *
   * Never added into `computeTotals` below: an extra-cost AMC is billed on its
   * own invoice, so quoting it in this total would promise a number the
   * customer will never be charged.
   */
  amcOpted: boolean; amcMonths: number | null; amcPricePaise: number | null;
}

const VALIDITY_PRESETS = [7, 15, 30, 45, 60, 90];

export function QuotationForm({
  parties, leads, products, storeState, categories, canAddProduct,
  editQuotationId, forLeadId, forCustomer, onClose,
}: {
  parties: PartyOption[]; leads: LeadOption[]; products: ProductOption[];
  storeState: string | null;
  categories: { id: string; name: string; codePrefix: string | null }[];
  canAddProduct: boolean;
  /** When set, the form edits that quotation instead of creating one. */
  editQuotationId?: string;
  /** G-27: opened from a lead's "Quotation" button - the buyer is that lead. */
  forLeadId?: string;
  /** G-39: opened from a customer's page - made out to them, details filled in. */
  forCustomer?: CustomerPrefill;
  onClose: () => void;
}) {
  // Products created here are appended locally so the salesperson can carry on
  // without a page reload; they are already saved server-side.
  // Settings > Custom Fields > Quotations decides what appears here.
  const rules = useFieldRules('quotation');
  const [catalogue, setCatalogue] = useState<ProductOption[]>(products);
  const [quickOpen, setQuickOpen] = useState(false);
  const [qp, setQp] = useState({
    name: '', categoryId: '', dlp: '', mrp: '', tax: '18', hsn: '', unit: 'pcs',
  });
  const [qpErr, setQpErr] = useState<string | null>(null);
  const [cats, setCats] = useState(categories);
  const [newCat, setNewCat] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [quotationNo, setQuotationNo] = useState<string | null>(null);

  const [buyerKind, setBuyerKind] = useState<'customer' | 'lead'>(forLeadId ? 'lead' : 'customer');
  const [buyerId, setBuyerId] = useState(forCustomer?.id ?? forLeadId ?? '');
  const [name, setName] = useState(forCustomer?.name ?? '');
  const [org, setOrg] = useState(forCustomer?.company ?? '');
  const [phone, setPhone] = useState(forCustomer ? forCustomer.phone.replace(/\D/g, '').slice(-10) : '');
  const [email, setEmail] = useState(forCustomer?.email ?? '');
  const [gstin, setGstin] = useState(forCustomer?.gstin ?? '');
  const [state, setState] = useState(forCustomer?.state ?? '');
  const [city, setCity] = useState(forCustomer?.city ?? '');
  const [address, setAddress] = useState(forCustomer?.address ?? '');
  const [shipSame, setShipSame] = useState(true);
  const [shipAddress, setShipAddress] = useState('');

  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validity, setValidity] = useState(15);
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState(0);
  const [delivery, setDelivery] = useState(0);
  const [deliveryExempt, setDeliveryExempt] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState('road');
  const [courier, setCourier] = useState('');
  const [terms, setTerms] = useState(
    '1. Products carry warranty as per company policy.\n' +
    '2. Fitting accessories and cable charged as actual.\n' +
    '3. 90% advance against delivery, 10% after installation.',
  );
  const [notes, setNotes] = useState('');
  const [salesperson, setSalesperson] = useState('');
  const files = usePendingFiles();

  // Internal margin panel. Never printed - see the note on the panel itself.
  const [autoMargin, setAutoMargin] = useState(true);
  const [costPrice, setCostPrice] = useState(0);
  const [transport, setTransport] = useState(0);
  const [incentive, setIncentive] = useState(0);

  /**
   * Fill the buyer panel from whichever record was picked.
   *
   * `kind` is passed in rather than read from `buyerKind`. The select handlers
   * call `setBuyerKind(...)` and then this function in the same event, and a
   * `setState` does not take effect until the next render - so reading the
   * state here got the value from *before* the click.
   *
   * The effect was that picking a lead filled nothing at all: buyerKind was
   * still 'customer', so it searched the customer list for a lead's id, found
   * nothing, and returned. Picking a customer worked purely because 'customer'
   * happens to be the initial value, which is why this survived.
   */
  // Rows come from the type-ahead pickers (26 Sep 2026) - the id alone is no
  // longer enough to find them, since the full lists are not loaded.
  const pickBuyer = (id: string, kind: 'customer' | 'lead', row?: { name: string; company: string | null; phone: string; email: string | null; gstin?: string | null; state: string | null; city: string | null; address?: string | null }) => {
    setBuyerId(id);
    if (kind === 'customer') {
      const p = (row as typeof parties[number] | undefined) ?? parties.find((x) => x.id === id);
      if (!p) return;
      setName(p.name); setOrg(p.company ?? ''); setPhone(p.phone.replace(/\D/g, '').slice(-10));
      setEmail(p.email ?? ''); setGstin(p.gstin ?? '');
      setState(p.state ?? ''); setCity(p.city ?? ''); setAddress(p.address ?? '');
    } else {
      const l = (row as typeof leads[number] | undefined) ?? leads.find((x) => x.id === id);
      if (!l) return;
      setName(l.name); setOrg(l.company ?? ''); setPhone(l.phone.replace(/\D/g, '').slice(-10));
      setEmail(l.email ?? ''); setGstin('');
      setState(l.state ?? ''); setCity(l.city ?? ''); setAddress('');
    }
  };

  const addLine = (productId: string) => {
    const p = catalogue.find((x) => x.id === productId);
    if (!p) return;

    // Same seeding rule as the shared line editor: an included AMC is ticked
    // for the customer because it comes with the product, an extra-cost one
    // starts unticked because somebody has to sell it.
    const offer: AmcOffer = {
      amcAvailable: p.amcAvailable ?? false,
      amcPricingMode: p.amcPricingMode ?? null,
      amcDurationMonths: p.amcDurationMonths ?? null,
      amcAnnualPricePaise: p.amcAnnualPricePaise ?? null,
      amcTerms: p.amcTerms ?? null,
    };
    const usable = offerIsUsable(offer);

    setLines((ls) => [...ls, {
      key: `${p.id}-${Date.now()}`, productId: p.id, productName: p.name,
      productCode: p.code, qty: 1, unitPricePaise: p.dlpPaise,
      // The GST master's rate for this HSN when there is one (26 Sep 2026).
      discountPct: 0, taxRatePct: p.taxRatePct ?? 18, note: '',
      amcOpted: usable && isAutomatic(offer),
      amcMonths: usable ? termMonths(offer) : null,
      amcPricePaise: usable ? termPricePaise(offer) : null,
    }]);
    setPick('');
  };

  const patch = (key: string, p: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const picked = catalogue.find((p) => p.id === pick);

  /**
      * GST on this document. OFF by default, every time (Vcare, 7 Oct 2026).
      *
      * Default OFF was Pravin's call and it is the safe default either way: a
      * document that should have carried tax and did not is a conversation
      * before it is sent, while one that quietly added 18% to a price already
      * agreed is a conversation after.
      *
      * Not remembered between documents on purpose. A sticky toggle is one
      * somebody forgets is on.
      */
  const [gstOn, setGstOn] = useState(false);

  // Same rule as the server: same state -> CGST+SGST, otherwise IGST. Off
  // means NONE, which shows nothing about tax anywhere.
  const taxMode: 'CGST_SGST' | 'IGST' | 'NONE' = !gstOn
    ? 'NONE'
    : storeState && state && storeState === state ? 'CGST_SGST' : 'IGST';

  const totals = useMemo(
    () => computeTotals(
      lines.map((l) => ({
        qty: l.qty, unitPricePaise: l.unitPricePaise,
        discountPct: l.discountPct, taxRatePct: l.taxRatePct,
      })),
      { taxMode, discountType,
        discountValue: discountType === 'percent' ? discountValue : Math.round(discountValue * 100),
        deliveryPaise: Math.round(delivery * 100), deliveryExempt },
    ),
    [lines, taxMode, discountType, discountValue, delivery, deliveryExempt],
  );

  /**
   * Auto margin.
   *
   * `costPrice` now follows the REAL cost of the lines - Σ qty × unit cost from
   * the purchase history. Until product cost existed this box could only ever
   * hold a number somebody typed, which is why the panel has been here since
   * the first build and has never meant anything.
   *
   * Switching to Manual stops both, so an override is not silently undone the
   * next time a line changes.
   */
  const autoCostPaise = useMemo(() => lines.reduce((sum, l) => {
    const p = catalogue.find((c) => c.id === l.productId);
    return sum + (p?.costPaise ? Math.round(l.qty * p.costPaise) : 0);
  }, 0), [lines, catalogue]);

  useEffect(() => {
    if (!autoMargin) return;
    setTransport(delivery);
    setCostPrice(autoCostPaise / 100);
  }, [autoMargin, delivery, autoCostPaise]);

  /**
   * Live margin preview.
   *
   * Uses the very same `totals` the Order Summary renders, so the two cannot
   * disagree - the profit is computed off the identical taxable base that GST
   * was charged on.
   *
   * A preview only. What gets stored is recomputed server-side on save.
   */
  const profit = useMemo(() => computeProfit(
    lines.map((l, i) => {
      const p = catalogue.find((c) => c.id === l.productId);
      return {
        qty: l.qty,
        netPaise: totals.lines[i]?.netPaise ?? 0,
        apportionedDiscountPaise: totals.lines[i]?.apportionedDiscountPaise ?? 0,
        // A free-text line has no product and therefore no cost.
        unitCostPaise: p?.costPaise ?? null,
      };
    }),
    {
      deliveryRevenuePaise: deliveryExempt ? 0 : Math.round(delivery * 100),
      transportPaise: Math.round(transport * 100),
      incentivePaise: Math.round(incentive * 100),
    },
  ), [lines, totals, catalogue, delivery, deliveryExempt, transport, incentive]);

  /** How much of the revenue has a real cost behind it. 100 = fully priced. */
  const costConfidence = confidencePct(profit);

  /**
   * Delivery charged to the customer is REVENUE.
   *
   * This block used to read `basicPaise - cost - transport - incentive`, which
   * subtracted the freight paid and never added the delivery charged. A
   * quotation that recovered its freight exactly - charge ₹500, pay ₹500 -
   * therefore showed a ₹500 loss, and one that ate the freight looked identical
   * to one that recovered it. Both readings are wrong in the direction that
   * makes a salesperson discount a deal they are already making money on.
   *
   * `lib/quotation-profit.ts` has always had this right and has a test for it;
   * the panel simply was never wired to it - `profit` was computed and then
   * ignored, which lint noticed and nobody read.
   */
  const deliveryRevenuePaise = deliveryExempt ? 0 : Math.round(delivery * 100);
  const revenuePaise = totals.taxableBasePaise + deliveryRevenuePaise;

  /**
   * In Auto the cost is the real one, summed per line from purchase history.
   * In Manual it is whatever was typed - that is the point of Manual, and
   * silently overriding it with the computed figure would make the toggle a lie.
   */
  const costPaise = autoMargin ? profit.goodsCostPaise : Math.round(costPrice * 100);

  const basicPaise = revenuePaise;
  const marginPaise =
    revenuePaise - costPaise - Math.round(transport * 100) - Math.round(incentive * 100);
  const marginPct = revenuePaise > 0 ? (marginPaise / revenuePaise) * 100 : 0;

  /** Lines with a product but no recorded cost - the margin's blind spot. */
  const uncostedLines = useMemo(
    () => lines.filter((l) => l.productId && !catalogue.find((c) => c.id === l.productId)?.costPaise).length,
    [lines, catalogue],
  );

  // Load the existing quotation when editing.
  useEffect(() => {
    if (!editQuotationId) return;
    loadQuotation(editQuotationId).then((q) => {
      if (!q) return;
      setQuotationNo(q.quotationNo);
      setName(q.customerName); setOrg(q.organizationName ?? '');
      setPhone(q.phone.replace(/\D/g, '').slice(-10)); setEmail(q.email ?? '');
      setGstin(q.gstin ?? ''); setState(q.stateId ?? ''); setCity(q.cityId ?? '');
      setAddress(q.billingAddress ?? '');
      setShipAddress(q.shippingAddress ?? '');
      setShipSame((q.shippingAddress ?? '') === (q.billingAddress ?? ''));
      // The INDIA date (9 Oct 2026): a quotation saved at midnight IST was
      // shown - and on save, stored - as the day before when read in UTC.
      setDate(istDate(new Date(q.quotationDate)));
      setTerms(q.termsBody ?? '');
      if (q.salespersonId) setSalesperson(q.salespersonId);
      // The switch opens the way the quotation was saved (9 Oct 2026). It
      // used to open OFF every time, so editing a GST quotation and saving
      // quietly took the GST off.
      setGstOn(q.taxMode !== 'NONE');
      setDelivery(q.deliveryCharge / 100);
      setTransport(q.profit.transportPaise / 100);
      setIncentive(q.profit.incentivePaise / 100);
      setLines(q.items.map((i, n) => ({
        key: `${i.srNo}-${n}`, productId: null, productName: i.productName,
        productCode: i.productCode, qty: i.qty, unitPricePaise: i.unitPricePaise,
        discountPct: i.discountPct, taxRatePct: i.taxRatePct, note: '',
        // Carried through as stored: this quotation recorded what was quoted,
        // and the product may have been repriced since.
        amcOpted: i.amcOpted, amcMonths: i.amcMonths, amcPricePaise: i.amcPricePaise,
      })));
    });
  }, [editQuotationId]);

  const submit = (andSend = false) => {
    setError(null);
    // Field rules (Settings > Custom Fields > Quotations).
    if (rules.need('notes') && !notes.trim()) return setError('Internal Notes are required.');
    if (rules.need('salespersonId') && !salesperson) return setError('Choose the salesperson.');
    if (rules.need('termsBody') && !terms.trim()) return setError('Terms & Conditions are required.');
    start(async () => {
      const payload = {
        leadId: buyerKind === 'lead' ? buyerId || null : null,
        partyId: buyerKind === 'customer' ? buyerId || null : null,
        customerName: name, organizationName: org || null, email: email || null,
        phone, gstin: gstin || null, billingAddress: address || null,
        shippingAddress: (shipSame ? address : shipAddress) || null,
        stateId: state || null, cityId: city || null,
        // The intent, not the mode. The server still decides whether "GST on"
        // means CGST+SGST or IGST - the toggle can only ever remove tax.
        noGst: !gstOn,
        validityPeriodDays: validity, discountType,
        discountValue: discountType === 'percent' ? discountValue : Math.round(discountValue * 100),
        deliveryPaise: Math.round(delivery * 100), deliveryExempt, deliveryMode,
        termsBody: terms || null, notes: notes || null,
        // Switched off in Field rules = not sent, and the server keeps its default.
        salespersonId: rules.show('salespersonId') ? salesperson || null : undefined,
        transportPaise: Math.round(transport * 100),
        incentivePaise: Math.round(incentive * 100),
        lines: lines.map((l) => ({
          productId: l.productId, productName: l.productName, productCode: l.productCode,
          qty: l.qty, unitPricePaise: l.unitPricePaise,
          discountPct: l.discountPct, taxRatePct: l.taxRatePct,
          amcOpted: l.amcOpted, amcMonths: l.amcMonths, amcPricePaise: l.amcPricePaise,
        })),
      };
      const r = editQuotationId
        ? await editQuotation(editQuotationId, payload)
        : await addQuotation(payload);
      if (r.error) { setError(r.error); return; }

      // The files were held in the browser until now, because there was no
      // document id to hang them off. A failure here does not undo the
      // quotation - it is reported instead, since a saved quotation missing an
      // attachment is a far smaller problem than losing the quotation.
      const targetId = editQuotationId ?? r.id;
      if (files.count > 0 && targetId) {
        const failed = await files.uploadPending('quotation', targetId);
        if (failed.length) {
          setError(
            `Saved, but these files did not upload:\n${failed.join('\n')}\n\nAdd them again from the quotation.`,
          );
          return;
        }
      }

      if (andSend && phone) {
        // The share link needs the saved record, so WhatsApp opens after the
        // reload rather than here. Flagged for the list screen to pick up.
        sessionStorage.setItem('atlas:share-after-save', '1');
      }
      if (r.message) await ask.tell(r.message);
      onClose();
      window.location.reload();
    });
  };

  const ready = lines.length > 0 && !!name && !!phone;

  return (
    <Modal
      title={editQuotationId ? 'Edit Quotation' : 'Create New Quotation'}
      subtitle={
        editQuotationId
          ? `${quotationNo ?? 'Loading…'} · totals are recalculated on save`
          : 'The quotation number is generated when you save'
      }
      icon="file-text"
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {lines.length} line{lines.length === 1 ? '' : 's'} ·{' '}
            <strong className="font-mono text-sm text-foreground">
              {formatCurrency(totals.grandTotalPaise)}
            </strong>
          </span>
          <div className="ms-auto grid grid-cols-2 gap-2 sm:flex">
            <Button variant="navy" icon="x" onClick={onClose}>Cancel</Button>
            <Button
              variant="outline" icon="eye"
              disabled={!ready}
              title={ready ? undefined : 'Add a customer and at least one product first'}
              onClick={() => void ask.tell({
                icon: 'eye',
                title: 'Save first, then preview',
                message: 'The preview is made from the saved quotation, so what you see is exactly what the customer receives. Save it, then open Preview from the quotation page.',
              })}
            >
              Preview
            </Button>
            <Button
              variant="accent" icon="download"
              onClick={() => submit(false)} loading={pending} disabled={!ready}
            >
              {editQuotationId ? 'Save changes' : 'Save'}
            </Button>
            <Button
              variant="success" icon="send"
              onClick={() => submit(true)} loading={pending} disabled={!ready}
            >
              Save and Send
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-3">
        {/* ============================================ LEFT: the document */}
        <div className="space-y-4 lg:col-span-2">
          <SectionCard title="Product Information" icon="package">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Quotation No" hint={editQuotationId ? undefined : 'Generated on save'}>
                <input
                  readOnly
                  value={quotationNo ?? 'Auto-generated'}
                  className="field-input bg-muted font-mono text-xs"
                />
              </Field>
              <Field label="Date">
                <input
                  type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  className="field-input"
                />
              </Field>
              {rules.show('validityPeriodDays') && (
                <Field label="Validity Period" required={rules.need('validityPeriodDays')}>
                  <select
                    value={validity}
                    onChange={(e) => setValidity(Number(e.target.value))}
                    className="field-input"
                  >
                    {VALIDITY_PRESETS.map((d) => (
                      <option key={d} value={d}>+{d} Days</option>
                    ))}
                  </select>
                </Field>
              )}
              {rules.show('salespersonId') && (
                <SalespersonField value={salesperson} onChange={setSalesperson} required={rules.need('salespersonId')} id="qt-salesperson" />
              )}
            </div>

            <div className="mt-3 flex gap-3">
              <div className="grid h-[4.5rem] w-[4.5rem] shrink-0 place-items-center rounded-lg border border-dashed border-border bg-muted/40 text-muted-foreground">
                {picked ? (
                  <span className="px-1 text-center font-mono text-xs leading-tight">
                    {picked.code}
                  </span>
                ) : (
                  <Icon name="package" className="h-6 w-6 opacity-40" />
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Product" className="min-w-[12rem] flex-1" hint="Narrow by category, sub-category and brand, or just type.">
                    <ProductFinder products={catalogue} pickedId={pick} onPick={setPick} />
                  </Field>

                  {(['DLP', 'MRP'] as const).map((k) => (
                    <div key={k} className="w-20 shrink-0 rounded border border-border bg-muted/50 px-2 py-1 text-center">
                      <p className="text-micro font-semibold uppercase text-muted-foreground">{k}</p>
                      <p className="font-mono text-xs font-semibold">
                        {picked
                          ? formatCurrency(k === 'DLP' ? picked.dlpPaise : picked.mrpPaise)
                          : '-'}
                      </p>
                    </div>
                  ))}

                  <Button
                    variant="success" icon="plus"
                    disabled={!pick}
                    onClick={() => pick && addLine(pick)}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>

            {canAddProduct && !quickOpen && (
              <button
                type="button" onClick={() => setQuickOpen(true)}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
              >
                <Icon name="plus" className="h-3 w-3" />
                Product not in the list? Add it here
              </button>
            )}

            {quickOpen && (
              <div className="mt-3 rounded-lg border border-brand/30 bg-brand/[0.05] p-3">
                <p className="mb-2 flex items-center gap-1.5 text-micro font-semibold uppercase text-brand">
                  <Icon name="plus" className="h-3 w-3" />
                  New product
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input placeholder="Product name *" value={qp.name}
                    onChange={(e) => setQp({ ...qp, name: e.target.value })}
                    className="field-input py-1.5 text-xs sm:col-span-3" />
                  <select value={qp.categoryId}
                    onChange={(e) => setQp({ ...qp, categoryId: e.target.value })}
                    className="field-input py-1.5 text-xs">
                    <option value="">Category (sets the code)</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}{c.codePrefix ? ` - ${c.codePrefix}-#####` : ''}
                      </option>
                    ))}
                  </select>
                  <input placeholder="Rate / DLP *" type="number" value={qp.dlp}
                    onChange={(e) => setQp({ ...qp, dlp: e.target.value })}
                    className="field-input py-1.5 text-xs" />
                  <input placeholder="MRP" type="number" value={qp.mrp}
                    onChange={(e) => setQp({ ...qp, mrp: e.target.value })}
                    className="field-input py-1.5 text-xs" />
                  <input placeholder="GST %" type="number" value={qp.tax}
                    onChange={(e) => setQp({ ...qp, tax: e.target.value })}
                    className="field-input py-1.5 text-xs" />
                  <input placeholder="HSN code" value={qp.hsn}
                    onChange={(e) => setQp({ ...qp, hsn: e.target.value })}
                    className="field-input py-1.5 text-xs" />
                  <input placeholder="Unit" value={qp.unit}
                    onChange={(e) => setQp({ ...qp, unit: e.target.value })}
                    className="field-input py-1.5 text-xs" />
                </div>

                <div className="mt-2 flex gap-1">
                  <input value={newCat} onChange={(e) => setNewCat(e.target.value)}
                    placeholder="New category name"
                    className="field-input flex-1 py-1 text-xs" />
                  <button type="button" disabled={!newCat.trim() || pending}
                    onClick={() => start(async () => {
                      const r = await addCategory(newCat.trim(), null, null);
                      if (r.error) { setQpErr(r.error); return; }
                      if (r.item) {
                        setCats((c) => [...c, { id: r.item!.id, name: r.item!.name, codePrefix: r.item!.codePrefix }]);
                        setQp((v) => ({ ...v, categoryId: r.item!.id }));
                        setNewCat('');
                      }
                    })}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded border border-brand px-2 text-xs font-medium text-brand transition hover:bg-brand/10 disabled:opacity-40">
                    <Icon name="plus" className="h-3 w-3" />
                    Category
                  </button>
                </div>

                {qpErr && <p className="mt-2 text-xs text-danger">{qpErr}</p>}

                <p className="mt-2 text-xs text-muted-foreground">
                  Saves to Products with zero stock. Complete the rest later from
                  the Products screen.
                </p>

                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => { setQuickOpen(false); setQpErr(null); }}
                    className="h-8 rounded border border-border bg-card px-3 text-xs font-medium transition hover:bg-muted">
                    Cancel
                  </button>
                  <button type="button" disabled={pending}
                    onClick={() => {
                      setQpErr(null);
                      start(async () => {
                        const r = await quickAddProduct({
                          productName: qp.name, categoryId: qp.categoryId || null,
                          dlp: Number(qp.dlp), mrp: Number(qp.mrp),
                          taxRatePct: Number(qp.tax) || 18,
                          hsnCode: qp.hsn || null, unit: qp.unit,
                        });
                        if (r.error || !r.product) { setQpErr(r.error ?? 'Could not save.'); return; }
                        // costPaise: null - a product created here has no
                        // purchase history yet, and null (not 0) is what keeps
                        // it out of the margin rather than counted as free.
                        setCatalogue((c) => [{ ...r.product!, costPaise: null }, ...c]);
                        setLines((ls) => [...ls, {
                          key: `${r.product!.id}-${Date.now()}`,
                          productId: r.product!.id, productName: r.product!.name,
                          productCode: r.product!.code, qty: 1,
                          unitPricePaise: r.product!.dlpPaise,
                          discountPct: 0, taxRatePct: Number(qp.tax) || 18, note: '',
                          // A product created inline carries no AMC offer yet -
                          // that is set from the Products screen afterwards.
                          amcOpted: false, amcMonths: null, amcPricePaise: null,
                        }]);
                        setQp({ name: '', categoryId: '', dlp: '', mrp: '', tax: '18', hsn: '', unit: 'pcs' });
                        setQuickOpen(false);
                      });
                    }}
                    className="h-8 rounded bg-brand px-3 text-xs font-medium text-brand-fg shadow-card transition hover:bg-brand-hover disabled:opacity-50">
                    {pending ? 'Saving…' : 'Save and add to quotation'}
                  </button>
                </div>
              </div>
            )}
          </SectionCard>

          {/* ---- product list --------------------------------------------- */}
          <SectionCard
            title="Product List" icon="menu"
            action={
              <span className="text-xs text-muted-foreground">
                Nos: <strong className="text-foreground">{lines.length}</strong>
                {' · '}
                <strong className="font-mono text-foreground">
                  {formatCurrency(totals.subtotalPaise - totals.itemDiscountPaise)}
                </strong>
              </span>
            }
            bodyClassName="p-0"
          >
            <div className="thin-scroll overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs font-semibold text-muted-foreground">
                  <tr>
                    <th className="w-10 px-2 py-2 text-start">Sr</th>
                    <th className="w-12 px-2 py-2 text-start">Img</th>
                    <th className="px-2 py-2 text-start">Product Name</th>
                    <th className="px-2 py-2 text-start">Code</th>
                    <th className="px-2 py-2 text-end">Qty</th>
                    <th className="px-2 py-2 text-end">Unit Price</th>
                    <th className="px-2 py-2 text-end">Disc%</th>
                    {/*
                      The Tax% column goes when GST is off (8 Oct 2026).
                      Pravin's screenshot had this reading 18 while the panel
                      beside it said "no tax at all" - two answers on one
                      screen. The LINE keeps its rate either way, so ticking
                      the switch back on brings the right tax straight back.
                    */}
                    {gstOn && <th className="px-2 py-2 text-end">Tax%</th>}
                    <th className="px-2 py-2 text-end">Total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.key} className="border-t border-border align-top">
                      <td className="px-2 py-2 text-xs text-muted-foreground">{i + 1}</td>
                      <td className="px-2 py-2">
                        <span className="grid h-8 w-8 place-items-center rounded border border-border bg-muted/40 text-muted-foreground">
                          <Icon name="package" className="h-3.5 w-3.5" />
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <p className="text-xs font-medium">{l.productName}</p>
                        <input
                          value={l.note}
                          onChange={(e) => patch(l.key, { note: e.target.value })}
                          placeholder="Product note / description (optional)"
                          className="mt-1 w-full max-w-xs rounded border border-dashed border-border bg-transparent px-2 py-1 text-xs outline-none focus:border-brand focus:bg-card"
                        />

                        {/*
                          The AMC, quotable. Only shows for a product that
                          offers one. The price is deliberately outside the
                          quotation total - it is billed separately - so the
                          line says so rather than leaving the customer to
                          wonder why the figures do not add up.
                        */}
                        {l.amcMonths !== null && (
                          l.amcPricePaise && l.amcPricePaise > 0 ? (
                            <label className="mt-1 flex max-w-xs cursor-pointer items-start gap-1.5 rounded border border-info/25 bg-info/[0.05] px-1.5 py-1">
                              <input
                                type="checkbox"
                                checked={l.amcOpted}
                                onChange={(e) => patch(l.key, { amcOpted: e.target.checked })}
                                className="mt-0.5 h-3 w-3 accent-[hsl(var(--brand-primary))]"
                              />
                              <span className="text-xs leading-tight">
                                <span className="font-medium">
                                  Quote AMC - {formatCurrency(l.amcPricePaise)} for {l.amcMonths} months
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  Not in the total below - invoiced separately once accepted.
                                </span>
                              </span>
                            </label>
                          ) : (
                            <p className="mt-1 max-w-xs rounded border border-success/25 bg-success/[0.05] px-1.5 py-1 text-xs leading-tight text-on-tint-success">
                              AMC included - {l.amcMonths} months cover at no extra charge.
                            </p>
                          )
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {l.productCode ?? '-'}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" min={1} value={l.qty}
                          onChange={(e) => patch(l.key, { qty: Math.max(1, Number(e.target.value)) })}
                          className="field-input w-16 px-1.5 py-1 text-end text-xs" />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" min={0} value={l.unitPricePaise / 100}
                          onChange={(e) => patch(l.key, { unitPricePaise: Math.round(Number(e.target.value) * 100) })}
                          className="field-input w-24 px-1.5 py-1 text-end text-xs" />
                      </td>
                      <td className="px-2 py-2">
                        <input type="number" min={0} max={100} value={l.discountPct}
                          onChange={(e) => patch(l.key, { discountPct: Number(e.target.value) })}
                          className="field-input w-16 px-1.5 py-1 text-end text-xs" />
                      </td>
                      {gstOn && (
                        <td className="px-2 py-2">
                          <input type="number" min={0} max={28} value={l.taxRatePct}
                            onChange={(e) => patch(l.key, { taxRatePct: Number(e.target.value) })}
                            className="field-input w-16 px-1.5 py-1 text-end text-xs" />
                        </td>
                      )}
                      <td className="px-2 py-2 text-end font-mono text-xs font-semibold">
                        {formatCurrency(totals.lines[i]?.netPaise ?? 0)}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                          title="Remove line"
                          className="grid h-6 w-6 place-items-center rounded text-danger transition hover:bg-danger/10"
                        >
                          <Icon name="x" className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-10 text-center">
                        <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
                          <Icon name="package" className="h-5 w-5" />
                        </span>
                        <p className="mt-2 text-xs text-muted-foreground">
                          No products yet. Pick one above and press Add.
                        </p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {/* Same switch as the order and invoice forms, under the prices
                  (9 Oct 2026). Bound to the one `gstOn`, so it and the one in
                  the customer card cannot disagree. */}
              <label className="flex cursor-pointer items-start gap-2 border-t border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={gstOn} onChange={(e) => setGstOn(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[hsl(var(--brand-primary))]" />
                <span>
                  <strong className="font-semibold text-foreground">Charge GST on this quotation</strong>
                  {!gstOn ? (
                    <>
                      {' '}&mdash; off, so there is no tax column here and none on the customer&rsquo;s copy.
                      Each product keeps its own rate; tick this and the right tax comes straight back.
                    </>
                  ) : (
                    <> &mdash; on, at each product&rsquo;s own rate.</>
                  )}
                </span>
              </label>
            </div>
          </SectionCard>

          {/* ---- attachments ----------------------------------------------- */}
          <SectionCard title="Product Brochures / Attachments" icon="paperclip">
            <PendingAttachments pending={files} />
          </SectionCard>

          {/* ---- agent ------------------------------------------------------ */}
          <SectionCard title="Agent / Supplier" icon="truck">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="1. Select agent or supplier…" className="min-w-[12rem] flex-1">
                <select disabled className="field-input">
                  <option>Select agent or supplier…</option>
                </select>
              </Field>
              <Field label="Amount" className="w-32">
                <div className="flex items-center rounded border border-border bg-card focus-within:border-brand">
                  <span className="ps-2 text-sm text-muted-foreground">₹</span>
                  <input type="number" min={0} defaultValue={0} disabled
                    className="w-full bg-transparent px-2 py-2 text-sm outline-none" />
                </div>
              </Field>
              <Button
                variant="success" icon="plus" disabled
                title="Agent commission tracking needs the Accounts module"
              >
                Add
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Agent commission posts to the ledger, so this needs the Accounts
              module before it can do anything real.
            </p>
          </SectionCard>

          {/* ---- terms ------------------------------------------------------ */}
          {rules.show('termsBody') && (
          <SectionCard title={`Terms &amp; Conditions${rules.need('termsBody') ? ' *' : ''}`} icon="file-text">
            <TermsPicker
              docType="quotation"
              value={terms}
              onChange={setTerms}
              autoApply={!editQuotationId}
              categories={lines.map((l) => catalogue.find((c) => c.id === l.productId)?.category)}
              placeholder="Quotation - Terms and Conditions"
            />
          </SectionCard>
          )}

          {/* ---- profit ------------------------------------------------------ */}
          <SectionCard
            title="Profit Analysis"
            icon="trending-up"
            action={
              <Segmented
                size="sm"
                value={autoMargin ? 'auto' : 'manual'}
                onChange={(v) => setAutoMargin(v === 'auto')}
                options={[
                  { value: 'auto', label: 'Auto-calculated' },
                  { value: 'manual', label: 'Manual' },
                ]}
              />
            }
          >
            <div className="grid gap-3 sm:grid-cols-3">
              {([
                ['Cost Price', costPrice, setCostPrice, 'Σ qty × cost, from purchase history'],
                ['Transport Charge', transport, setTransport, 'Freight you pay, not what you charge'],
                ['Sales Incentive', incentive, setIncentive, 'Commission owed on this deal'],
              ] as [string, number, (n: number) => void, string][]).map(([label, val, set, hint]) => (
                <Field key={label} label={label} hint={hint}>
                  <div className="flex items-center rounded border border-border bg-card transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
                    <span className="ps-2 text-sm text-muted-foreground">₹</span>
                    <input
                      type="number" min={0} value={val} disabled={autoMargin}
                      onChange={(e) => set(Number(e.target.value))}
                      className="w-full bg-transparent px-2 py-2 text-sm outline-none disabled:text-muted-foreground"
                    />
                  </div>
                </Field>
              ))}
            </div>

            <div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-3">
              <div>
                <p className="text-micro font-semibold uppercase text-muted-foreground">
                  Sales (Basic Price)
                </p>
                <p className="font-mono text-sm font-bold">{formatCurrency(basicPaise)}</p>
                {deliveryRevenuePaise > 0 && (
                  <p className="text-xs text-muted-foreground">
                    incl. {formatCurrency(deliveryRevenuePaise)} delivery charged
                  </p>
                )}
              </div>
              <div>
                <p className="text-micro font-semibold uppercase text-muted-foreground">Margin</p>
                <p className={`font-mono text-sm font-bold ${marginPaise < 0 ? 'text-danger' : 'text-success'}`}>
                  {formatCurrency(marginPaise)}
                </p>
              </div>
              <div>
                <p className="text-micro font-semibold uppercase text-muted-foreground">Margin %</p>
                <p className={`font-mono text-sm font-bold ${marginPct < 0 ? 'text-danger' : 'text-success'}`}>
                  {marginPct.toFixed(1)}%
                </p>
              </div>
            </div>

            {autoCostPaise === 0 && lines.some((l) => l.productId) ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Icon name="alert-circle" className="mt-px h-3.5 w-3.5 shrink-0" />
                No product here has a recorded purchase price, so the cost is whatever is typed
                above. Record one from <strong>Products → Purchase price</strong> and this fills
                itself.
              </p>
            ) : uncostedLines > 0 && autoMargin ? (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                <Icon name="alert-triangle" className="mt-px h-3.5 w-3.5 shrink-0" />
                {uncostedLines} line{uncostedLines === 1 ? '' : 's'} have no recorded cost and
                contribute nothing to the figure above, so the real margin is lower than this -
                treat it as a ceiling. Only <strong>{costConfidence}%</strong> of the revenue
                here has a real cost behind it.
              </p>
            ) : null}

            <p className="mt-2 flex items-start gap-1.5 rounded bg-navy/[0.06] px-2 py-1.5 text-xs text-on-tint-navy">
              <Icon name="lock" className="mt-px h-3.5 w-3.5 shrink-0" />
              Internal only. None of this appears on the customer document. GST is excluded - it is
              collected for the government, not earned.
            </p>
          </SectionCard>
        </div>

        {/* ============================================ RIGHT: the number */}
        <div className="space-y-4">
          <SectionCard
            title="Customer Info"
            icon="users"
            action={
              <Button
                size="sm" variant="outline" icon="user-plus"
                onClick={() => void ask.tell({
                  icon: 'user-plus',
                  title: 'Add the lead first',
                  message: 'Open Leads to add a new lead, then come back and pick it here.',
                })}
              >
                Add Lead
              </Button>
            }
          >
            <Field label="Select Lead">
              <BuyerSearch
                search={searchLeadOptionsAction}
                placeholder="Type a lead's name, business, phone or code…"
                selected={buyerKind === 'lead' && buyerId ? { id: buyerId, label: org ? `${org} - ${name}` : name, sub: phone } : null}
                onPick={(row) => { setBuyerKind('lead'); if (row) pickBuyer(row.id, 'lead', row); else setBuyerId(''); }}
              />
            </Field>

            <div className="my-2 flex items-center gap-2">
              <span className="h-px flex-1 bg-border" />
              <span className="text-micro font-bold uppercase text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <Field label="Select Customer">
              <BuyerSearch
                search={searchBuyersAction}
                selected={buyerKind === 'customer' && buyerId ? { id: buyerId, label: org ? `${org} - ${name}` : name, sub: phone } : null}
                onPick={(row) => { setBuyerKind('customer'); if (row) pickBuyer(row.id, 'customer', row); else setBuyerId(''); }}
              />
            </Field>

            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              <Field label="Customer Name" required>
                <input value={name} onChange={(e) => setName(e.target.value)}
                  className="field-input py-1.5 text-xs" />
              </Field>
              <Field label="Organization Name">
                <input value={org} onChange={(e) => setOrg(e.target.value)}
                  className="field-input py-1.5 text-xs" />
              </Field>
              <Field label="Email">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="field-input py-1.5 text-xs" />
              </Field>
              <Field label="Phone" required>
                <input value={phone} onChange={(e) => setPhone(e.target.value)}
                  className="field-input py-1.5 text-xs" />
              </Field>
              <Field label="GST Number" className="sm:col-span-2">
                <input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())}
                  maxLength={15} placeholder="15-character GSTIN"
                  className="field-input py-1.5 font-mono text-xs" />
              </Field>
              <Field label="Billing Address" className="sm:col-span-2">
                <input value={address} onChange={(e) => setAddress(e.target.value)}
                  className="field-input py-1.5 text-xs" />
              </Field>
            </div>

            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox" checked={shipSame}
                onChange={(e) => setShipSame(e.target.checked)}
                className="h-3.5 w-3.5 accent-[hsl(var(--brand-primary))]"
              />
              Same as Billing Address
            </label>

            <Field label="Shipping Address" className="mt-2">
              <input
                value={shipSame ? address : shipAddress}
                onChange={(e) => setShipAddress(e.target.value)}
                disabled={shipSame}
                className="field-input py-1.5 text-xs"
              />
            </Field>

            <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
              <Field label="State">
                <input value={state} onChange={(e) => setState(e.target.value)}
                  className="field-input py-1.5 text-xs" />
              </Field>
              <Field label="City">
                <input value={city} onChange={(e) => setCity(e.target.value)}
                  className="field-input py-1.5 text-xs" />
              </Field>
            </div>

            {/*
              THE GST TOGGLE (Vcare, 7 Oct 2026).

              Off every time a document is started. Pravin's call, and the safe
              one either way: a document that should have carried tax and did
              not is a conversation before it is sent, while one that quietly
              added 18% to a price already agreed is a conversation after.

              It sits HERE, beside the state, because this is where the tax
              question is already answered on this form - putting it near the
              totals would make it look like a discount.
            */}
            <label className="mt-3 flex cursor-pointer items-center gap-2 rounded border border-border px-2 py-1.5">
              <input
                type="checkbox"
                checked={gstOn}
                onChange={(e) => setGstOn(e.target.checked)}
                className="h-3.5 w-3.5 accent-[hsl(var(--brand-primary))]"
              />
              <span className="text-xs font-medium">Charge GST on this quotation</span>
            </label>

            {!gstOn ? (
              <p className="mt-2 flex items-start gap-1.5 rounded bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                <Icon name="info" className="mt-px h-3.5 w-3.5 shrink-0" />
                No GST. The customer&rsquo;s copy shows no tax column and no tax line at all.
              </p>
            ) : (
              <p
                className={`mt-2 flex items-start gap-1.5 rounded px-2 py-1.5 text-xs ${
                  taxMode === 'IGST' ? 'bg-warning/10 text-on-tint-warning' : 'bg-success/10 text-on-tint-success'
                }`}
              >
                <Icon
                  name={taxMode === 'IGST' ? 'alert-circle' : 'check-circle'}
                  className="mt-px h-3.5 w-3.5 shrink-0"
                />
                {taxMode === 'IGST'
                  ? state
                    ? `Inter-State Supply - ${state} vs ${storeState ?? '-'} - IGST applies`
                    : 'Customer state missing - IGST will apply'
                  : `Intra-State Supply - CGST + SGST applies`}
              </p>
            )}
          </SectionCard>

          {/* ---- delivery ---------------------------------------------------- */}
          <SectionCard title="Delivery Charge" icon="truck">
            <Field label="Courier">
              <select
                value={courier} onChange={(e) => setCourier(e.target.value)}
                className="field-input"
              >
                <option value="">- Select Courier -</option>
                <option value="self">Self / Own vehicle</option>
                <option value="transport">Transport agency</option>
                <option value="courier">Courier service</option>
              </select>
            </Field>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Segmented
                size="sm"
                value={deliveryMode}
                onChange={setDeliveryMode}
                options={[
                  { value: 'road', label: 'Road', icon: 'truck' },
                  { value: 'air', label: 'Air', icon: 'send' },
                ]}
              />
              <div className="flex flex-1 items-center rounded border border-border bg-card focus-within:border-brand">
                <span className="ps-2 text-sm text-muted-foreground">₹</span>
                <input
                  type="number" min={0} value={delivery} disabled={deliveryExempt}
                  onChange={(e) => setDelivery(Number(e.target.value))}
                  className="w-full bg-transparent px-2 py-1.5 text-sm outline-none disabled:opacity-40"
                />
              </div>
              <button
                type="button" onClick={() => setDeliveryExempt((x) => !x)}
                className={`h-8 shrink-0 rounded border px-2 text-xs font-medium transition ${
                  deliveryExempt
                    ? 'border-brand bg-brand text-brand-fg'
                    : 'border-border bg-card hover:bg-muted'
                }`}
              >
                Exempt
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Delivery is added after tax and is not itself taxed.
            </p>
          </SectionCard>

          {/* ---- summary ----------------------------------------------------- */}
          <SectionCard title="Order Summary" icon="receipt">
            <SummaryRow label="Order Amount (DLP)" value={formatCurrency(totals.subtotalPaise)} />
            <SummaryRow label="Item Discounts" value={`− ${formatCurrency(totals.itemDiscountPaise)}`} />

            <div className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span className="text-muted-foreground">Discount</span>
              <div className="flex items-center gap-1">
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as 'amount' | 'percent')}
                  className="h-8 rounded border border-border bg-card px-1.5 text-xs outline-none focus:border-brand"
                >
                  <option value="amount">₹</option>
                  <option value="percent">%</option>
                </select>
                <input
                  type="number" min={0} value={discountValue}
                  onChange={(e) => setDiscountValue(Number(e.target.value))}
                  className="field-input w-24 py-1 text-end text-xs"
                />
                <span className="w-24 shrink-0 text-end font-mono text-xs text-danger">
                  − {formatCurrency(totals.orderDiscountPaise)}
                </span>
              </div>
            </div>

            <SummaryRow label="Delivery Charge" value={formatCurrency(totals.deliveryPaise)} />

            <div className="my-2 h-px bg-border" />
            <SummaryRow label="Taxable Value" value={formatCurrency(totals.taxableBasePaise)} />

            {taxMode === 'IGST' ? (
              <SummaryRow
                label={<span className="flex items-center gap-1.5">GST <Badge tone="warning">IGST</Badge></span>}
                value={formatCurrency(totals.igstPaise)}
              />
            ) : (
              <>
                <SummaryRow
                  label={<span className="flex items-center gap-1.5">GST <Badge tone="success">CGST+SGST</Badge></span>}
                  value={formatCurrency(totals.cgstPaise + totals.sgstPaise)}
                />
                <SummaryRow label="· CGST" value={formatCurrency(totals.cgstPaise)} />
                <SummaryRow label="· SGST" value={formatCurrency(totals.sgstPaise)} />
              </>
            )}

            <SummaryRow strong label="Order Amt + GST" value={formatCurrency(totals.grandTotalPaise)} />
          </SectionCard>

          {rules.show('notes') && (
            <SectionCard title={`Internal Notes${rules.need('notes') ? ' *' : ''}`} icon="file-text">
              <textarea
                value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
                placeholder="Not printed on the customer document."
                className="field-input text-xs"
              />
            </SectionCard>
          )}

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-on-tint-danger">
              <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <p className="text-xs leading-relaxed text-muted-foreground">
            Totals shown here are recomputed on the server before saving - the
            browser&rsquo;s figures are for display only.
          </p>
        </div>
      </div>
    </Modal>
  );
}
