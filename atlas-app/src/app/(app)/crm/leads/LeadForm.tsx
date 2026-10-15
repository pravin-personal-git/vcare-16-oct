'use client';

import { Icon } from '@/components/ui/Icon';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { addLead, type LeadFormState } from './actions';
import { AiScanButton } from '@/components/scan/AiScanButton';
import { attachScanPhoto } from '@/components/scan/ai';
import { splitPersonName, type VisitingCardScan } from '@/lib/scan/extraction';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { CustomFieldInputs, useFieldSetup } from '@/components/custom-fields/CustomFieldInputs';
import { stdRequired, stdShown } from '@/lib/custom-fields';
import { ask } from '@/components/ui/ask';

const TITLES = ['', 'Mr', 'Mrs', 'Ms', 'Dr', 'Prof'];
const DESIGNATIONS = ['', 'Owner', 'Director', 'Manager', 'Accountant', 'Purchase Manager', 'Staff', 'Other'];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="inline-flex h-9 items-center gap-2 rounded bg-brand px-4 text-sm font-semibold text-brand-fg shadow-card transition hover:bg-brand-hover disabled:opacity-50">
      {pending ? 'Saving…' : '+ Add Lead'}
    </button>
  );
}

function Field({ label, name, type = 'text', placeholder, required, prefix, maxLength, defaultValue }: {
  label: string; name: string; type?: string; placeholder?: string;
  required?: boolean; prefix?: string; maxLength?: number; defaultValue?: string | number;
}) {
  return (
    <label className="block">
      <span className="field-label">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      <div className="flex items-center rounded border border-border bg-card transition focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        {prefix && <span className="ps-2 text-sm text-muted-foreground">{prefix}</span>}
        <input name={name} type={type} placeholder={placeholder} required={required}
          maxLength={maxLength} defaultValue={defaultValue}
          className="w-full rounded bg-transparent px-3 py-2 text-sm outline-none" />
      </div>
    </label>
  );
}

function Choice({ label, name, options, required }: {
  label: string; name: string;
  options: { value: string; label: string }[]; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="field-label">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      <select name={name} required={required}
        className="field-input">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function LeadForm({ stages, dealStages, sources, users, initialCard = null, onClose }: {
  stages: { id: string; name: string; isGroupHeader: boolean; parentId: string | null }[];
  dealStages: { id: string; name: string }[];
  sources: { id: string; name: string }[];
  users: { id: string; fullName: string }[];
  /** A visiting card already read by the header scanner. */
  initialCard?: { data: VisitingCardScan; photo: Blob | null } | null;
  onClose: () => void;
}) {
  const [state, formAction] = useActionState<LeadFormState, FormData>(addLead, {});
  const [gps, setGps] = useState<{ lat: string; lng: string }>({ lat: '', lng: '' });
  const formRef = useRef<HTMLFormElement>(null);
  const photoRef = useRef<Blob | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  // Settings > Custom Fields - built-ins switched off or made mandatory, and extra fields.
  const { setup } = useFieldSetup('lead');
  const show = (k: string) => stdShown(setup, k);
  const req = (k: string) => stdRequired(setup, k);

  useEffect(() => {
    if (!state.ok) return;
    let alive = true;
    (async () => {
      // The card the lead was read from, kept on the lead.
      if (photoRef.current && state.id) {
        const failed = await attachScanPhoto('lead', state.id, photoRef.current, 'Scanned visiting card');
        if (failed) console.warn('[leads] card photo not attached:', failed);
      }
      if (!alive) return;
      if (state.warning) await ask.tell({ tone: 'warning', message: state.warning });
      onClose();
    })();
    return () => { alive = false; };
  }, [state.ok, state.id, state.warning, onClose]);

  /**
   * Fill the form from a photographed visiting card. The form's inputs are
   * uncontrolled, so the values are written into them directly - every one
   * still editable, and nothing saved until the person presses Add Lead.
   */
  const applyCard = (card: VisitingCardScan, photo: Blob | null) => {
    const form = formRef.current;
    if (!form) return;
    if (photo) photoRef.current = photo;
    const put = (name: string, value: string | null | undefined) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      if (!el || !value) return false;
      if (el instanceof HTMLSelectElement && ![...el.options].some((o) => o.value === value)) return false;
      el.value = value;
      return true;
    };
    const name = splitPersonName(card.personName);
    put('businessName', card.companyName);
    put('gstin', card.gstin);
    put('title', name.title);
    put('firstName', name.firstName || card.companyName);
    put('lastName', name.lastName);
    const designationSet = put('designation', card.designation);
    put('mobile', card.mobiles[0]);
    put('altMobile', card.mobiles[1]);
    put('email', card.email);
    put('addressLine1', card.address);
    put('city', card.city);
    put('state', card.state);
    put('pincode', card.pincode);
    const extra = [
      card.designation && !designationSet ? `Designation: ${card.designation}` : null,
      card.website ? `Website: ${card.website}` : null,
      card.mobiles[2] ? `Other phone: ${card.mobiles[2]}` : null,
    ].filter(Boolean).join('\n');
    if (extra) put('notes', extra);
    const missing = [!card.mobiles[0] && 'mobile', !name.firstName && !card.companyName && 'name'].filter(Boolean);
    setScanNote(`Filled from the visiting card - check every field before saving.${missing.length ? ` Not found on the card: ${missing.join(', ')}.` : ''}${photo ? ' The card photo will be attached to the lead.' : ''}`);
  };

  useEffect(() => {
    if (initialCard) applyCard(initialCard.data, initialCard.photo);
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getGps = () => {
    if (!navigator.geolocation) return void ask.tell({ tone: 'warning', title: 'Location is not available', message: 'This browser cannot share your location. You can type the address instead.' });
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ lat: String(p.coords.latitude), lng: String(p.coords.longitude) }),
      () => void ask.tell({ tone: 'warning', title: 'Could not get your location', message: 'Allow location for this site in the browser (the icon at the left of the address bar), then try again.' }),
    );
  };

  return (
    <DialogFrame label="New lead" onClose={onClose} className="fixed inset-0 z-[200] grid place-items-center bg-navy/40 p-2 sm:p-4">
      <div className="thin-scroll max-h-[94vh] w-full max-w-3xl animate-slide-up overflow-y-auto rounded-lg bg-card shadow-overlay">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card px-5 py-3.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-on-tint-brand">
            <Icon name="user-plus" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold leading-tight">Add New Lead</h2>
            <p className="truncate text-xs text-muted-foreground">Fields marked * are mandatory</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="ms-auto grid h-8 w-8 shrink-0 place-items-center rounded-full bg-danger/10 text-on-tint-danger transition hover:bg-danger/20">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <form ref={formRef} action={formAction} className="space-y-6 p-5">
          <div className="flex flex-wrap items-start gap-2">
            <AiScanButton kind="visiting_card" label="Scan visiting card" onResult={(r, photo) => applyCard(r.data, photo)} />
            {scanNote && <p className="min-w-0 flex-1 rounded bg-brand/[0.06] px-3 py-1.5 text-xs leading-relaxed">{scanNote}</p>}
          </div>
          <section>
            <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">Core data</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {show('businessName') && <Field label="Business / Company" name="businessName" required={req('businessName')} />}
              {show('gstin') && <Field label="GSTIN" name="gstin" placeholder="15-character GSTIN" maxLength={15} required={req('gstin')} />}
              {show('title') && <Choice label="Title" name="title" options={TITLES.map((t) => ({ value: t, label: t || '-' }))} required={req('title')} />}
              <Field label="First Name" name="firstName" required />
              <Field label="Last Name" name="lastName" />
              {show('designation') && (
                <Choice label="Designation" name="designation" required={req('designation')}
                options={DESIGNATIONS.map((d) => ({ value: d, label: d || '- Select -' }))} />
              )}
              <Field label="Mobile" name="mobile" required prefix="+91" maxLength={10} placeholder="10-digit number" />
              {show('altMobile') && <Field label="Alt Mobile" name="altMobile" prefix="+91" maxLength={10} required={req('altMobile')} />}
              {show('email') && <Field label="Email" name="email" type="email" required={req('email')} />}
              {show('refCode') && <Field label="Lead Code / Reference" name="refCode" required={req('refCode')} />}
              {show('addressLine1') && <div className="sm:col-span-2"><Field label="Address Line 1" name="addressLine1" placeholder="Street / Building" required={req('addressLine1')} /></div>}
              <div className="sm:col-span-2"><Field label="Address Line 2" name="addressLine2" placeholder="Area / Locality" /></div>
              <Field label="State" name="state" />
              <Field label="City" name="city" />
              {show('pincode') && <Field label="Pincode" name="pincode" maxLength={6} required={req('pincode')} />}
              <Choice label="Deal Stage" name="dealStageId"
                options={[{ value: '', label: '- Select Deal Stage -' },
                  ...dealStages.map((d) => ({ value: d.id, label: d.name }))]} />
              <Choice label="Pipeline Stage" name="stageId"
                options={[{ value: '', label: '- Select Stage -' },
                  ...stages.filter((s) => !s.isGroupHeader).map((s) => ({ value: s.id, label: s.name }))]} />
              <Choice label="Assigned To" name="assignedToUserId"
                options={[
                  { value: '', label: 'Assign later' },
                  { value: '__round_robin__', label: 'Round robin (least loaded)' },
                  ...users.map((u) => ({ value: u.id, label: u.fullName })),
                ]} />
            </div>
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">Business opportunity</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice label="Source" name="sourceId"
                options={[{ value: '', label: '- Select Source -' },
                  ...sources.map((s) => ({ value: s.id, label: s.name }))]} />
              {show('potential') && <Field label="Potential" name="potential" type="number" prefix="₹" defaultValue={0} required={req('potential')} />}
              <Field label="Last Talk" name="lastTalk" type="date" />
              <Field label="Next Action" name="nextAction" type="date" />
              <div className="sm:col-span-2">
                <label className="block">
                  <span className="field-label">Requirement</span>
                  <textarea name="requirement" rows={2} placeholder="Describe what the lead is looking for…"
                    className="field-input" />
                </label>
              </div>
              <div className="sm:col-span-2">
                <label className="block">
                  <span className="field-label">Notes</span>
                  <textarea name="notes" rows={2}
                    className="field-input" />
                </label>
              </div>
              <div className="sm:col-span-2">
                <Field label="Tags" name="tags" placeholder="Comma separated - e.g. cctv, urgent" />
              </div>
            </div>
          </section>

          {setup.custom.length > 0 && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">More details</h3>
              <CustomFieldInputs configs={setup.custom} />
            </section>
          )}

          <section>
            <h3 className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-micro font-bold uppercase text-navy before:h-3.5 before:w-1 before:rounded-full before:bg-brand before:content-['']">Location</h3>
            <div className="grid gap-4 sm:grid-cols-4">
              <label className="block">
                <span className="field-label">Latitude</span>
                <input name="latitude" value={gps.lat} onChange={(e) => setGps({ ...gps, lat: e.target.value })}
                  placeholder="e.g. 21.1938"
                  className="field-input" />
              </label>
              <label className="block">
                <span className="field-label">Longitude</span>
                <input name="longitude" value={gps.lng} onChange={(e) => setGps({ ...gps, lng: e.target.value })}
                  placeholder="e.g. 81.3509"
                  className="field-input" />
              </label>
              <Field label="Location Note" name="locationNote" placeholder="Office / site" />
              <div className="flex items-end">
                <button type="button" onClick={getGps}
                  className="w-full rounded bg-success px-3 py-2 text-sm font-medium text-white hover:opacity-90">
                  Get GPS
                </button>
              </div>
            </div>
          </section>

          {state.error && (
            <p role="alert" className="rounded bg-danger/10 px-3 py-2 text-sm text-on-tint-danger">{state.error}</p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose}
              className="rounded border border-border px-4 py-2 text-sm hover:bg-muted">Cancel</button>
            <Submit />
          </div>
        </form>
      </div>
    </DialogFrame>
  );
}
