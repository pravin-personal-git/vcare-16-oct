'use client';

import { useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SectionCard, Field } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { formatCurrency } from '@/lib/format';
import {
  useDocumentDraft, type BuyerOption, type CatalogueItem,
} from '@/components/document/useDocumentDraft';
import {
  CustomerInfoCard, DeliveryChargeCard, OrderSummaryCard, ProfitAnalysisCard,
} from '@/components/document/DocumentCards';
import { ProductPicker, ProductLines } from '@/components/document/ProductLines';
import { TermsPicker } from '@/components/document/TermsPicker';
import { PendingAttachments, usePendingFiles } from '@/components/document/PendingAttachments';
import { addSalesOrder } from './actions';
import { useFieldRules } from '@/components/fields/useFieldRules';
import { SalespersonField } from '@/components/fields/SalespersonField';
import { ask } from '@/components/ui/ask';

/**
 * Direct order entry - a customer who never asked for a quotation.
 *
 * Built on the same cards as the quotation and invoice forms, so the three
 * screens cannot drift apart. It was narrower than both before this: no
 * delivery card, no summary, no margin panel, which meant a salesperson taking
 * a phone order could not see whether the price made money.
 *
 * Still deliberately without lead selection - an order is placed by a customer,
 * not a prospect. That path stays open through Quotation.
 */
export function SalesOrderForm({
  parties, products, storeState, onClose,
}: {
  parties: BuyerOption[];
  products: CatalogueItem[];
  storeState: string | null;
  onClose: () => void;
}) {
  // Settings > Custom Fields > Sales orders decides what appears here.
  const rules = useFieldRules('order');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const draft = useDocumentDraft({
    catalogue: products,
    storeState,
    initialTerms:
      '1. Delivery as per the agreed schedule.\n'
      + '2. Goods remain our property until paid for in full.\n'
      + '3. Shortages must be reported within 48 hours of delivery.',
  });
  const files = usePendingFiles();

  const [poNumber, setPoNumber] = useState('');
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expected, setExpected] = useState('');
  const [salesperson, setSalesperson] = useState('');

  const { lines } = draft.items;
  const { totals } = draft.money;
  const ready = lines.length > 0 && !!draft.buyer.name && /^\d{10}$/.test(draft.buyer.phone);

  const submit = () => {
    setError(null);
    if (!draft.buyer.name.trim()) return setError('Enter the customer name.');
    if (!/^\d{10}$/.test(draft.buyer.phone)) return setError('Enter a 10-digit phone number.');
    if (lines.length === 0) return setError('Add at least one line.');
    if (lines.some((l) => !l.productName.trim())) return setError('Every line needs a product name.');
    // Field rules (Settings > Custom Fields > Sales orders).
    if (rules.need('expectedDeliveryDate') && !expected) return setError('Expected Delivery is required.');
    if (rules.need('poNumber') && !poNumber.trim()) return setError('PO Number is required.');
    if (rules.need('notes') && !draft.words.notes.trim()) return setError('Notes are required.');
    if (rules.need('salespersonId') && !salesperson) return setError('Choose the salesperson.');

    start(async () => {
      const r = await addSalesOrder({
        partyId: draft.buyer.buyerId || null,
        customerName: draft.buyer.name,
        organizationName: draft.buyer.org || null,
        email: draft.buyer.email || null,
        phone: draft.buyer.phone,
        gstin: draft.buyer.gstin || null,
        billingAddress: draft.buyer.address || null,
        shippingAddress: draft.buyer.shipSame
          ? draft.buyer.address || null
          : draft.buyer.shipAddress || null,
        stateId: draft.buyer.state || null,
        cityId: draft.buyer.city || null,
        /*
          Tax off, if the switch in Order Summary says so (8 Oct 2026). The
          server re-decides what NONE means - it never trusts a posted
          taxMode - so this only says which of the two questions to ask.
        */
        noGst: !draft.money.gstOn,
        expectedDeliveryDate: expected ? new Date(expected) : null,
        poNumber: poNumber || null,
        discountType: draft.money.discountType,
        discountValue:
          draft.money.discountType === 'percent'
            ? draft.money.discountValue
            : Math.round(draft.money.discountValue * 100),
        deliveryPaise: Math.round(draft.money.delivery * 100),
        deliveryExempt: draft.money.deliveryExempt,
        deliveryMode: draft.money.deliveryMode,
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
        })),
      });

      if (r.error) return setError(r.error);

      // Files were held in the browser until the order had an id to hang them
      // off. A failure here does not undo the order; it is reported instead.
      if (files.count > 0 && r.id) {
        const failed = await files.uploadPending('sales_order', r.id);
        if (failed.length) {
          setError(
            `Order saved, but these files did not upload:\n${failed.join('\n')}\n\nAdd them again from the order.`,
          );
          return;
        }
      }

      if (r.message) await ask.tell(r.message);
      onClose();
      window.location.reload();
    });
  };

  return (
    <Modal
      title="Create New Sales Order"
      subtitle="The order number is generated when you save"
      icon="shopping-cart"
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
            <Button variant="primary" icon="check" loading={pending} disabled={!ready} onClick={submit}>
              Create Order
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-3">
          <SectionCard title="Order Information" icon="package">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Order Number" hint="Allocated when you save.">
                <input
                  value="Auto" disabled
                  className="field-input cursor-not-allowed bg-muted font-mono text-muted-foreground"
                />
              </Field>
              <Field label="Order Date" required>
                <input
                  type="date" value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  className="field-input"
                />
              </Field>
              {rules.show('expectedDeliveryDate') && (
                <Field label="Expected Delivery" required={rules.need('expectedDeliveryDate')}
                  hint="What you promised. Leave blank if not agreed.">
                  <input
                    type="date" value={expected}
                    onChange={(e) => setExpected(e.target.value)}
                    className="field-input"
                  />
                </Field>
              )}
            </div>

            {rules.show('salespersonId') && (
              <div className="mt-3 sm:w-1/2">
                <SalespersonField value={salesperson} onChange={setSalesperson} required={rules.need('salespersonId')} id="so-salesperson" />
              </div>
            )}

            {rules.show('poNumber') && (
              <div className="mt-3">
                <Field label="PO Number" required={rules.need('poNumber')}
                  hint="Their reference. Large buyers will not pay without it.">
                  <input
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder="Customer PO #"
                    className="field-input"
                  />
                </Field>
              </div>
            )}

            <div className="mt-3">
              <ProductPicker draft={draft} />
              <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Product List
              </p>
              <ProductLines draft={draft} />
            </div>
          </SectionCard>

          <SectionCard title="Notes & Terms" icon="file-text">
            <div className="space-y-3">
              {rules.show('notes') && (
                <Field label="Notes" required={rules.need('notes')} hint="Internal. Not printed.">
                  <textarea
                    value={draft.words.notes} rows={2}
                    onChange={(e) => draft.words.setNotes(e.target.value)}
                    className="field-input resize-none"
                  />
                </Field>
              )}
              <Field label="Terms & Conditions">
                <TermsPicker
                  docType="sales_order"
                  value={draft.words.terms}
                  onChange={draft.words.setTerms}
                  autoApply
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

        <div className="space-y-3">
          <CustomerInfoCard draft={draft} options={parties} />
          <DeliveryChargeCard draft={draft} />
          <OrderSummaryCard draft={draft} amountLabel="Order Total" />

          <p className="flex items-start gap-2 rounded-lg bg-info/10 px-3 py-2.5 text-xs leading-relaxed text-on-tint-info">
            <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            The order is created as <strong>Booked</strong> and unpaid. Stock does
            not move until you mark it Dispatched, and payment is recorded
            separately - the two run on their own tracks because an order can be
            delivered and still unpaid.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 whitespace-pre-line rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-on-tint-danger">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </Modal>
  );
}
