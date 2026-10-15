'use client';

import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/format';
import { availabilityWords } from '@/lib/unit-allocation';
import type { DocumentDraft } from './useDocumentDraft';
import { rateOptions, useTaxRates } from './useTaxRates';
import { ProductFinder } from './ProductFinder';

/**
 * The product picker and the line table.
 *
 * The reference puts a single row above the table - thumbnail, product search,
 * a DLP chip, an MRP chip, and Add - and shows both prices *before* you commit
 * to the line. That ordering matters: the salesperson decides which price to
 * offer at the moment of picking, not by editing a rate afterwards and hoping
 * they remembered the list price.
 */

export function ProductPicker({
  draft,
  onQuickAdd,
}: {
  draft: DocumentDraft;
  onQuickAdd?: () => void;
}) {
  const it = draft.items;
  const p = it.picked;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid h-[3.25rem] w-[3.25rem] shrink-0 place-items-center rounded-lg border border-border bg-card">
          <Icon name="package" className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="min-w-[14rem] flex-1">
          <ProductFinder products={it.visibleProducts} pickedId={it.pick} onPick={it.setPick} />
        </div>

        {/* Both prices, side by side, before the line is added. */}
        <PriceChip
          label="DLP" tone="brand"
          value={p ? formatCurrency(p.dlpPaise) : '-'}
          active={it.priceBasis === 'dlp'}
          onClick={() => it.setPriceBasis('dlp')}
        />
        <PriceChip
          label="MRP" tone="warning"
          value={p ? formatCurrency(p.mrpPaise) : '-'}
          active={it.priceBasis === 'mrp'}
          onClick={() => it.setPriceBasis('mrp')}
        />

        <Button
          variant="success" icon="plus" disabled={!it.pick}
          onClick={() => it.pick && it.addLine(it.pick)}
        >
          Add
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Adding at <strong className="text-foreground">{it.priceBasis.toUpperCase()}</strong> -
          the rate is still editable on the line.
        </span>
        {/*
          RULE 3 - what is free to sell, BEFORE anybody promises it (3 Oct 2026).

          The old line only spoke up at zero stock, which is the one case a
          salesperson already knows about. The error that actually happens is
          promising the last four of seven when three are already in a box with
          somebody else's name on it - and nothing anywhere said so.

          A quotation still reserves nothing: two people may quote the same last
          camera, which is Atlas doctrine and is how trade works. This is
          information at the moment of promising, not a block.
        */}
        {p && p.stock <= 0 ? (
          <span className="flex items-center gap-1 text-warning">
            <Icon name="alert-triangle" className="h-3 w-3" />
            No stock on hand. You can still quote it; dispatch is what checks.
          </span>
        ) : p && (p.promised ?? 0) > 0 ? (
          <span className="flex items-center gap-1 text-warning">
            <Icon name="alert-triangle" className="h-3 w-3" />
            {availabilityWords({ onHand: p.stock, promised: p.promised ?? 0, unit: 'pcs' }).text}
          </span>
        ) : null}
        <button
          type="button"
          onClick={it.addFreeLine}
          className="ms-auto inline-flex items-center gap-1 font-medium text-brand hover:underline"
        >
          <Icon name="plus" className="h-3 w-3" />
          Add a line by hand
        </button>
        {onQuickAdd && (
          <button
            type="button"
            onClick={onQuickAdd}
            className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
          >
            <Icon name="package" className="h-3 w-3" />
            New product
          </button>
        )}
      </div>
    </div>
  );
}

function PriceChip({
  label, value, tone, active, onClick,
}: {
  label: string;
  value: string;
  tone: 'brand' | 'warning';
  active: boolean;
  onClick: () => void;
}) {
  const on = tone === 'brand'
    ? 'border-brand bg-brand/10 text-on-tint-brand'
    : 'border-warning bg-warning/10 text-on-tint-warning';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-[3.25rem] w-[5.5rem] shrink-0 rounded-lg border px-2 text-center transition ${
        active ? on : 'border-border bg-card text-muted-foreground hover:bg-muted'
      }`}
    >
      <span className="block text-micro font-bold uppercase tracking-wide">{label}</span>
      <span className="mt-0.5 block truncate font-mono text-xs tabular-nums">{value}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ table */

export function ProductLines({ draft }: { draft: DocumentDraft }) {
  const it = draft.items;
  const taxRates = useTaxRates();
  const { totals } = draft.money;
  /*
    NO TAX ON THIS DOCUMENT (8 Oct 2026, from Pravin's screenshot).

    This table knew nothing about the GST switch, so with tax off it went on
    drawing a "Tax %" dropdown reading 18 next to a "Tax Amt" of zero - and
    the summary underneath said "No GST on this one". Two answers on one
    screen, and the one in the bigger type was wrong.

    The columns go rather than showing zeroes. A zero in a tax column is a
    claim that tax was worked out and came to nothing; no column is the
    truth, which is that this document does not deal in tax.

    THE LINE KEEPS ITS RATE. `taxRatePct` is untouched in the draft and in
    the database - it belongs to the product, not to this decision - so
    ticking the switch back on brings the right tax straight back. That is
    also the answer to "what about the GST rates fixed on each product":
    nothing happens to them.
  */
  const noTax = draft.money.taxMode === 'NONE';

  if (it.lines.length === 0) {
    return (
      <div className="mt-3 overflow-hidden rounded-lg border border-border">
        <TableHead />
        <p className="bg-card px-3 py-8 text-center text-sm text-muted-foreground">
          No data available in table
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[52rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/60 text-micro uppercase tracking-wide text-muted-foreground">
            <Th className="w-10">Sr</Th>
            <Th className="text-start">Product Name</Th>
            <Th className="w-20">HSN</Th>
            <Th className="w-24 text-end">Rate</Th>
            <Th className="w-20 text-end">Qty</Th>
            <Th className="w-20 text-end">Disc %</Th>
            {!noTax && <Th className="w-20 text-end">Tax %</Th>}
            {!noTax && <Th className="w-24 text-end">Tax Amt</Th>}
            <Th className="w-28 text-end">Total</Th>
            <Th className="w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-card">
          {it.lines.map((l, i) => {
            const t = totals.lines[i];
            return (
              <tr key={l.key} className="align-top">
                <Td className="pt-3 text-center text-xs text-muted-foreground">{i + 1}</Td>
                <Td>
                  <input
                    value={l.productName}
                    onChange={(e) => it.patchLine(l.key, { productName: e.target.value })}
                    placeholder="Product name"
                    className="w-full min-w-[10rem] rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium outline-none hover:border-border focus:border-brand focus:bg-card"
                  />
                  <input
                    value={l.note}
                    onChange={(e) => it.patchLine(l.key, { note: e.target.value })}
                    placeholder="Note, size, colour…"
                    className="w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-muted-foreground outline-none hover:border-border focus:border-brand focus:bg-card"
                  />

                  {/*
                    THE AMC DECISION, made where the sale is made.

                    Only appears for a product that actually offers one, so it
                    is silent on the cables and connectors that make up most of
                    a catalogue. Included cover is shown as a statement rather
                    than a checkbox - the customer is not choosing it, it came
                    with the product - and an extra-cost one is a real choice
                    somebody has to make.
                  */}
                  {l.amcMonths !== null && (
                    l.amcPricePaise && l.amcPricePaise > 0 ? (
                      <label className="mt-1 flex cursor-pointer items-start gap-1.5 rounded border border-info/25 bg-info/[0.05] px-1.5 py-1">
                        <input
                          type="checkbox"
                          checked={l.amcOpted}
                          onChange={(e) => it.patchLine(l.key, { amcOpted: e.target.checked })}
                          className="mt-0.5 h-3 w-3 accent-[hsl(var(--brand-primary))]"
                        />
                        <span className="text-xs leading-tight">
                          <span className="font-medium">
                            Add AMC - {formatCurrency(l.amcPricePaise)} for {l.amcMonths} months
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            Billed on a separate invoice. Cover starts when this
                            invoice is issued.
                          </span>
                        </span>
                      </label>
                    ) : (
                      <p className="mt-1 flex items-start gap-1 rounded border border-success/25 bg-success/[0.05] px-1.5 py-1 text-xs leading-tight text-on-tint-success">
                        <Icon name="check" className="mt-px h-2.5 w-2.5 shrink-0" />
                        <span>
                          AMC included - {l.amcMonths} months cover from the
                          invoice date, at no extra charge.
                        </span>
                      </p>
                    )
                  )}
                </Td>
                <Td>
                  <Cell
                    value={l.hsn ?? ''}
                    onChange={(v) => it.patchLine(l.key, { hsn: v })}
                    className="text-center font-mono text-xs"
                  />
                </Td>
                <Td>
                  <Num
                    value={l.unitPricePaise / 100}
                    step={1}
                    onChange={(n) => it.patchLine(l.key, { unitPricePaise: Math.round(n * 100) })}
                  />
                  {l.mrpPaise > 0 && l.unitPricePaise < l.mrpPaise && (
                    <p className="pe-1.5 text-end text-xs text-muted-foreground line-through">
                      {formatCurrency(l.mrpPaise)}
                    </p>
                  )}
                </Td>
                <Td>
                  <Num value={l.qty} step={1} min={1} onChange={(n) => it.patchLine(l.key, { qty: Math.max(1, n) })} />
                </Td>
                <Td>
                  <Num
                    value={l.discountPct} step={0.5} max={100}
                    onChange={(n) => it.patchLine(l.key, { discountPct: Math.min(100, Math.max(0, n)) })}
                  />
                </Td>
                {!noTax && (
                  <Td>
                    <select
                      value={l.taxRatePct}
                      onChange={(e) => it.patchLine(l.key, { taxRatePct: Number(e.target.value) })}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-end text-xs tabular-nums outline-none hover:border-border focus:border-brand focus:bg-card"
                    >
                      {rateOptions(taxRates, l.taxRatePct).map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </Td>
                )}
                {!noTax && (
                  <Td className="pt-2 text-end font-mono text-xs tabular-nums text-muted-foreground">
                    {formatCurrency(t?.taxPaise ?? 0)}
                  </Td>
                )}
                <Td className="pt-2 text-end font-mono text-xs font-semibold tabular-nums">
                  {formatCurrency((t?.taxablePaise ?? 0) + (t?.taxPaise ?? 0))}
                </Td>
                <Td className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => it.removeLine(l.key)}
                    aria-label={`Remove ${l.productName || 'line'}`}
                    className="grid h-6 w-6 place-items-center rounded text-muted-foreground transition hover:bg-danger/10 hover:text-danger"
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </Td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border-strong bg-muted/60 text-xs font-semibold">
            <td colSpan={4} className="px-2 py-2 text-end">Totals</td>
            <td className="px-2 py-2 text-end tabular-nums">
              {it.lines.reduce((n, l) => n + l.qty, 0)}
            </td>
            <td />
            {!noTax && <td />}
            {!noTax && (
              <td className="px-2 py-2 text-end font-mono tabular-nums">
                {formatCurrency(totals.taxTotalPaise)}
              </td>
            )}
            <td className="px-2 py-2 text-end font-mono tabular-nums">
              {formatCurrency(totals.taxableBasePaise + totals.taxTotalPaise)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>

      {/*
        THE SWITCH, WHERE THE PRICES ARE (9 Oct 2026).

        Pravin's words after finding the tax columns wrong: "gst toggle
        tumne lagaa diya hai, use main kahan se dekh sakta hoon". It was in
        Order Summary only, which on a laptop is below the fold while you
        are looking at the prices. A sentence pointing at it was not enough
        (8 Oct), so the switch itself is here too.

        Both checkboxes are bound to the one `gstOn` in the shared draft, so
        they cannot disagree - ticking either ticks both.
      */}
      <label className="flex cursor-pointer items-start gap-2 border-t border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={draft.money.gstOn}
          onChange={(e) => draft.money.setGstOn(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-[hsl(var(--brand-primary))]"
        />
        <span>
          <strong className="font-semibold text-foreground">Charge GST</strong>
          {noTax ? (
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
  );
}

function TableHead() {
  return (
    <div className="flex items-center gap-4 border-b border-border bg-muted/60 px-3 py-2 text-micro uppercase tracking-wide text-muted-foreground">
      <span className="w-8">Sr</span>
      <span className="flex-1">Product Name</span>
      <span className="w-16 text-end">Rate</span>
      <span className="w-12 text-end">Qty</span>
      <span className="w-20 text-end">Total</span>
    </div>
  );
}

const Th = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => (
  <th className={`px-2 py-2 font-semibold ${className}`}>{children}</th>
);

const Td = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => (
  <td className={`px-1 py-1.5 ${className}`}>{children}</td>
);

function Cell({
  value, onChange, className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded border border-transparent bg-transparent px-1 py-1 outline-none hover:border-border focus:border-brand focus:bg-card ${className}`}
    />
  );
}

function Num({
  value, onChange, step = 1, min = 0, max,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full rounded border border-transparent bg-transparent px-1 py-1 text-end text-xs tabular-nums outline-none hover:border-border focus:border-brand focus:bg-card"
    />
  );
}
