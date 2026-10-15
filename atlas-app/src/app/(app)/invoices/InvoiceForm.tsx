'use client';

import { useEffect, useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SectionCard, Field } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import { useFieldRules } from '@/components/fields/useFieldRules';
import { SalespersonField } from '@/components/fields/SalespersonField';
import { useDocumentDraft, type BuyerOption, type CatalogueItem } from '@/components/document/useDocumentDraft';
import {
  CustomerInfoCard, DeliveryChargeCard, OrderSummaryCard, ProfitAnalysisCard,
} from '@/components/document/DocumentCards';
import { ProductPicker, ProductLines } from '@/components/document/ProductLines';
import { TermsPicker } from '@/components/document/TermsPicker';
import { PendingAttachments, usePendingFiles } from '@/components/document/PendingAttachments';
import { addDirectInvoice, editInvoice, loadInvoiceForEdit } from './actions';
import { stockDelta } from '@/lib/line-delta';
import { istDate } from '@/lib/date-ranges';
import { SerialPickerCard, serialPickError, useSerialStock, type SerialPicks } from './SerialPicker';
import { ask } from '@/components/ui/ask';

/**
 * Create New Invoice - the counter sale.
 *
 * The reference lets an invoice be raised without a quotation or an order
 * behind it, and it is right to. Someone walks in, pays, and leaves with the
 * goods; making them wait while three documents are created in sequence is
 * ceremony that helps nobody.
 *
 * Saved as a draft, deliberately. The figures get one last look before the
 * document becomes something in the customer's hands - after Issue it cannot be
 * edited, only credited.
 */

const PAYMENT_TERMS = [
  { days: 0, label: 'Due on receipt' },
  { days: 7, label: 'Net 7' },
  { days: 15, label: 'Net 15' },
  { days: 30, label: 'Net 30' },
  { days: 45, label: 'Net 45' },
  { days: 60, label: 'Net 60' },
];

export function InvoiceForm({
  parties, products, storeState, onClose, editInvoiceId,
}: {
  parties: BuyerOption[];
  products: CatalogueItem[];
  storeState: string | null;
  onClose: () => void;
  /**
   * When set, the form corrects that invoice instead of raising a new one.
   *
   * Same form on purpose. An edit screen that looks different from the create
   * screen makes people hunt for the field they already know, and the two would
   * drift apart the first time either was changed.
   */
  editInvoiceId?: string;
}) {
  // Settings > Custom Fields > Invoices decides what appears here.
  const rules = useFieldRules('invoice');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The serials ticked per line (10 Oct 2026) - a new invoice only; an edit keeps the units it bound.
  const [serialPicks, setSerialPicks] = useState<SerialPicks>({});
  const [warning, setWarning] = useState<string | null>(null);

  const draft = useDocumentDraft({
    catalogue: products,
    storeState,
    initialTerms:
      '1. Goods once sold will not be taken back.\n'
      + '2. Interest at 18% per annum is charged on overdue amounts.\n'
      + '3. Subject to local jurisdiction.',
  });
  const files = usePendingFiles();

  const editing = !!editInvoiceId;
  const [loading, setLoading] = useState(editing);
  const [invoiceNo, setInvoiceNo] = useState<string | null>(null);
  const [version, setVersion] = useState(1);
  const [paidPaise, setPaidPaise] = useState(0);
  const [reason, setReason] = useState('');
  const [beforeLines, setBeforeLines] = useState<{ productId: string | null; productName: string; qty: number }[]>([]);

  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [termsDays, setTermsDays] = useState(15);
  const [poNumber, setPoNumber] = useState('');
  const [salesperson, setSalesperson] = useState('');
  /** Exclusive means the rates you typed are before tax, which is the norm. */
  const [gstMode, setGstMode] = useState<'exclusive' | 'inclusive'>('exclusive');

  // Loaded once, into the same draft the create path uses, so every field and
  // every total behaves identically whichever way you arrived here.
  useEffect(() => {
    if (!editInvoiceId) return;
    loadInvoiceForEdit(editInvoiceId).then((inv) => {
      if (!inv) { setError('That invoice could not be loaded.'); setLoading(false); return; }

      setInvoiceNo(inv.invoiceNo);
      setVersion(inv.version);
      setPaidPaise(inv.amountPaidPaise);
      // The INDIA date, not UTC - see the same line in QuotationForm (9 Oct 2026).
      setInvoiceDate(istDate(new Date(inv.invoiceDate)));
      setPoNumber(inv.poNumber ?? '');
      if (inv.salespersonId) setSalesperson(inv.salespersonId);

      draft.buyer.setName(inv.customerName);
      draft.buyer.setOrg(inv.organizationName ?? '');
      draft.buyer.setEmail(inv.email ?? '');
      draft.buyer.setPhone(inv.phone.replace(/\D/g, '').slice(-10));
      draft.buyer.setGstin(inv.gstin ?? '');
      draft.buyer.setAddress(inv.billingAddress ?? '');
      draft.buyer.setState(inv.stateId ?? '');
      draft.buyer.setCity(inv.cityId ?? '');

      // The switch opens the way the invoice was saved (9 Oct 2026). It used
      // to open OFF every time, so changing one price on a GST invoice and
      // saving quietly took the GST off.
      draft.money.setGstOn(inv.taxMode !== 'NONE');
      draft.money.setDelivery(inv.deliveryCharge / 100);
      draft.money.setDeliveryExempt(inv.deliveryExempt);
      draft.money.setDiscountType(inv.discountType as 'amount' | 'percent');
      draft.money.setDiscountValue(
        inv.discountType === 'percent' ? inv.discountValue : inv.discountValue / 100,
      );
      draft.words.setTerms(inv.termsBody ?? '');
      draft.words.setNotes(inv.notes ?? '');

      draft.items.setLines(inv.items.map((it, n) => ({
        key: `existing-${n}`,
        productId: it.productId,
        productName: it.productName,
        productCode: it.productCode,
        hsn: it.hsnCode,
        qty: it.qty,
        unitPricePaise: it.unitPricePaise,
        mrpPaise: 0,
        discountPct: it.discountPct,
        taxRatePct: it.taxRatePct,
        note: '',
        // Carried through as stored, not re-read from the product: this
        // invoice recorded what was agreed, and the product may have been
        // repriced since.
        amcOpted: it.amcOpted,
        amcMonths: it.amcMonths,
        amcPricePaise: it.amcPricePaise,
      })));

      // Kept so the screen can show what stock will move before you save.
      setBeforeLines(inv.items.map((it) => ({
        productId: it.productId, productName: it.productName, qty: it.qty,
      })));

      setLoading(false);
    });
    // Runs once for a given invoice; the draft setters are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editInvoiceId]);

  const { lines } = draft.items;
  const { totals } = draft.money;
  const serialStock = useSerialStock(editing ? [] : lines);

  // Worked out live from the same function the server uses, so what the screen
  // promises and what actually happens cannot disagree.
  const movements = editing ? stockDelta(beforeLines, lines) : [];
  const belowPaid = editing && totals.grandTotalPaise < paidPaise;

  const dueDate = (() => {
    const d = new Date(invoiceDate);
    d.setDate(d.getDate() + termsDays);
    return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
  })();

  const save = () => {
    setError(null);
    setWarning(null);

    if (!draft.buyer.name.trim()) return setError('Enter the customer name.');
    if (!/^\d{10}$/.test(draft.buyer.phone)) return setError('Enter a 10-digit phone number.');
    if (lines.length === 0) return setError('Add at least one line.');
    if (lines.some((l) => !l.productName.trim())) return setError('Every line needs a product name.');
    // Field rules (Settings > Custom Fields > Invoices).
    if (rules.need('poNumber') && !poNumber.trim()) return setError('PO Number is required.');
    if (rules.need('notes') && !draft.words.notes.trim()) return setError('Notes are required.');
    if (rules.need('salespersonId') && !salesperson) return setError('Choose the salesperson.');
    if (!editing) {
      const serialError = serialPickError(lines, serialStock, serialPicks);
      if (serialError) return setError(serialError);
    }

    if (editing) {
      if (!reason.trim()) {
        return setError('Say why this invoice is being changed. It goes on the record.');
      }
      if (belowPaid) {
        return setError(
          `₹${(paidPaise / 100).toLocaleString('en-IN')} has already been received against this invoice.`
          + ' The new total is less than that - raise a credit note for the difference instead.',
        );
      }

      return start(async () => {
        const res = await editInvoice(editInvoiceId!, {
          customerName: draft.buyer.name,
          organizationName: draft.buyer.org || null,
          email: draft.buyer.email || null,
          phone: draft.buyer.phone,
          gstin: draft.buyer.gstin || null,
          billingAddress: draft.buyer.address || null,
          shippingAddress: draft.buyer.shipSame ? null : draft.buyer.shipAddress || null,
          stateId: draft.buyer.state || null,
          cityId: draft.buyer.city || null,
          invoiceDateIso: invoiceDate,
          termsDays,
          poNumber: poNumber || null,
          deliveryChargePaise: Math.round(draft.money.delivery * 100),
          deliveryExempt: draft.money.deliveryExempt,
          discountType: draft.money.discountType,
          discountValue:
            draft.money.discountType === 'percent'
              ? draft.money.discountValue
              : Math.round(draft.money.discountValue * 100),
          termsBody: draft.words.terms || null,
          notes: draft.words.notes || null,
          salespersonId: rules.show('salespersonId') ? salesperson || null : undefined,
          reason,
          noGst: !draft.money.gstOn,
          lines: lines.map((l) => ({
            productId: l.productId,
            productName: l.productName,
            productCode: l.productCode,
            qty: l.qty,
            unitPricePaise: l.unitPricePaise,
            discountPct: l.discountPct,
            taxRatePct: l.taxRatePct,
            amcOpted: l.amcOpted,
            amcMonths: l.amcMonths,
            amcPricePaise: l.amcPricePaise,
          })),
        });
        if (res.error) return setError(res.error);
        if (res.message) await ask.tell(res.message);
        onClose();
        window.location.reload();
      });
    }

    start(async () => {
      const res = await addDirectInvoice({
        partyId: draft.buyer.buyerId || null,
        customerName: draft.buyer.name,
        organizationName: draft.buyer.org || null,
        email: draft.buyer.email || null,
        phone: draft.buyer.phone,
        gstin: draft.buyer.gstin || null,
        billingAddress: draft.buyer.address || null,
        shippingAddress: draft.buyer.shipSame ? null : draft.buyer.shipAddress || null,
        stateId: draft.buyer.state || null,
        cityId: draft.buyer.city || null,
        /*
          Tax off, if the switch in Order Summary says so (8 Oct 2026). The
          server re-decides what NONE means - it never trusts a posted
          taxMode - so this only says which of the two questions to ask.
        */
        noGst: !draft.money.gstOn,
        invoiceDateIso: invoiceDate,
        termsDays,
        poNumber: poNumber || null,
        deliveryChargePaise: Math.round(draft.money.delivery * 100),
        deliveryExempt: draft.money.deliveryExempt,
        discountType: draft.money.discountType,
        discountValue:
          draft.money.discountType === 'percent'
            ? draft.money.discountValue
            : Math.round(draft.money.discountValue * 100),
        termsBody: draft.words.terms || null,
        notes: draft.words.notes || null,
        salespersonId: rules.show('salespersonId') ? salesperson || null : undefined,
        lines: lines.map((l) => ({
          productId: l.productId,
          productName: l.productName,
          productCode: l.productCode,
          qty: l.qty,
          unitPricePaise: l.unitPricePaise,
          discountPct: l.discountPct,
          taxRatePct: l.taxRatePct,
          amcOpted: l.amcOpted,
          amcMonths: l.amcMonths,
          amcPricePaise: l.amcPricePaise,
          stockUnitIds: l.productId && serialStock.has(l.productId) ? serialPicks[l.key] ?? [] : undefined,
        })),
      });

      if (res.error || !res.id) return setError(res.error ?? 'Could not save the invoice.');

      // The document exists now, so the files finally have something to hang
      // off. A failure here does not undo the invoice - it is said plainly
      // instead, because a saved invoice with a missing attachment is a much
      // smaller problem than losing the invoice.
      if (files.count > 0) {
        const failed = await files.uploadPending('invoice', res.id);
        if (failed.length) {
          setWarning(
            `Invoice ${res.invoiceNo} saved, but these files did not upload:\n${failed.join('\n')}\n\nYou can add them again from the invoice.`,
          );
          return;
        }
      }

      window.location.href = `/invoices/${res.id}`;
    });
  };

  return (
    <Modal
      title={editing ? `Edit ${invoiceNo ?? 'Invoice'}` : 'Create New Invoice'}
      subtitle={
        editing
          ? `Version ${version} · every change is recorded with who and why`
          : 'A counter sale - no quotation or order needed'
      }
      icon="receipt"
      size="xl"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <span className="text-muted-foreground">Grand Total </span>
            <strong className="font-mono text-base tabular-nums">
              {formatCurrency(totals.grandTotalPaise)}
            </strong>
            <span className="ms-2 text-xs text-muted-foreground">
              {lines.length} line{lines.length === 1 ? '' : 's'}
              {files.count > 0 && ` · ${files.count} file${files.count === 1 ? '' : 's'}`}
            </span>
          </div>
          <div className="ms-auto flex items-center gap-2">
            <Button variant="outline" icon="x" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary" icon="check" loading={pending}
              disabled={loading || belowPaid}
              onClick={save}
            >
              {editing ? `Save as version ${version + 1}` : 'Save as Draft'}
            </Button>
          </div>
        </div>
      }
    >
      {editing && (
        <div className="mb-3 space-y-3">
          <div className="rounded-lg border border-warning/30 bg-warning/[0.06] p-3">
            <p className="flex items-start gap-2 text-xs leading-relaxed">
              <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                <strong>This invoice has already been issued.</strong> The
                customer may be holding a copy of version {version}. The number
                stays the same and the change is recorded - who, when, and why -
                but nothing tells their copy it is out of date. Tell them.
              </span>
            </p>
          </div>

          <Field
            label="Why is this being changed?"
            required
            hint="Goes on the permanent record. 'Wrong qty entered', 'customer added an item', 'rate corrected'."
          >
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for the correction"
              className="field-input"
              autoFocus
            />
          </Field>

          {movements.length > 0 && (
            <div className="rounded-lg border border-info/30 bg-info/[0.06] p-3">
              <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-info">
                <Icon name="package" className="h-3.5 w-3.5" />
                Stock will move when you save
              </p>
              <ul className="space-y-0.5 text-xs">
                {movements.map((m) => (
                  <li key={m.productId} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{m.productName}</span>
                    <span className="text-muted-foreground">
                      qty {m.oldQty} → {m.newQty}
                    </span>
                    <span className={`font-mono font-semibold ${m.qty > 0 ? 'text-success' : 'text-warning'}`}>
                      {m.qty > 0 ? `+${m.qty} back` : `${m.qty} out`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Only the difference moves. The original issue already took the
                first quantity out.
              </p>
            </div>
          )}

          {paidPaise > 0 && (
            <p className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs leading-relaxed ${
              belowPaid ? 'bg-danger/10 text-on-tint-danger' : 'bg-muted text-muted-foreground'
            }`}>
              <Icon name={belowPaid ? 'alert-circle' : 'credit-card'} className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {formatCurrency(paidPaise)} already received.
                {belowPaid
                  ? ` The new total of ${formatCurrency(totals.grandTotalPaise)} is less than that - `
                    + 'reducing an invoice below what has been paid turns the customer '
                    + 'into a creditor. Raise a credit note for the difference instead.'
                  : ' The new total stays at or above it, so the payment still applies.'}
              </span>
            </p>
          )}
        </div>
      )}

      {loading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Loading the invoice…</p>
      ) : (
      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        {/* ---------------------------------------------------------- left */}
        <div className="space-y-3">
          <SectionCard title="Product Information" icon="package">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Invoice Number" hint="Allocated when you save.">
                <input
                  value="Auto"
                  disabled
                  className="field-input cursor-not-allowed bg-muted font-mono text-muted-foreground"
                />
              </Field>
              <Field label="Invoice Date" required>
                <input
                  type="date" value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="field-input"
                />
              </Field>
              {rules.show('dueDate') && (
                <Field label="Due Date" required={rules.need('dueDate')} hint={`${dueDate} - from the terms below.`}>
                  <select
                    value={termsDays}
                    onChange={(e) => setTermsDays(Number(e.target.value))}
                    className="field-input"
                  >
                    {PAYMENT_TERMS.map((t) => (
                      <option key={t.days} value={t.days}>{t.label}</option>
                    ))}
                  </select>
                </Field>
              )}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {rules.show('salespersonId') && (
                <SalespersonField value={salesperson} onChange={setSalesperson} required={rules.need('salespersonId')} id="inv-salesperson" />
              )}
              {rules.show('poNumber') && (
                <Field label="PO Number" required={rules.need('poNumber')}
                  hint="Their reference. Large buyers will not pay without it.">
                  <input
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder="Customer PO #"
                    className="field-input"
                  />
                </Field>
              )}
              <Field
                label="GST Mode"
                hint={
                  gstMode === 'exclusive'
                    ? 'Rates are before tax. Tax is added on top.'
                    : 'Rates already include tax. Not yet applied to the maths - leave on Exclusive.'
                }
              >
                <select
                  value={gstMode}
                  onChange={(e) => setGstMode(e.target.value as 'exclusive' | 'inclusive')}
                  className="field-input"
                >
                  <option value="exclusive">Exclusive</option>
                  <option value="inclusive">Inclusive</option>
                </select>
              </Field>
            </div>

            <div className="mt-3">
              <ProductPicker draft={draft} />
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Product List
              </p>
              <ProductLines draft={draft} />
            </div>
          </SectionCard>

          {!editing && <SerialPickerCard lines={lines} stock={serialStock} picks={serialPicks} onChange={setSerialPicks} />}

          <SectionCard title="Notes & Terms" icon="file-text">
            <div className="space-y-3">
              {rules.show('notes') && (
                <Field label="Notes" required={rules.need('notes')} hint="Internal. Not printed on the invoice.">
                  <textarea
                    value={draft.words.notes} rows={2}
                    onChange={(e) => draft.words.setNotes(e.target.value)}
                    placeholder="Internal notes…"
                    className="field-input resize-none"
                  />
                </Field>
              )}
              <Field label="Terms & Conditions" hint="Printed at the foot of the invoice.">
                <TermsPicker
                  docType="invoice"
                  value={draft.words.terms}
                  onChange={draft.words.setTerms}
                  autoApply={!editing}
                  categories={draft.items.lines.map((l) => products.find((p) => p.id === l.productId)?.category)}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Attachments" icon="paperclip">
            <PendingAttachments pending={files} />
          </SectionCard>

          <ProfitAnalysisCard draft={draft} />
        </div>

        {/* --------------------------------------------------------- right */}
        <div className="space-y-3">
          <CustomerInfoCard draft={draft} options={parties} />
          <DeliveryChargeCard draft={draft} />
          <OrderSummaryCard draft={draft} />

          {lines.some((l) => l.productId) && (
            <p className="flex items-start gap-2 rounded-lg bg-info/10 px-3 py-2.5 text-xs leading-relaxed text-on-tint-info">
              <Icon name="package" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Stock leaves as soon as this is saved. A counter sale hands over
              the goods at the moment of billing - there is no dispatch step
              coming later to do it.
            </p>
          )}
        </div>
      </div>

      )}

      {warning && (
        <p role="alert" className="mt-3 flex items-start gap-2 whitespace-pre-line rounded-lg bg-warning/10 px-3 py-2.5 text-sm text-on-tint-warning">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
          {warning}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </Modal>
  );
}
