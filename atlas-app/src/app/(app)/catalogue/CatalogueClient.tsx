'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card, EmptyState, Field, PageHeader, Segmented } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency } from '@/lib/format';
import type { AdminListingRow } from '@/server/catalogue';
import type { AbandonedCartRow } from '@/server/shop';
import { saveListingAction, setListedAction } from './actions';
import { PhotoManager } from './PhotoManager';

/**
 * The shop, from the inside.
 *
 * THE PRODUCT LIST IS THE SPINE, not the listing list. The question on this
 * screen is "what should we be showing?", and a screen that only lists what is
 * already shown cannot answer it — somebody would have to remember what they
 * had left out.
 *
 * No price is editable here, on purpose. The shop reads `ProductPrice`, the
 * same row the quotation and the invoice read, so a catalogue price box would
 * be a second place to set a number that is already set — and the two would
 * disagree within a week. An offer is a LABEL only: "10% off" is what the
 * customer reads, and what they are actually charged is still settled on a
 * quotation by a person.
 */

type Tab = 'products' | 'combos' | 'activity';

interface Combo {
  id: string;
  name: string;
  blurb: string | null;
  offerLabel: string | null;
  deliveryNote: string | null;
  isListed: boolean;
  pricePaise: number | null;
  partsPaise: number;
  items: { productId: string; productName: string; qty: number; pricePaise: number }[];
}

interface Activity {
  days: number;
  views: number;
  adds: number;
  requests: number;
  abandoned: number;
  registrations: number;
  requestsPerHundredViews: number;
}

export function CatalogueClient({
  rows, combos, activity, abandoned, canEdit, scopeIsAll, shopUrl,
}: {
  rows: AdminListingRow[];
  combos: Combo[];
  activity: Activity | null;
  abandoned: AbandonedCartRow[];
  canEdit: boolean;
  scopeIsAll: boolean;
  /** Where customers find this shop, or null when no short name is set yet. */
  shopUrl: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<Tab>('products');
  const [search, setSearch] = useState('');
  const [onlyListed, setOnlyListed] = useState(false);
  const [needsPhoto, setNeedsPhoto] = useState(false);
  const [editing, setEditing] = useState<AdminListingRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error?: string; message?: string }>) => {
    setError(null); setNote(null);
    start(async () => {
      const r = await fn();
      if (r.error) { setError(r.error); return; }
      if (r.message) setNote(r.message);
      router.refresh();
    });
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyListed && !r.isListed) return false;
      // "Shown, but no photo yet" is the to-do list once photos start arriving.
      if (needsPhoto && !(r.isListed && r.imageCount === 0)) return false;
      if (!q) return true;
      return `${r.productName} ${r.productCode} ${r.categoryName ?? ''}`.toLowerCase().includes(q);
    });
  }, [rows, search, onlyListed, needsPhoto]);

  const listedCount = rows.filter((r) => r.isListed).length;
  const missingPhotos = rows.filter((r) => r.isListed && r.imageCount === 0).length;
  const groups = useMemo(
    () => [...new Set(rows.map((r) => r.shopGroup).filter((g): g is string => !!g))].sort(),
    [rows],
  );

  return (
    <div>
      <PageHeader
        badge="shopping-cart"
        title="Catalogue"
        subtitle="What the shop shows, and what people did there"
        actions={
          <span className="text-xs text-muted-foreground">
            {listedCount} of {rows.length} products on the shop
          </span>
        }
      />

      <Card className="mb-3 flex flex-wrap items-center gap-2 p-3">
        <Icon name="globe" className="h-4 w-4 text-brand" />
        {shopUrl ? (
          <>
            <span className="text-sm">Customers find your shop at</span>
            <a href={shopUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">{shopUrl.replace(/^https?:\/\//, '')}</a>
            <span className="text-xs text-muted-foreground">· existing customers also see it under Shop in their portal.</span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            Your shop has no address yet. Ask the platform owner to set its short name - existing
            customers can already see it under Shop in their portal.
          </span>
        )}
      </Card>

      {scopeIsAll && (
        <Card className="mb-3 p-3">
          <p className="text-xs text-muted-foreground">
            Select a single branch to change the catalogue. Each branch has its own shop.
          </p>
        </Card>
      )}
      {error && (
        <p className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-on-tint-danger">{error}</p>
      )}
      {note && (
        <p className="mb-3 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-on-tint-success">{note}</p>
      )}

      <Segmented
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={[
          { value: 'products', label: `Products (${listedCount})` },
          { value: 'combos', label: `Combos (${combos.filter((c) => c.isListed).length})` },
          { value: 'activity', label: 'Activity' },
        ]}
      />

      {/* ---- products ---------------------------------------------------- */}
      {tab === 'products' && (
        <Card className="mt-3 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <div className="relative min-w-[200px] flex-1">
              <Icon name="search" className="pointer-events-none absolute start-0 top-1/2 ms-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search a product…"
                className="field-input ps-9"
              />
            </div>
            <Button
              variant="outline"
              icon={onlyListed ? 'check-circle' : 'filter'}
              onClick={() => setOnlyListed(!onlyListed)}
            >
              {onlyListed ? 'On the shop only' : 'Everything'}
            </Button>
            <Button
              variant={needsPhoto ? 'primary' : 'outline'}
              icon="camera"
              onClick={() => setNeedsPhoto(!needsPhoto)}
            >
              Needs a photo ({missingPhotos})
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 text-start font-semibold">Product</th>
                  <th className="px-3 py-2 text-start font-semibold">Shown as</th>
                  <th className="px-3 py-2 text-end font-semibold">Price</th>
                  <th className="px-3 py-2 text-start font-semibold">Delivery</th>
                  <th className="px-3 py-2 text-start font-semibold">Offer</th>
                  <th className="px-3 py-2 text-center font-semibold">Pictures</th>
                  <th className="px-4 py-2 text-end font-semibold">On the shop</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 300).map((r) => (
                  <tr key={r.productId} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2">
                      <p className="font-medium">{r.productName}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {r.productCode}{r.categoryName ? ` · ${r.categoryName}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.headline ?? <span className="italic">its own name</span>}
                      <p className="text-xs">under {r.shopGroup ?? r.categoryName ?? 'no heading'}</p>
                    </td>
                    <td className="px-3 py-2 text-end font-mono tabular-nums">
                      {formatCurrency(r.pricePaise)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.deliveryNote ?? '—'}</td>
                    <td className="px-3 py-2">
                      {r.offerLabel ? <Badge tone="warning">{r.offerLabel}</Badge> : '—'}
                    </td>
                    <td className="px-3 py-2 text-center font-mono tabular-nums">
                      {r.imageCount ? r.imageCount : r.isListed ? <Badge tone="warning">needs one</Badge> : '—'}
                    </td>
                    <td className="px-4 py-2 text-end">
                      <div className="flex items-center justify-end gap-2">
                        {r.isListed ? <Badge tone="success">Shown</Badge> : <Badge tone="neutral">Off</Badge>}
                        <Button
                          variant="outline"
                          icon="pencil"
                          disabled={!canEdit || pending}
                          onClick={() => { setError(null); setEditing(r); }}
                        >
                          Edit
                        </Button>
                        {r.id && (
                          <Button
                            variant="outline"
                            icon={r.isListed ? 'eye-off' : 'check-circle'}
                            disabled={!canEdit || pending}
                            onClick={() => run(() => setListedAction(r.id as string, !r.isListed))}
                          >
                            {r.isListed ? 'Hide' : 'Show'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {shown.length === 0 && (
            <EmptyState
              icon="shopping-cart"
              title="Nothing matches"
              hint="Clear the search, or switch back to showing everything."
            />
          )}
          {shown.length > 300 && (
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              Showing the first 300 of {shown.length}. Narrow the search to see the rest.
            </p>
          )}
        </Card>
      )}

      {/* ---- combos ------------------------------------------------------ */}
      {tab === 'combos' && (
        <div className="mt-3 grid gap-3">
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">
              A combo is several products sold as one thing. When it sells, stock comes off{' '}
              <strong className="text-foreground">each real product in its own category</strong> —
              4 from cameras, or 1 from cameras and 2 from storage. It is never a product of its own,
              because the moment stock comes off a &ldquo;combo&rdquo; the camera count is wrong.
            </p>
          </Card>

          {combos.length === 0 ? (
            <EmptyState
              icon="shopping-cart"
              title="No combos yet"
              hint="A starter bundle — four cameras, a recorder and the cable — is usually the easiest thing a shop sells."
            />
          ) : combos.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold">{c.name}</h3>
                {c.offerLabel && <Badge tone="warning">{c.offerLabel}</Badge>}
                {c.isListed ? <Badge tone="success">Shown</Badge> : <Badge tone="neutral">Off</Badge>}
                <span className="ms-auto font-mono text-sm font-semibold tabular-nums">
                  {formatCurrency(c.pricePaise ?? c.partsPaise)}
                </span>
              </div>
              {c.blurb && <p className="mt-1 text-xs text-muted-foreground">{c.blurb}</p>}
              <ul className="mt-2 grid gap-0.5 text-xs text-muted-foreground">
                {c.items.map((i) => (
                  <li key={i.productId}>{i.qty} × {i.productName}</li>
                ))}
              </ul>
              {c.pricePaise !== null && c.pricePaise < c.partsPaise && (
                <p className="mt-2 text-xs text-success">
                  {formatCurrency(c.partsPaise - c.pricePaise)} less than the parts bought separately.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* ---- activity ---------------------------------------------------- */}
      {tab === 'activity' && (
        <div className="mt-3 grid gap-3">
          {activity && (
            <Card className="p-4">
              <h3 className="mb-3 text-sm font-semibold">Last {activity.days} days</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat label="Looked at" value={activity.views} />
                <Stat label="Added to a list" value={activity.adds} />
                <Stat label="Asked for" value={activity.requests} />
                <Stat label="Left behind" value={activity.abandoned} />
                <Stat label="Registered" value={activity.registrations} />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                <strong className="text-foreground">{activity.requestsPerHundredViews}</strong> requests
                per hundred views. Stated as a plain ratio on purpose — a request is not a sale, and
                it should not start being reported as one.
              </p>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 py-2.5">
              <h3 className="text-sm font-semibold">Left behind</h3>
              <p className="text-xs text-muted-foreground">
                Baskets nobody came back to after two days. The ones with a name are somebody to ring.
              </p>
            </div>
            {abandoned.length === 0 ? (
              <EmptyState
                icon="shopping-cart"
                title="Nothing left behind"
                hint="Either nobody has abandoned a basket, or the shop has not been open long enough to tell."
              />
            ) : (
              <div className="divide-y divide-border">
                {abandoned.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-start gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {c.customerName ?? <span className="italic text-muted-foreground">Not signed in</span>}
                        {c.phone && <span className="ms-2 font-mono text-xs text-muted-foreground">{c.phone}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{c.lines.join(' · ')}</p>
                    </div>
                    <span className="font-mono text-xs tabular-nums">{formatCurrency(c.goodsPaise)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {editing && (
        <ListingForm
          row={editing}
          groups={groups}
          canEdit={canEdit}
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={(input) => run(async () => {
            const r = await saveListingAction(input);
            if (!r.error) setEditing(null);
            return r;
          })}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-micro uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-xl font-bold tabular-nums">{value.toLocaleString('en-IN')}</p>
    </div>
  );
}

function ListingForm({ row, groups, canEdit, pending, onClose, onSave }: {
  row: AdminListingRow;
  groups: string[];
  canEdit: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (input: {
    productId: string; isListed: boolean; headline: string | null; shopGroup: string | null;
    blurb: string | null; deliveryNote: string | null; offerLabel: string | null;
  }) => void;
}) {
  const [headline, setHeadline] = useState(row.headline ?? '');
  // Started from what is saved. It used to start empty, so opening Edit and
  // pressing Save wiped the description somebody had written (3 Oct 2026).
  const [blurb, setBlurb] = useState(row.blurb ?? '');
  const [group, setGroup] = useState(row.shopGroup ?? '');
  const [delivery, setDelivery] = useState(row.deliveryNote ?? '');
  const [offer, setOffer] = useState(row.offerLabel ?? '');
  const [isListed, setIsListed] = useState(row.isListed);

  return (
    <Modal
      title={row.productName}
      subtitle="How this product appears in the shop"
      icon="shopping-cart"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" icon="x" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="check-circle"
            loading={pending}
            onClick={() => onSave({
              productId: row.productId,
              isListed,
              headline: headline.trim() || null,
              shopGroup: group.trim() || null,
              blurb: blurb.trim() || null,
              deliveryNote: delivery.trim() || null,
              offerLabel: offer.trim() || null,
            })}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
          The price shown is <strong className="text-foreground">{formatCurrency(row.pricePaise)}</strong>,
          from this product&rsquo;s price list. It is not editable here — the shop, the quotation and the
          invoice all read the same number, so changing it in one place changes it everywhere.
        </div>

        <Field label="Shown as" hint="Leave empty to use the product's own name.">
          <input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder={row.productName}
            className="field-input"
          />
        </Field>

        <Field
          label="Shop heading"
          hint={`Where it sits on the shop - "Cameras", "Recorders". Leave empty to use its stock category${row.categoryName ? ` (${row.categoryName})` : ''}.`}
        >
          <input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            list="shop-groups"
            placeholder={row.categoryName ?? 'Cameras'}
            className="field-input"
          />
          <datalist id="shop-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        </Field>

        <Field label="A line about it" hint="What a customer needs to know in one sentence.">
          <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} rows={2} className="field-input" />
        </Field>

        <Field label="Delivery" hint="Your own words — “2–3 days”, “same week”.">
          <input value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="2–3 days" className="field-input" />
        </Field>

        <Field
          label="Offer"
          hint="A label only. It does not change the price — what the customer pays is still settled on the quotation."
        >
          <input value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="10% off" className="field-input" />
        </Field>

        <PhotoManager productId={row.productId} disabled={!canEdit} />

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isListed}
            onChange={(e) => setIsListed(e.target.checked)}
            className="h-3.5 w-3.5 accent-[hsl(var(--brand-primary))]"
          />
          Show this on the shop
        </label>
        <p className="text-xs text-muted-foreground">
          Installation and other charges are shown as extra beside every price, so nobody reads this as
          the whole job.
        </p>
      </div>
    </Modal>
  );
}
