'use client';

import { sayIfHeld } from '@/lib/held-message';
import { CustomFieldInputs, useFieldSetup } from '@/components/custom-fields/CustomFieldInputs';
import { fieldsFor } from '@/lib/custom-fields';

import { Icon } from '@/components/ui/Icon';
import { ScanButton } from '@/components/scan/ScanButton';
import { scanShape } from '@/lib/scan/decode';
import { barcodeOwnerAction } from './scan-actions';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  addProduct, saveProduct, loadProduct, addCategory, addBrand,
  type ProductFormState,
} from './actions';
import { DialogFrame } from '@/components/ui/DialogFrame';

interface Props {
  categories: { id: string; name: string; parentId: string | null; codePrefix: string | null }[];
  brands: { id: string; name: string }[];
  /**
   * Whether this business has expiry tracking at all - lib/plans
   * `PLATFORM_FEATURES`, decided by the platform owner and not in Settings.
   *
   * False hides the whole section rather than disabling it. A greyed-out field
   * invites a support call; a field that is not there does not.
   */
  expiryEnabled?: boolean;
  onClose: () => void;
}

function Submit({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 items-center gap-2 rounded bg-brand px-4 text-sm font-semibold text-brand-fg shadow-card transition hover:bg-brand-hover disabled:opacity-50"
    >
      {pending ? 'Saving…' : isEdit ? 'Save changes' : '+ Add Product'}
    </button>
  );
}

/**
 * Barcode, scannable (Scan-to-Stock G3, 12 Oct 2026): the camera button beside
 * it, what the code reads as, and - before saving - which product already
 * has it (G8: one barcode, one product; the save is refused too).
 */
function BarcodeField({ defaultValue, exceptId }: { defaultValue: string; exceptId: string | null }) {
  const [value, setValue] = useState(defaultValue);
  const [owner, setOwner] = useState<{ code: string; name: string } | null>(null);
  const check = (v: string) => {
    if (!v.trim()) { setOwner(null); return; }
    barcodeOwnerAction(v, exceptId).then((r) => setOwner(r.owner)).catch(() => setOwner(null));
  };
  const shape = value.trim() ? scanShape(value) : null;
  return (
    <label className="block">
      <span className="field-label">Barcode</span>
      <div className="flex items-center gap-1.5">
        <div className="flex flex-1 items-center rounded border border-border bg-card transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
          <input
            name="barcode" value={value} placeholder="Scan or type the maker's barcode"
            onChange={(e) => { setValue(e.target.value); setOwner(null); }}
            onBlur={(e) => check(e.target.value)}
            className="w-full rounded bg-transparent px-3 py-2 font-mono text-sm outline-none"
          />
        </div>
        <ScanButton title="Scan the product barcode" className="h-9 w-9" onScan={(c) => {
          const s = scanShape(c);
          const v = s.kind === 'gs1' ? s.gtin : c;
          setValue(v); check(v);
        }} />
      </div>
      {owner ? (
        <span className="mt-1 block text-xs font-medium text-danger">Already on {owner.code} {owner.name}. One barcode names one product - saving will be refused.</span>
      ) : shape && shape.kind === 'serial' ? (
        <span className="mt-1 block text-xs text-warning">{shape.why}. Is this a serial (one box) rather than the product barcode?</span>
      ) : null}
    </label>
  );
}

function Field({
  label, name, type = 'text', placeholder, required, defaultValue, prefix,
}: {
  label: string; name: string; type?: string; placeholder?: string;
  required?: boolean; defaultValue?: string | number; prefix?: string;
}) {
  return (
    <label className="block">
      <span className="field-label">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      <div className="flex items-center rounded border border-border bg-card transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        {prefix && <span className="ps-2 text-sm text-muted-foreground">{prefix}</span>}
        <input
          name={name} type={type} placeholder={placeholder} required={required}
          defaultValue={defaultValue}
          className="w-full rounded bg-transparent px-3 py-2 text-sm outline-none"
        />
      </div>
    </label>
  );
}

/**
 * A select with an inline "+ New" so a master can be created without leaving
 * the form. Categories and brands previously existed only as seed data, which
 * meant a fresh tenant had empty dropdowns and no way to fill them.
 */
function MasterSelect({
  label, name, value, onChange, options, onCreate, placeholder, disabled, hint,
}: {
  label: string; name: string; value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  onCreate: (name: string) => Promise<{ error?: string; id?: string }>;
  placeholder: string; disabled?: boolean; hint?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!draft.trim()) return;
    setBusy(true); setErr(null);
    const r = await onCreate(draft.trim());
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    if (r.id) onChange(r.id);
    setDraft(''); setAdding(false);
  };

  return (
    <div>
      <label className="block">
        <span className="field-label">{label}</span>
        <select name={name} value={value} disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="field-input">
          <option value="">{placeholder}</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </label>

      {!disabled && !adding && (
        <button type="button" onClick={() => setAdding(true)}
          className="mt-1 text-xs font-medium text-brand hover:underline">
          + New {label.toLowerCase()}
        </button>
      )}

      {adding && (
        <div className="mt-1 rounded border border-brand/40 bg-brand/5 p-2">
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
            placeholder={`New ${label.toLowerCase()} name`}
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs" />
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          {err && <p className="mt-1 text-xs text-danger">{err}</p>}
          <div className="mt-1 flex gap-1">
            <button type="button" onClick={() => { setAdding(false); setErr(null); }}
              className="rounded border border-border px-2 py-0.5 text-xs">Cancel</button>
            <button type="button" onClick={save} disabled={busy || !draft.trim()}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded bg-brand px-2.5 text-xs font-medium text-brand-fg transition hover:bg-brand-hover disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type Draft = NonNullable<Awaited<ReturnType<typeof loadProduct>>>;

export function ProductForm({
  categories, brands, editId, onClose, expiryEnabled = false,
}: Props & { editId?: string }) {
  const action = editId ? saveProduct.bind(null, editId) : addProduct;
  const [state, formAction] = useActionState<ProductFormState, FormData>(action, {});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(!!editId);

  useEffect(() => {
    if (!editId) return;
    loadProduct(editId).then((p) => {
      if (p) {
        setDraft(p);
        setCategoryId(p.categoryId ?? '');
        setSubCategoryId(p.subCategoryId ?? '');
        setBrandId(p.brandId ?? '');
      }
      setLoading(false);
    });
  }, [editId]);

  const d = <K extends keyof Draft>(k: K): string =>
    draft?.[k] == null ? '' : String(draft[k]);
  const [categoryId, setCategoryId] = useState('');
  // Settings > Custom Fields - a field can be limited to one category.
  const { setup } = useFieldSetup('product');
  const extra = fieldsFor(setup.custom, categoryId || null);
  const [subCategoryId, setSubCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [cats, setCats] = useState(categories);
  const [brandList, setBrandList] = useState(brands);

  /**
   * The AMC sub-form only appears once the box is ticked.
   *
   * Seeded from the draft in the effect below rather than in the initialiser,
   * because the draft arrives asynchronously - `useState(draft?.amcAvailable)`
   * would always read `false` on the first render of an edit and leave the
   * fields hidden for a product that does have an AMC.
   */
  const [amcOn, setAmcOn] = useState(false);
  const [amcMode, setAmcMode] = useState('extra');
  /** Same asynchronous-draft reason as `amcOn` above. */
  const [expiryOn, setExpiryOn] = useState(false);

  useEffect(() => {
    if (!draft) return;
    setAmcOn(draft.amcAvailable ?? false);
    setAmcMode(draft.amcPricingMode ?? 'extra');
    setExpiryOn(draft.tracksExpiry ?? false);
  }, [draft]);

  useEffect(() => {
    if (state.ok) {
      // A price change held for approval says so; the rest has saved.
      sayIfHeld({ message: state.message });
      onClose();
    }
  }, [state.ok, state.message, onClose]);

  const roots = cats.filter((c) => !c.parentId);
  const subs = cats.filter((c) => c.parentId === categoryId);
  const prefix = roots.find((c) => c.id === categoryId)?.codePrefix;

  if (loading) {
    return (
      <div role="status" aria-label="Loading" className="fixed inset-0 z-[200] grid place-items-center bg-navy/40">
        <div className="flex items-center gap-2 rounded-lg bg-card px-6 py-4 text-sm shadow-overlay"><Icon name="refresh" className="h-4 w-4 animate-spin text-brand" />Loading…</div>
      </div>
    );
  }

  return (
    <DialogFrame label="Product" onClose={onClose} className="fixed inset-0 z-[200] grid place-items-center bg-navy/40 p-2 sm:p-4">
      <div className="thin-scroll max-h-[94vh] w-full max-w-3xl animate-slide-up overflow-y-auto rounded-lg bg-card shadow-overlay">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-5 py-3.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-on-tint-brand">
            <Icon name="package" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold leading-tight">{editId ? `Edit ${draft?.productCode ?? ''}` : 'Add New Product'}</h2>
            <p className="truncate text-xs text-muted-foreground">
              {editId
                ? 'Code cannot change - it appears on documents already sent'
                : `Code is generated automatically${prefix ? ` - ${prefix}-#####` : ''}`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="ms-auto grid h-8 w-8 shrink-0 place-items-center rounded-full bg-danger/10 text-on-tint-danger transition hover:bg-danger/20">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <form action={formAction} className="space-y-6 p-5">
          <section>
            <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">
              Core details
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Product Name" name="productName" defaultValue={d('productName')} required placeholder="e.g. HD Bullet Camera 3MP" />
              </div>

              <MasterSelect
                label="Category" name="categoryId" value={categoryId}
                onChange={(v) => { setCategoryId(v); setSubCategoryId(''); }}
                options={roots}
                placeholder="- Select category -"
                hint="The first three letters become the product code prefix"
                onCreate={async (n) => {
                  const r = await addCategory(n, null, null);
                  if (r.item) setCats((c) => [...c, r.item!]);
                  return { error: r.error, id: r.item?.id };
                }}
              />

              <MasterSelect
                label="Sub Category" name="subCategoryId" value={subCategoryId}
                onChange={setSubCategoryId}
                options={subs}
                disabled={!categoryId}
                placeholder={categoryId ? '- Select -' : 'Category first'}
                hint="Inherits the parent category's code prefix"
                onCreate={async (n) => {
                  const r = await addCategory(n, categoryId || null, null);
                  if (r.item) setCats((c) => [...c, r.item!]);
                  return { error: r.error, id: r.item?.id };
                }}
              />

              <MasterSelect
                label="Brand" name="brandId" value={brandId}
                onChange={setBrandId}
                options={brandList}
                placeholder="- Select brand -"
                onCreate={async (n) => {
                  const r = await addBrand(n);
                  if (r.item) setBrandList((b) => [...b, { id: r.item!.id, name: r.item!.name }]);
                  return { error: r.error, id: r.item?.id };
                }}
              />

              <Field label="HSN Code" name="hsnCode" defaultValue={d('hsnCode')} placeholder="8-digit, drives the GST rate" />
              <Field label="SKU" name="sku" defaultValue={d('sku')} />
              <BarcodeField key={String(d('barcode') ?? '')} defaultValue={String(d('barcode') ?? '')} exceptId={editId ?? null} />
              <Field label="Location" name="location" defaultValue={d('location')} placeholder="Rack / bin" />
              <Field label="Unit" name="unit" defaultValue={draft?.unit ?? 'pcs'} />
            </div>
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">
              Pricing
            </h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="MRP" name="mrp" type="number" prefix="₹" defaultValue={draft?.mrp ?? 0} />
              <Field label="DLP (transacting price)" name="dlp" type="number" prefix="₹" defaultValue={draft?.dlp ?? 0} />
              <Field label="Cost" name="cost" type="number" prefix="₹" defaultValue={draft?.cost ?? 0} />
              <Field label="Retail" name="retail" type="number" prefix="₹" defaultValue={draft?.retail ?? 0} />
              <Field label="Wholesale" name="wholesale" type="number" prefix="₹" defaultValue={draft?.wholesale ?? 0} />
              <Field label="GST Rate %" name="taxRate" type="number" defaultValue={draft?.taxRatePct ?? 18} />
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" name="isRateEditable" defaultChecked={draft ? draft.isRateEditable : true} />
              <span>
                Allow price override on quotations
                <span className="block text-xs text-muted-foreground">
                  Enforced server-side, not just hidden in the UI
                </span>
              </span>
            </label>
          </section>

          {/*
            EXPIRY. Only here when the platform owner switched it on - see Props.

            Its own section and not folded into stock tracking, because the two
            answer different questions and a client needs to see that. Batch
            tracking is "which lot did this come from", for a recall. This is
            "will it spoil on my shelf", which is true of milk counted by the
            crate and false of a batch-tracked certified bolt.
          */}
          {expiryEnabled && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">
                Expiry
              </h3>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="tracksExpiry"
                  className="mt-0.5"
                  defaultChecked={draft?.tracksExpiry ?? false}
                  onChange={(e) => setExpiryOn(e.currentTarget.checked)}
                />
                <span>
                  This product goes out of date
                  <span className="block text-xs text-muted-foreground">
                    Food, medicines, cosmetics, cleaning products, anything with a
                    date printed on the pack. Atlas will warn you before stock on
                    the shelf expires, on Inventory &gt; Stock Checks.
                  </span>
                </span>
              </label>

              {expiryOn && (
                <div className="mt-3 space-y-3 rounded border border-border bg-muted/20 p-3">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Shelf life (days)"
                      name="shelfLifeDays"
                      type="number"
                      defaultValue={d('shelfLifeDays')}
                      placeholder="Blank = type the date on each delivery"
                    />
                    <Field
                      label="Warn me this many days before"
                      name="expiryWarnDays"
                      type="number"
                      defaultValue={d('expiryWarnDays')}
                      placeholder="Blank = 10 days"
                    />
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Shelf life lets the receiving clerk leave the expiry box empty:
                    Atlas works the date out from the day it arrived. If the pack
                    prints a date, whatever they type always wins. Leave shelf life
                    blank and the date has to be entered on every delivery &mdash;
                    with neither, no reminder can fire.
                  </p>
                </div>
              )}
            </section>
          )}

          {/*
            Warranty and AMC. Two different promises, and keeping them in one
            section makes the difference visible rather than something staff
            have to be told: warranty is free cover that comes with the goods,
            AMC is a paid contract for maintaining them afterwards.
          */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">
              Warranty &amp; maintenance
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Warranty (months)"
                name="warrantyMonths"
                type="number"
                defaultValue={d('warrantyMonths')}
                placeholder="Blank = no warranty"
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Free cover that comes with the product. Leave blank if it carries
              none - a blank and a zero are treated the same, but blank is
              honest about nobody having said.
            </p>

            <label className="mt-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="amcAvailable"
                className="mt-0.5"
                defaultChecked={draft?.amcAvailable ?? false}
                onChange={(e) => setAmcOn(e.currentTarget.checked)}
              />
              <span>
                This product can have an AMC
                <span className="block text-xs text-muted-foreground">
                  An annual maintenance contract - the customer pays yearly to
                  keep it serviced after they buy it. Tick this for equipment
                  and software; leave it off for cables and consumables.
                </span>
              </span>
            </label>

            {amcOn && (
              <div className="mt-3 space-y-3 rounded border border-border bg-muted/20 p-3">
                <div>
                  <label htmlFor="productf-f334" className="mb-1 block text-micro font-semibold uppercase text-muted-foreground">
                    Is the AMC included in the price, or charged separately?
                  </label>
                  <select id="productf-f334"
                    name="amcPricingMode"
                    defaultValue={draft?.amcPricingMode ?? 'extra'}
                    onChange={(e) => setAmcMode(e.currentTarget.value)}
                    className="h-9 w-full rounded border border-border bg-card px-2.5 text-sm outline-none focus:border-brand"
                  >
                    <option value="extra">Charged separately, per year</option>
                    <option value="included">Included in the purchase price</option>
                  </select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={amcMode === 'included' ? 'Free cover (months)' : 'Term length (months)'}
                    name="amcDurationMonths"
                    type="number"
                    defaultValue={d('amcDurationMonths')}
                    placeholder="12"
                  />
                  {amcMode === 'extra' && (
                    <Field
                      label="Price per year"
                      name="amcAnnualPrice"
                      type="number"
                      prefix="₹"
                      defaultValue={
                        draft?.amcAnnualPricePaise != null
                          ? String(draft.amcAnnualPricePaise / 100)
                          : ''
                      }
                      placeholder="6000"
                    />
                  )}
                </div>

                <div>
                  <label htmlFor="productf-f373" className="mb-1 block text-micro font-semibold uppercase text-muted-foreground">
                    What the AMC covers
                  </label>
                  <textarea id="productf-f373"
                    name="amcTerms"
                    rows={2}
                    defaultValue={d('amcTerms')}
                    placeholder="Servicing, repairs and support for this unit. New equipment, major upgrades and site changes are charged separately."
                    className="w-full rounded border border-border bg-card px-2.5 py-2 text-sm outline-none focus:border-brand"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Copied onto each contract when it is signed, so editing this
                    later cannot change what an existing customer agreed to.
                  </p>
                </div>

                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                  <span>
                    {amcMode === 'included'
                      ? 'A contract starts by itself when the invoice is issued, at no charge.'
                      : 'A tick-box appears on the invoice line so the customer can take it or decline it. If they take it, the fee is billed on its own separate invoice.'}
                  </span>
                </p>
              </div>
            )}
          </section>

          {extra.length > 0 && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">
                More details
              </h3>
              <CustomFieldInputs configs={extra} values={draft?.customFields ?? {}} />
            </section>
          )}

          <section>
            <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">
              {editId ? 'Stock' : 'Opening stock'}
            </h3>
            {editId && (
              <p className="mb-3 text-xs text-muted-foreground">
                Current stock is {draft?.currentQty ?? 0} {draft?.unit ?? 'pcs'}. Stock moves
                through receipts and dispatches, not by editing it here.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {!editId && <Field label="Opening Quantity" name="openingQty" type="number" defaultValue={0} />}
              <Field label="Reorder Level" name="reorderLevel" type="number" defaultValue={draft?.reorderLevel ?? 0} />
            </div>
          </section>

          {editId && (
            <section className="rounded border border-border p-4">
              <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">
                Status
              </h3>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isActive" defaultChecked={draft?.isActive ?? true} />
                <span>Active
                  <span className="block text-xs text-muted-foreground">
                    Unticking hides it from new quotations. It stays on past ones.
                  </span>
                </span>
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input type="checkbox" name="isInOffer" defaultChecked={draft?.isInOffer ?? false} />
                On offer
              </label>
            </section>
          )}

          {state.error && (
            <p role="alert" className="rounded bg-danger/10 px-3 py-2 text-sm text-on-tint-danger">
              {state.error}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded border border-border px-4 py-2 text-sm hover:bg-muted">
              Cancel
            </button>
            <Submit isEdit={!!editId} />
          </div>
        </form>
      </div>
    </DialogFrame>
  );
}
