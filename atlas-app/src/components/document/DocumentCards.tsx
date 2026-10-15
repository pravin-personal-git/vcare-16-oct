'use client';

import { BuyerSearch } from './BuyerSearch';
import { searchBuyersAction } from '@/app/actions/search-options';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { SectionCard, Field, SummaryRow, Segmented } from '@/components/ui/Layout';
import { formatCurrency } from '@/lib/format';
import type { BuyerOption, DocumentDraft } from './useDocumentDraft';

/**
 * The cards a sales document is built from.
 *
 * The reference lays every create screen out the same way - Product
 * Information and the line table down the left, buyer and money down the
 * right. Quotation, sales order and invoice all use these, so the three
 * screens cannot drift apart by accident.
 */

/* ------------------------------------------------------------------ buyer */

export function CustomerInfoCard({
  draft,
  label = 'Customer',
  onAddNew,
  disabled = false,
}: {
  draft: DocumentDraft;
  /** No longer used - the picker searches the server as you type. Kept so callers need not change. */
  options?: BuyerOption[];
  label?: string;
  onAddNew?: () => void;
  disabled?: boolean;
}) {
  const b = draft.buyer;

  return (
    <SectionCard
      title="Customer Info"
      icon="users"
      action={
        onAddNew && (
          <Button size="sm" variant="outline" icon="user-plus" onClick={onAddNew}>
            Add Customer
          </Button>
        )
      }
    >
      <div className="space-y-3">
        <Field label={`Select ${label}`} required hint="Search an existing customer - or leave this empty and type a new customer's details below.">
          <BuyerSearch
            disabled={disabled}
            search={searchBuyersAction}
            selected={b.buyerId ? { id: b.buyerId, label: b.org ? `${b.org} - ${b.name}` : b.name, sub: b.phone } : null}
            onPick={(row) => {
              b.setBuyerId(row?.id ?? '');
              if (row) b.fillFromBuyer(row);
            }}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer Name" required>
            <input value={b.name} onChange={(e) => b.setName(e.target.value)} className="field-input" />
          </Field>
          <Field label="Company">
            <input value={b.org} onChange={(e) => b.setOrg(e.target.value)} className="field-input" />
          </Field>
          <Field label="Email">
            <input
              type="email" value={b.email}
              onChange={(e) => b.setEmail(e.target.value)}
              className="field-input"
            />
          </Field>
          <Field label="Phone" required>
            <input
              value={b.phone} inputMode="numeric" maxLength={10}
              onChange={(e) => b.setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              className="field-input font-mono"
            />
          </Field>
        </div>

        <Field
          label="GST Number"
          hint="Leave blank for an unregistered buyer. The state decides CGST+SGST versus IGST, not this field."
        >
          <input
            value={b.gstin}
            onChange={(e) => b.setGstin(e.target.value.toUpperCase().slice(0, 15))}
            placeholder="22AAAAA0000A1Z5"
            className="field-input font-mono uppercase"
          />
        </Field>

        <Field label="Address">
          <textarea
            value={b.address} rows={2}
            onChange={(e) => b.setAddress(e.target.value)}
            className="field-input resize-none"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="State" required hint="Drives the tax split.">
            <input value={b.state} onChange={(e) => b.setState(e.target.value)} className="field-input" />
          </Field>
          <Field label="City">
            <input value={b.city} onChange={(e) => b.setCity(e.target.value)} className="field-input" />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox" checked={b.shipSame}
            onChange={(e) => b.setShipSame(e.target.checked)}
            className="h-3.5 w-3.5 accent-brand"
          />
          Ship to the same address
        </label>
        {!b.shipSame && (
          <Field label="Shipping Address">
            <textarea
              value={b.shipAddress} rows={2}
              onChange={(e) => b.setShipAddress(e.target.value)}
              className="field-input resize-none"
            />
          </Field>
        )}
      </div>
    </SectionCard>
  );
}

/* -------------------------------------------------------------- delivery */

const COURIERS = ['Delhivery', 'Blue Dart', 'DTDC', 'Gati', 'Safexpress', 'India Post', 'Own vehicle'];

export function DeliveryChargeCard({ draft }: { draft: DocumentDraft }) {
  const m = draft.money;

  return (
    <SectionCard title="Delivery Charge" icon="truck">
      <div className="space-y-3">
        <Field label="Courier">
          <select
            value={m.courier}
            onChange={(e) => m.setCourier(e.target.value)}
            className="field-input"
          >
            <option value="">- select courier -</option>
            {COURIERS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>

        <Segmented
          value={m.deliveryMode}
          onChange={m.setDeliveryMode}
          options={[
            { value: 'road', label: 'Road', icon: 'truck' },
            { value: 'air', label: 'Air', icon: 'send' },
          ]}
        />

        <Field
          label="Charge"
          hint={
            m.deliveryExempt
              ? 'Exempt - delivery is added after tax, so no GST is charged on it.'
              : 'Taxed at the same rate as the goods, which is the usual treatment for a composite supply.'
          }
        >
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center rounded-lg border border-border bg-card transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
              <span className="ps-3 text-sm text-muted-foreground">₹</span>
              <input
                type="number" min={0} step={10} value={m.delivery}
                onChange={(e) => m.setDelivery(Number(e.target.value))}
                className="w-full bg-transparent px-2 py-2 text-sm outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => m.setDeliveryExempt((v: boolean) => !v)}
              aria-pressed={m.deliveryExempt}
              className={`h-9 shrink-0 rounded-lg border px-3 text-sm font-medium transition ${
                m.deliveryExempt
                  ? 'border-warning bg-warning/15 text-on-tint-warning'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              Exempt
            </button>
          </div>
        </Field>
      </div>
    </SectionCard>
  );
}

/* --------------------------------------------------------------- summary */

export function OrderSummaryCard({
  draft,
  amountLabel = 'Grand Total',
}: {
  draft: DocumentDraft;
  amountLabel?: string;
}) {
  const { totals, discountType, setDiscountType, discountValue, setDiscountValue, taxMode, gstOn, setGstOn } =
    draft.money;
  const noTax = taxMode === 'NONE';

  return (
    <SectionCard title="Order Summary" icon="receipt">
      <div className="space-y-1">
        <SummaryRow label="Sub Total" value={formatCurrency(totals.subtotalPaise)} />

        {totals.itemDiscountPaise > 0 && (
          <SummaryRow
            label="Line discounts"
            value={`−${formatCurrency(totals.itemDiscountPaise)}`}
            tone="danger"
          />
        )}

        <div className="flex items-center gap-2 py-1.5">
          <span className="text-sm text-muted-foreground">Discount</span>
          <select
            value={discountType}
            onChange={(e) => setDiscountType(e.target.value as 'amount' | 'percent')}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs outline-none focus:border-brand"
          >
            <option value="amount">Flat</option>
            <option value="percent">%</option>
          </select>
          <input
            type="number" min={0} step={discountType === 'percent' ? 0.5 : 100}
            value={discountValue}
            onChange={(e) => setDiscountValue(Number(e.target.value))}
            className="h-8 w-24 rounded-lg border border-border bg-card px-2 text-end text-xs tabular-nums outline-none focus:border-brand"
          />
          <span className="ms-auto font-mono text-sm tabular-nums text-danger">
            −{formatCurrency(totals.orderDiscountPaise)}
          </span>
        </div>

        {/*
          THE GST SWITCH (Vcare, 8 Oct 2026).

          It belongs here, beside the totals it changes, rather than up with
          the customer's state - somebody turning tax off is thinking about
          the price, not about which state anybody is in.

          With it off there is no Taxable Value row either. Taxable value is a
          tax idea; on a document that does not deal in tax it is the subtotal
          said twice.
        */}
        <label className="flex cursor-pointer items-center gap-2 border-t border-border py-2">
          <input
            type="checkbox"
            checked={gstOn}
            onChange={(e) => setGstOn(e.target.checked)}
            className="h-3.5 w-3.5 accent-[hsl(var(--brand-primary))]"
          />
          <span className="text-sm font-medium">Charge GST</span>
        </label>

        {!noTax && (
          <>
            <SummaryRow label="Taxable Value" value={formatCurrency(totals.taxableBasePaise)} />
            {taxMode === 'CGST_SGST' ? (
              <>
                <SummaryRow label="CGST" value={formatCurrency(totals.cgstPaise)} />
                <SummaryRow label="SGST" value={formatCurrency(totals.sgstPaise)} />
              </>
            ) : (
              <SummaryRow label="IGST" value={formatCurrency(totals.igstPaise)} />
            )}
          </>
        )}

        {totals.deliveryPaise > 0 && (
          <SummaryRow label="Delivery" value={formatCurrency(totals.deliveryPaise)} />
        )}

        <div className="mt-2 flex items-center justify-between rounded-lg bg-navy px-3 py-2.5 text-navy-fg">
          <span className="text-sm font-semibold">{amountLabel}</span>
          <span className="font-mono text-lg font-bold tabular-nums">
            {formatCurrency(totals.grandTotalPaise)}
          </span>
        </div>

        <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
          {noTax ? (
            <>No GST on this one. The customer&rsquo;s copy shows no tax column and no tax line at all.</>
          ) : (
            <>
              {taxMode === 'CGST_SGST'
                ? 'Same state as the store, so tax splits into CGST and SGST.'
                : 'Different state, or no state given, so IGST applies.'}
              {' '}Tax is charged after the discount - the other order round the discount
              would silently change what you owe the government.
            </>
          )}
        </p>
      </div>
    </SectionCard>
  );
}

/* ---------------------------------------------------------------- margin */

export function ProfitAnalysisCard({ draft }: { draft: DocumentDraft }) {
  const m = draft.margin;
  const [open, setOpen] = useState(true);

  const money = (label: string, value: number, set: (n: number) => void, disabled = false) => (
    <Field label={label}>
      <div className={`flex items-center rounded-lg border border-border bg-card ${disabled ? 'opacity-60' : ''}`}>
        <span className="ps-3 text-sm text-muted-foreground">₹</span>
        <input
          type="number" min={0} step={100} value={value} disabled={disabled}
          onChange={(e) => set(Number(e.target.value))}
          className="w-full bg-transparent px-2 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        />
      </div>
    </Field>
  );

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/[0.06]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-start"
      >
        <Icon name="trending-up" className="h-4 w-4 text-warning" />
        <h3 className="text-sm font-semibold">Profit Analysis</h3>
        <span className="rounded bg-warning/20 px-1.5 py-0.5 text-micro font-semibold uppercase text-on-tint-warning">
          Internal
        </span>
        <span className="ms-auto font-mono text-sm font-bold tabular-nums">
          {formatCurrency(m.marginPaise)}
          <span className="ms-1.5 text-xs font-normal text-muted-foreground">
            {m.marginPct.toFixed(1)}%
          </span>
        </span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <div className="border-t border-warning/20 p-4">
          <label className="mb-3 flex items-center gap-2 text-xs">
            <input
              type="checkbox" checked={m.autoMargin}
              onChange={(e) => m.setAutoMargin(e.target.checked)}
              className="h-3.5 w-3.5 accent-[hsl(var(--warning))]"
            />
            Follow the delivery charge automatically
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            {money('Cost Price', m.costPrice, m.setCostPrice)}
            {money('Transport', m.transport, m.setTransport, m.autoMargin)}
            {money('Incentive', m.incentive, m.setIncentive)}
          </div>

          <dl className="mt-3 space-y-1 border-t border-warning/20 pt-3">
            <SummaryRow label="Sales (Basic)" value={formatCurrency(m.basicPaise)} />
            <SummaryRow
              label="Margin"
              value={`${formatCurrency(m.marginPaise)} · ${m.marginPct.toFixed(1)}%`}
              strong
              tone={m.marginPaise >= 0 ? 'success' : 'danger'}
            />
          </dl>

          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Never printed and never shared. It exists so the person quoting can
            see whether the price still makes money before they send it - which
            is the moment the decision is actually made.
          </p>
        </div>
      )}
    </div>
  );
}
