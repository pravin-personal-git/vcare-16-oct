'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { reconcileProductAction } from './actions';
import type { ExpiryRow, StockHealth } from '@/server/stock-health';

/**
 * Stock checks (2 Oct 2026).
 *
 * TWO LISTS, AND NEITHER IS A DASHBOARD.
 *
 * Both halves of this screen are work queues: a product on them needs a person
 * to do something today. So each row says what is wrong in a sentence and links
 * to the place the fix happens. There are no gauges, no percentages for their
 * own sake, and nothing that reads well and cannot be acted on.
 *
 * The ledger half opens with the plain number - how many items this store
 * cannot account for - because that is the figure that was invisible, and
 * seeing it once is what makes anybody fix it.
 */

type Row = Omit<ExpiryRow, 'expiryDate'> & { expiryDate: string };

interface Props {
  /** `stock.adjust`. Without it the fix button is not rendered at all. */
  canFix: boolean;
  health: Omit<StockHealth, 'expiry'> & {
    expiry: Omit<StockHealth['expiry'], 'expired' | 'expiring'> & {
      expired: Row[];
      expiring: Row[];
    };
  };
}

const when = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  });

export function StockHealthClient({ health, canFix }: Props) {
  const { ledger, expiry, defaultWarnDays } = health;
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const fix = (productId: string) => {
    setBusyId(productId); setNote(null);
    startTransition(async () => {
      const r = await reconcileProductAction(productId);
      setBusyId(null);
      setNote(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Done.' });
    });
  };
  const allWell = ledger.divergent.length === 0
    && expiry.expired.length === 0 && expiry.expiring.length === 0;

  return (
    <>
      <PageHeader
        badge="CHK"
        title="Stock checks"
        subtitle="Items the shelf count cannot account for, and stock about to go out of date"
        actions={
          <Link href="/reports/product-stock" className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
            <Icon name="package" className="h-3.5 w-3.5" />
            Stock on Hand
          </Link>
        }
      />
      {/* G-06 (6 Oct 2026): not the shelf - the records behind it. */}
      <p className="-mt-3 mb-3 text-xs text-muted-foreground">
        A health check on the stock records, not the shelf: does every serial-tracked count match its movements, and what is expiring.
        Open it when numbers look wrong or before an audit. For what is on the shelf, use Stock on Hand.
      </p>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Items unaccounted for"
          value={ledger.itemsUnaccounted.toLocaleString('en-IN')}
          tone={ledger.itemsUnaccounted > 0 ? 'danger' : 'success'}
          hint={`across ${ledger.divergent.length} of ${ledger.serialProducts} serial-tracked products`}
        />
        <Tile
          label="Products that agree"
          value={`${ledger.agreed} of ${ledger.serialProducts}`}
          tone="neutral"
          hint="shelf count matches the items we can name"
        />
        <Tile
          label="Already expired"
          value={expiry.enabled ? String(expiry.expired.length) : '—'}
          tone={expiry.expired.length > 0 ? 'danger' : 'success'}
          hint={expiry.enabled ? 'still showing as on the shelf' : 'expiry tracking is off'}
        />
        <Tile
          label="Going off soon"
          value={expiry.enabled ? String(expiry.expiring.length) : '—'}
          tone={expiry.expiring.length > 0 ? 'warning' : 'success'}
          hint={expiry.enabled ? `within ${defaultWarnDays} days unless the product says otherwise` : 'expiry tracking is off'}
        />
      </div>

      {note && (
        <Card className={`mb-3 p-3 text-sm ${
          note.ok ? 'border-success/40 bg-success/10 text-foreground' : 'border-danger/40 bg-danger/10 text-on-tint-danger'
        }`}>
          {note.text}
        </Card>
      )}

      {allWell && (
        <Card className="mb-4 border-success/40 bg-success/10 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-success">
            <Icon name="check-circle" className="h-4 w-4" />
            Nothing to act on
          </p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">
            Every serial-tracked product&rsquo;s shelf count matches the items it can name, and no
            stock on the shelf is near its expiry date. This page is worth opening once a week.
          </p>
        </Card>
      )}

      {/* ---------------------------------------------- the two ledgers */}
      <SectionCard
        title="Items the shelf count cannot account for" icon="alert-triangle"
        bodyClassName="p-0"
        action={<span className="text-xs text-muted-foreground">{ledger.divergent.length} products</span>}
      >
        <p className="border-b border-border bg-muted/20 px-4 py-2 text-xs leading-relaxed text-muted-foreground">
          Atlas counts stock two ways: how many are on the shelf, and which individual items it can
          name. For a serial-tracked product the two should be the same number. Where they are not,
          either an item is on the shelf with no number on it, or a number is on file for an item
          that is no longer there. Both need a physical count of that product.
        </p>

        {ledger.serialProducts === 0 ? (
          <div className="p-4">
            <EmptyState
              icon="package"
              title="No product is tracked by serial number"
              hint="This check only applies to products set to serial tracking. Set one in Products > Stock Tracking and it will appear here."
            />
          </div>
        ) : ledger.divergent.length === 0 ? (
          <p className="p-4 text-sm text-success">
            All {ledger.serialProducts} serial-tracked products agree with themselves.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="border-b border-border bg-muted/40 text-micro uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-start font-medium">Product</th>
                  <th className="px-4 py-2 text-end font-medium">On the shelf</th>
                  <th className="px-4 py-2 text-end font-medium">Items we can name</th>
                  <th className="px-4 py-2 text-start font-medium">What that means</th>
                  <th className="px-4 py-2 text-start font-medium">Also</th>
                  {canFix && <th className="px-4 py-2 text-end font-medium">Fix</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ledger.divergent.map((d) => (
                  <tr key={d.productId} className="align-top">
                    <td className="px-4 py-2">
                      <Link
                        href={`/product-journey?product=${d.productId}`}
                        className="font-medium hover:text-brand hover:underline"
                      >
                        {d.productName}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">{d.productCode}</p>
                    </td>
                    <td className="px-4 py-2 text-end font-mono tabular-nums">{d.shelfQty}</td>
                    <td className="px-4 py-2 text-end font-mono tabular-nums">{d.unitsInStock}</td>
                    <td className="px-4 py-2">
                      {d.gap > 0 ? (
                        <span className="text-danger">
                          {d.gap} {d.unit} on the shelf with no number on them
                        </span>
                      ) : (
                        <span className="text-warning">
                          {-d.gap} numbered {-d.gap === 1 ? 'item' : 'items'} that are not on the shelf
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className="flex flex-wrap gap-1">
                        {d.unnamedOut > 0 && (
                          <Badge tone="warning" title="Left the store with no customer recorded - migrated data">
                            {d.unnamedOut} out, customer unknown
                          </Badge>
                        )}
                        {d.houseTagged > 0 && (
                          <Badge tone="info" title="Numbered by Atlas because the vendor printed none">
                            {d.houseTagged} house-tagged
                          </Badge>
                        )}
                      </span>
                    </td>
                    {canFix && (
                      <td className="px-4 py-2 text-end">
                        {/*
                          One click, and no number to retype. Atlas already
                          knows the shelf count; asking somebody to type it
                          again invites a typo on each of 91 products, and a
                          typo here moves stock.

                          The label says which direction it goes, because the
                          two outcomes are not the same size of decision:
                          numbering found stock is reversible housekeeping,
                          writing units off is a loss.
                        */}
                        <Button
                          variant="ghost"
                          loading={busyId === d.productId}
                          onClick={() => fix(d.productId)}
                          title={d.gap > 0
                            ? 'The shelf is right - give these items numbers so they can be traced'
                            : 'These numbered items are not on the shelf - mark them lost, keeping their serials'}
                        >
                          {d.gap > 0 ? `Number the ${d.gap}` : `Write off ${-d.gap}`}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {ledger.divergent.length > 0 && (
          <p className="border-t border-border bg-muted/20 px-4 py-2 text-xs leading-relaxed text-muted-foreground">
            New differences cannot start any more: goods receipt now creates one record per item
            received and gives it a number of our own where the supplier printed none. What is
            listed here arrived before that, and clears as each product is counted.
          </p>
        )}
      </SectionCard>

      {/* ------------------------------------------------------- expiry */}
      {!expiry.enabled ? (
        <Card className="mt-4 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="calendar" className="h-4 w-4 text-muted-foreground" />
            Expiry dates are not switched on for this business
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Expiry tracking suits businesses whose stock spoils &mdash; food, chemists, cosmetics,
            cleaning products. It is switched on per business by N.A.I.R. Solutions, not in
            Settings, because for most clients it would be an extra box on every product form that
            nobody fills in. Ask your account manager if you need it.
          </p>
        </Card>
      ) : (
        <>
          <ExpiryTable
            title="Already expired, still on the shelf"
            icon="x-circle"
            rows={expiry.expired}
            empty="Nothing on the shelf has passed its expiry date."
          />
          <ExpiryTable
            title="Going off soon"
            icon="clock"
            rows={expiry.expiring}
            empty={`Nothing is within ${defaultWarnDays} days of its expiry date.`}
          />

          {expiry.noDates.length > 0 && (
            <Card className="mt-4 border-warning/40 bg-warning/10 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-warning">
                <Icon name="alert-triangle" className="h-4 w-4" />
                {expiry.noDates.length} product{expiry.noDates.length === 1 ? '' : 's'} marked as
                expiring with no date anywhere
              </p>
              <p className="mt-1 text-xs leading-relaxed text-foreground">
                These have stock on the shelf and no expiry date on any delivery, so no reminder can
                ever fire for them. Either enter the date when receiving, or set a shelf life on the
                product so Atlas works it out from the delivery date.
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {expiry.noDates.map((p) => (
                  <li key={p.productId}>
                    <Link
                      href={`/product-journey?product=${p.productId}`}
                      className="text-xs hover:text-brand hover:underline"
                    >
                      <span className="font-mono">{p.productCode}</span> {p.productName}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function ExpiryTable({ title, icon, rows, empty }: {
  title: string; icon: 'x-circle' | 'clock'; rows: Row[]; empty: string;
}) {
  return (
    <SectionCard
      className="mt-4" title={title} icon={icon} bodyClassName="p-0"
      action={<span className="text-xs text-muted-foreground">{rows.length}</span>}
    >
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-success">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="border-b border-border bg-muted/40 text-micro uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-start font-medium">Product</th>
                <th className="px-4 py-2 text-start font-medium">Batch or delivery</th>
                <th className="px-4 py-2 text-start font-medium">Expires</th>
                <th className="px-4 py-2 text-start font-medium">What to do</th>
                <th className="px-4 py-2 text-end font-medium">On the shelf</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={`${r.source}-${r.ref}-${r.productId}`} className="align-top">
                  <td className="px-4 py-2">
                    <Link
                      href={`/product-journey?product=${r.productId}`}
                      className="font-medium hover:text-brand hover:underline"
                    >
                      {r.productName}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">{r.productCode}</p>
                  </td>
                  <td className="px-4 py-2">
                    <Link href={r.refHref} className="font-mono text-xs text-brand hover:underline">
                      {r.ref}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {r.source === 'lot'
                        ? 'batch - exact'
                        /*
                          Said per row, not once in a footnote. For a product
                          counted by quantity this date belongs to a DELIVERY,
                          and Atlas cannot prove that delivery's stock is the
                          stock still on the shelf. Claiming otherwise would be
                          the sort of confident wrong answer this report exists
                          to replace.
                        */
                        : `delivery of ${r.receivedQty ?? '?'} - may already have sold`}
                    </p>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{when(r.expiryDate)}</td>
                  <td className="px-4 py-2">
                    <span className={r.band === 'expired' ? 'text-danger' : 'text-warning'}>
                      {r.words}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-end font-mono tabular-nums">
                    {r.shelfQty} {r.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function Tile({ label, value, tone, hint }: {
  label: string; value: string; tone: 'danger' | 'warning' | 'success' | 'neutral'; hint: string;
}) {
  const colour = {
    danger: 'text-danger', warning: 'text-warning',
    success: 'text-success', neutral: 'text-foreground',
  }[tone];
  return (
    <Card className="p-3">
      <p className="text-micro font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${colour}`}>{value}</p>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p>
    </Card>
  );
}
