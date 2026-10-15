'use client';

import { toast } from '@/lib/held-message';
import { Icon } from '@/components/ui/Icon';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import {
  addCustomer, editCustomer, loadParty, type CustomerFormState,
  loadPortalStatus, enablePortalAccess, resetPortalPassword, disablePortalAccess,
  type PortalStatus,
} from './actions';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { CustomFieldInputs, useFieldSetup } from '@/components/custom-fields/CustomFieldInputs';
import { stdRequired, stdShown, type FieldSetup } from '@/lib/custom-fields';
import { ask } from '@/components/ui/ask';

const TITLES = ['', 'Mr', 'Mrs', 'Ms', 'Dr', 'Prof'];
const DESIGNATIONS = ['', 'Owner', 'Director', 'Manager', 'Accountant', 'Purchase Manager', 'Staff', 'Other'];
const SOURCES = ['', 'IndiaMART', 'TradeIndia', 'IVR Call', 'JustDial', 'Mail', 'Referral', 'Walk-in', 'Website'];
const CREDIT_DAYS = [0, 7, 15, 30, 45, 60, 90];

function Submit({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="inline-flex h-9 items-center gap-2 rounded bg-brand px-4 text-sm font-semibold text-brand-fg shadow-card transition hover:bg-brand-hover disabled:opacity-50">
      {pending ? 'Saving…' : isEdit ? 'Save changes' : '+ Add Customer'}
    </button>
  );
}

function Field({ label, name, type = 'text', placeholder, required, defaultValue, prefix, maxLength }: {
  label: string; name: string; type?: string; placeholder?: string;
  required?: boolean; defaultValue?: string | number; prefix?: string; maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="field-label">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      <div className="flex items-center rounded border border-border bg-card transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        {prefix && <span className="ps-2 text-sm text-muted-foreground">{prefix}</span>}
        <input name={name} type={type} placeholder={placeholder} required={required}
          defaultValue={defaultValue} maxLength={maxLength}
          className="w-full rounded bg-transparent px-3 py-2 text-sm outline-none" />
      </div>
    </label>
  );
}

function Select({ label, name, options, required, defaultValue }: {
  label: string; name: string; options: (string | number)[]; required?: boolean; defaultValue?: string | number;
}) {
  return (
    <label className="block">
      <span className="field-label">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {/* defaultValue: without it, editing a customer silently reset every dropdown (26 Sep 2026). */}
      <select name={name} required={required} defaultValue={defaultValue}
        className="field-input">
        {options.map((o) => (
          <option key={String(o)} value={o}>{o === '' ? '- Select -' : o}</option>
        ))}
        {defaultValue !== undefined && defaultValue !== '' && !options.map(String).includes(String(defaultValue)) && (
          <option value={defaultValue}>{defaultValue}</option>
        )}
      </select>
    </label>
  );
}

/**
 * Enable / reset / disable the customer's own login to the portal.
 *
 * A generated password is shown exactly once, in this component's own state
 * - it is never re-fetchable (the server only ever stores the hash), so if
 * staff navigate away without copying it, the fix is "reset password" again,
 * not "look it up".
 */
function PortalAccessSection({ customerId }: { customerId: string }) {
  const [status, setStatus] = useState<PortalStatus | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    loadPortalStatus(customerId).then(setStatus);
  }, [customerId]);

  const run = (action: () => Promise<{ error?: string; tempPassword?: string; ok?: boolean }>) => {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) { setError(res.error); return; }
      if (res.tempPassword) setTempPassword(res.tempPassword);
      loadPortalStatus(customerId).then(setStatus);
    });
  };

  if (!status) {
    return (
      <section className="rounded border border-border p-4">
        <p className="text-xs text-muted-foreground">Loading portal access…</p>
      </section>
    );
  }

  return (
    <section className="rounded border border-border p-4">
      <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">
        Customer portal login
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Lets this customer sign in to see their own purchases and raise
        complaints directly, at <span className="font-mono">/portal/login</span> with
        their phone number.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${status.portalEnabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
          <Icon name={status.portalEnabled ? 'check-circle' : 'x-circle'} className="h-3.5 w-3.5" />
          {status.portalEnabled ? 'Portal access enabled' : 'Portal access not enabled'}
        </span>
        {status.portalEnabled && status.portalMustReset && (
          <span className="text-xs text-muted-foreground">Waiting on first login (temporary password still active)</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {!status.portalEnabled ? (
          <button type="button" disabled={pending}
            onClick={() => run(() => enablePortalAccess(customerId))}
            className="rounded border border-brand bg-brand/5 px-3 py-1.5 text-xs font-semibold text-on-tint-brand transition hover:bg-brand/10 disabled:opacity-50">
            Enable portal access
          </button>
        ) : (
          <>
            <button type="button" disabled={pending}
              onClick={() => run(() => resetPortalPassword(customerId))}
              className="rounded border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50">
              Reset password
            </button>
            <button type="button" disabled={pending}
              onClick={async () => {
                if (await ask.confirm({
                  tone: 'danger', icon: 'lock',
                  title: 'Turn off portal access?',
                  message: 'This customer will not be able to sign in to the portal. If they are signed in now, they are signed out straight away. You can turn it back on later.',
                  confirmLabel: 'Turn off access', cancelLabel: 'Keep access',
                })) run(() => disablePortalAccess(customerId));
              }}
              className="rounded border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:opacity-50">
              Disable portal access
            </button>
          </>
        )}
      </div>

      {error && <p role="alert" className="mt-3 rounded bg-danger/10 px-3 py-2 text-xs text-on-tint-danger">{error}</p>}

      {tempPassword && (
        <div className="mt-3 rounded border border-warning/40 bg-warning/[0.06] p-3">
          <p className="text-xs font-semibold text-warning">Shown once - copy it now</p>
          <p className="mt-1 font-mono text-lg tracking-wider">{tempPassword}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Share this with the customer directly (call, WhatsApp, in person).
            They will be asked to set their own password the first time they sign in.
          </p>
        </div>
      )}
    </section>
  );
}

type PartyDraft = NonNullable<Awaited<ReturnType<typeof loadParty>>>;

/**
 * A built-in field the owner can switch off in Settings > Custom Fields. Off,
 * it leaves the form but its saved value rides along untouched.
 */
function Opt({ setup, k, value, children }: { setup: FieldSetup; k: string; value: string; children: React.ReactNode }) {
  if (stdShown(setup, k)) return <>{children}</>;
  return <input type="hidden" name={k} value={value} />;
}

export function CustomerForm({ customerTypes, editId, onClose }: {
  customerTypes: { id: string; name: string }[];
  /** When set, the form edits that party instead of creating one. */
  editId?: string;
  onClose: () => void;
}) {
  const action = editId
    ? editCustomer.bind(null, editId)
    : addCustomer;
  const [state, formAction] = useActionState<CustomerFormState, FormData>(action, {});
  const [sameAddress, setSameAddress] = useState(true);
  const [alsoSupplier, setAlsoSupplier] = useState(false);
  const [draft, setDraft] = useState<PartyDraft | null>(null);
  const [loading, setLoading] = useState(!!editId);
  const { setup, ready } = useFieldSetup('customer');
  const req = (k: string) => stdRequired(setup, k);

  useEffect(() => {
    if (!editId) return;
    loadParty(editId).then((p) => {
      if (p) {
        setDraft(p);
        setSameAddress(p.deliverySameAsBilling);
        setAlsoSupplier(p.isSupplier);
      }
      setLoading(false);
    });
  }, [editId]);

  // Defaults come from the loaded record when editing, otherwise blank.
  const d = <K extends keyof PartyDraft>(k: K): string =>
    draft?.[k] == null ? '' : String(draft[k]);

  useEffect(() => {
    if (state.ok) {
      // A credit limit held for approval goes to the toast; other warnings stay as before.
      if (state.warning) { if (/approv/i.test(state.warning)) toast(state.warning); else void ask.tell({ tone: 'warning', message: state.warning }); }
      onClose();
    }
  }, [state.ok, state.warning, onClose]);

  if (loading || !ready) {
    return (
      <div role="status" aria-label="Loading" className="fixed inset-0 z-[200] grid place-items-center bg-navy/40">
        <div className="flex items-center gap-2 rounded-lg bg-card px-6 py-4 text-sm shadow-overlay"><Icon name="refresh" className="h-4 w-4 animate-spin text-brand" />Loading…</div>
      </div>
    );
  }

  return (
    <DialogFrame label="Customer" onClose={onClose} className="fixed inset-0 z-[200] grid place-items-center bg-navy/40 p-2 sm:p-4">
      <div className="thin-scroll max-h-[94vh] w-full max-w-3xl animate-slide-up overflow-y-auto rounded-lg bg-card shadow-overlay">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-5 py-3.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-on-tint-brand">
            <Icon name="users" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold leading-tight">{editId ? `Edit ${draft?.partyCode ?? ''}` : 'Add New Customer'}</h2>
            <p className="truncate text-xs text-muted-foreground">{editId ? 'Code cannot change - it appears on documents already sent' : 'Create a new customer account'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="ms-auto grid h-8 w-8 shrink-0 place-items-center rounded-full bg-danger/10 text-on-tint-danger transition hover:bg-danger/20">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <form action={formAction} className="space-y-6 p-5">
          <section>
            <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">Personal details</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Opt setup={setup} k="companyName" value={d('companyName')}>
                <Field label="Company Name" name="companyName" defaultValue={d('companyName')} required={req('companyName')} />
              </Opt>
              <Opt setup={setup} k="gstin" value={d('gstin')}>
                <Field label="GST Number" name="gstin" defaultValue={d('gstin')} placeholder="15-character GSTIN" maxLength={15} required={req('gstin')} />
              </Opt>
              <Opt setup={setup} k="title" value={d('title')}>
                <Select label="Title" name="title" options={TITLES} defaultValue={d('title')} required={req('title')} />
              </Opt>
              <Field label="First Name" name="firstName" defaultValue={d('firstName')} required />
              <Field label="Last Name" name="lastName" defaultValue={d('lastName')} />
              <Opt setup={setup} k="designation" value={d('designation')}>
                <Select label="Designation" name="designation" options={DESIGNATIONS} defaultValue={d('designation')} required={req('designation')} />
              </Opt>
              <Field label="Phone" name="phone" defaultValue={d('phone')} required prefix="+91" placeholder="10-digit number" maxLength={10} />
              <Opt setup={setup} k="altPhone" value={d('altPhone')}>
                <Field label="Alternative No" name="altPhone" defaultValue={d('altPhone')} prefix="+91" maxLength={10} required={req('altPhone')} />
              </Opt>
              <Opt setup={setup} k="email" value={d('email')}>
                <Field label="Email" name="email" defaultValue={d('email')} type="email" required={req('email')} />
              </Opt>
              <Opt setup={setup} k="website" value={d('website')}>
                <Field label="Website" name="website" defaultValue={d('website')} placeholder="https://example.com" required={req('website')} />
              </Opt>
              <Opt setup={setup} k="customerTypeId" value={d('customerTypeId')}>
                <label className="block">
                  <span className="field-label">Customer Type {req('customerTypeId') && <span className="text-danger">*</span>}</span>
                  <select name="customerTypeId" defaultValue={d('customerTypeId')} required={req('customerTypeId')}
                    className="field-input">
                    <option value="">- Select -</option>
                    {customerTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
              </Opt>
              <Opt setup={setup} k="source" value={d('source')}>
                <Select label="Source" name="source" options={SOURCES} defaultValue={d('source')} required={req('source')} />
              </Opt>
            </div>
          </section>

          {(stdShown(setup, 'birthday') || stdShown(setup, 'weddingAnniversary')) && (
          <section>
            <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">Important dates</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Opt setup={setup} k="birthday" value={d('birthday')}>
                <Field label="Birthday" name="birthday" defaultValue={d('birthday')} type="date" required={req('birthday')} />
              </Opt>
              <Opt setup={setup} k="weddingAnniversary" value={d('weddingAnniversary')}>
                <Field label="Wedding Anniversary" name="weddingAnniversary" defaultValue={d('weddingAnniversary')} type="date" required={req('weddingAnniversary')} />
              </Opt>
            </div>
          </section>
          )}
          {!stdShown(setup, 'birthday') && !stdShown(setup, 'weddingAnniversary') && (
            <>
              <input type="hidden" name="birthday" value={d('birthday')} />
              <input type="hidden" name="weddingAnniversary" value={d('weddingAnniversary')} />
            </>
          )}

          {setup.custom.length > 0 && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">More details</h3>
              <CustomFieldInputs configs={setup.custom} values={draft?.customFields ?? {}} />
            </section>
          )}

          <section>
            <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">Address</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Opt setup={setup} k="addressLine1" value={d('addressLine1')}>
                <div className="sm:col-span-2"><Field label="Address Line 1" name="addressLine1" defaultValue={d('addressLine1')} placeholder="Street / Building" required={req('addressLine1')} /></div>
              </Opt>
              <Field label="State" name="state" defaultValue={d('state')} />
              <Field label="City" name="city" defaultValue={d('city')} />
              <Opt setup={setup} k="pincode" value={d('pincode')}>
                <Field label="Pincode" name="pincode" defaultValue={d('pincode')} maxLength={6} required={req('pincode')} />
              </Opt>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-success">
              <input type="checkbox" name="deliverySameAsBilling" checked={sameAddress}
                onChange={(e) => setSameAddress(e.target.checked)} />
              Delivery address same as above
            </label>
            {!sameAddress && (
              <div className="mt-3"><Field label="Delivery Address" name="deliveryAddress" defaultValue={d('deliveryAddress')} /></div>
            )}
          </section>

          <section className="rounded border border-info/30 bg-info/5 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-info">Credit limit</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Field label="Credit Limit Amount" name="creditLimit" type="number" prefix="₹" defaultValue={draft?.creditLimit ?? 0} />
                <p className="mt-1 text-xs text-muted-foreground">Maximum outstanding allowed</p>
              </div>
              <div>
                <Select label="Credit Limit Days" name="creditLimitDays" options={CREDIT_DAYS} defaultValue={draft?.creditLimitDays ?? 0} />
                <p className="mt-1 text-xs text-muted-foreground">0 means no credit. Drives the CR Days Over metric</p>
              </div>
            </div>
          </section>

          <section className="rounded border border-border p-4">
            <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">
              Roles
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Same firm buys from you and supplies to you? Tick both - one record,
              one address, one GSTIN.
            </p>
            <input type="hidden" name="isCustomer" value="on" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked disabled />
              <span>Customer <span className="text-muted-foreground">(this screen manages customers)</span></span>
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" name="isSupplier" checked={alsoSupplier}
                onChange={(e) => setAlsoSupplier(e.target.checked)} />
              Also a supplier
            </label>

            {alsoSupplier && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Select label="Supplier Type" name="supplierType" options={['', 'Product', 'Service']} defaultValue={d('supplierType')} />
                <Field label="Payment Terms (days)" name="paymentTermsDays" type="number" defaultValue={draft?.paymentTermsDays ?? 0} />
              </div>
            )}

            <label className="mt-4 flex items-center gap-2 text-sm">
              <input type="checkbox" name="subscribeSms" defaultChecked={draft ? draft.subscribeSms : true} />
              Subscribe to SMS
            </label>
          </section>

          {editId && <PortalAccessSection customerId={editId} />}

          {state.error && (
            <p role="alert" className="rounded bg-danger/10 px-3 py-2 text-sm text-on-tint-danger">{state.error}</p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose}
              className="rounded border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
            <Submit isEdit={!!editId} />
          </div>
        </form>
      </div>
    </DialogFrame>
  );
}
