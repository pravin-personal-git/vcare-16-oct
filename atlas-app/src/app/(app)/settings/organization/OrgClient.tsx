'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { addBranch, saveAiScan, saveOrganization, saveStore, saveTheme } from './actions';
import type { AiScanStatus } from '@/server/scan';

/**
 * Organisation profile, branches, and the brand palette.
 *
 * The palette editor is the white-label surface made real. The reference app has a
 * theme customizer too - but it is a *per-user* preference from its admin
 * template: it recolours the chrome for whoever clicked it and touches nothing
 * a customer ever sees. This one is stored on the **organisation**, injected as
 * `:root` overrides by the app layout, and therefore rebrands the product for
 * every user of that tenant, including on printed documents.
 *
 * That difference is the entire commercial argument for the rebuild, so it is
 * worth having a screen rather than a migration.
 */

interface Store {
  id: string; name: string; branchCode: string;
  stateId: string | null; cityId: string | null; address: string | null;
  currency: string; timezone: string; locale: string; isActive: boolean;
}

type BrandKind = 'logo' | 'seal' | 'icon' | 'favicon' | 'invoiceLogo' | 'paymentQr';

interface Props {
  org: {
    id: string; orgCode: string; name: string; gstin: string | null;
    email: string | null; mobile: string | null; industry: string | null; orgSize: string | null;
    paymentLink: string | null;
  };
  /** Public, ready-to-render URLs - null where nothing has been uploaded yet. */
  brand: Record<BrandKind, string | null>;
  stores: Store[];
  /** token key → current hex, or null where the tenant has not overridden it. */
  theme: { key: string; label: string; hint: string; hex: string | null; defaultHex: string }[];
  aiScan: AiScanStatus;
  canEdit: boolean;
}

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-muted disabled:text-muted-foreground';

export function OrgClient({ org, brand, stores, theme, aiScan, canEdit }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingBranch, setAddingBranch] = useState(false);

  const run = (fn: () => Promise<{ error?: string; message?: string }>) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else setNotice(res.message ?? 'Saved.');
    });
  };

  const flash = (msg: string | null, isError: boolean) => {
    if (isError) setError(msg);
    else setNotice(msg);
  };

  return (
    <div>
      <PageHeader
        badge="OP"
        title="Org Profile"
        subtitle={`${org.name} · ${org.orgCode}`}
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}
      {notice && (
        <Card className="mb-3 border-success/40 bg-success/5 p-3">
          <p className="flex items-start gap-2 text-sm">
            <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>{notice}</span>
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <OrgForm org={org} canEdit={canEdit} busy={pending} onSave={(p) => run(() => saveOrganization(p))} />
        <ThemeEditor theme={theme} canEdit={canEdit} busy={pending} onSave={(t) => run(() => saveTheme(t))} />
      </div>

      <BrandAssetsEditor brand={brand} canEdit={canEdit} onDone={flash} />

      <AiScanSettings status={aiScan} canEdit={canEdit} busy={pending}
        onSave={(v) => run(() => saveAiScan(v))} />

      <SectionCard
        title={`Branches (${stores.length})`}
        icon="building"
        className="mt-4"
        bodyClassName="p-0"
        action={canEdit ? (
          <Button size="sm" variant="primary" icon="plus" onClick={() => setAddingBranch(true)}>
            Add Branch
          </Button>
        ) : undefined}
      >
        {stores.map((s) => (
          <StoreRow
            key={s.id}
            store={s}
            canEdit={canEdit}
            busy={pending}
            onSave={(p) => run(() => saveStore(s.id, p))}
          />
        ))}
        <p className="border-t border-border bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
          The <strong>branch code</strong> cannot be changed. It is baked into every document number
          this branch has issued - changing it would orphan <code>QT-{stores[0]?.branchCode ?? 'BR001'}-2026-0007</code>{' '}
          from the branch that raised it, and GST expects that link to hold.
        </p>
      </SectionCard>

      {addingBranch && (
        <AddBranchDialog
          onClose={() => setAddingBranch(false)}
          onSaved={(msg) => { setAddingBranch(false); setNotice(msg); }}
          onError={setError}
        />
      )}
    </div>
  );
}

function AddBranchDialog({
  onClose, onSaved, onError,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [stateId, setStateId] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);

  function save() {
    setBusy(true);
    addBranch({
      name, branchCode,
      stateId: stateId || null, cityId: city || null, address: address || null,
    }).then((res) => {
      setBusy(false);
      if (res.error) onError(res.error);
      else onSaved(res.message ?? 'Branch created.');
    });
  }

  return (
    <Modal
      open
      title="Add a branch"
      subtitle="A new store under this organisation - you get access to it immediately"
      icon="building"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" icon="check" loading={busy}
            disabled={!name.trim() || !branchCode.trim()}
            onClick={save}
          >
            Create branch
          </Button>
        </div>
      }
    >
      <div className="grid gap-3">
        <Field label="Branch name" required htmlFor="nb-name">
          <input id="nb-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Branch code" required hint="2-10 letters/numbers, e.g. BR002 - cannot be changed later" htmlFor="nb-code">
          <input id="nb-code" value={branchCode} maxLength={10}
            onChange={(e) => setBranchCode(e.target.value.toUpperCase())}
            className={`${inputClass} font-mono uppercase`} />
        </Field>
        <Field label="State" hint="Drives CGST+SGST vs IGST on documents raised here" htmlFor="nb-state">
          <input id="nb-state" value={stateId} onChange={(e) => setStateId(e.target.value)} className={inputClass} />
        </Field>
        <Field label="City" htmlFor="nb-city">
          <input id="nb-city" value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Address" htmlFor="nb-addr">
          <textarea id="nb-addr" rows={2} value={address} onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand" />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

/**
 * The camera scanner reads barcodes on the phone - nothing leaves it. Reading
 * TEXT (invoices, cards, labels) sends the photo to Anthropic's AI, so that
 * part is off until an admin turns it on here, knowing that, and it has a
 * monthly cap so the bill cannot run away.
 */
function AiScanSettings({
  status, canEdit, busy, onSave,
}: {
  status: AiScanStatus;
  canEdit: boolean;
  busy: boolean;
  onSave: (v: { enabled: boolean; monthlyLimit: string }) => void;
}) {
  const [enabled, setEnabled] = useState(status.enabled);
  const [limit, setLimit] = useState(String(status.limit));
  const pct = status.limit ? Math.min(100, Math.round((status.used / status.limit) * 100)) : 0;

  return (
    <SectionCard
      title="AI scanning"
      icon="camera"
      className="mt-4"
      action={canEdit ? (
        <Button size="sm" variant="primary" loading={busy} onClick={() => onSave({ enabled, monthlyLimit: limit })}>Save</Button>
      ) : undefined}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-3 text-sm leading-relaxed">
          <p>
            The <strong>Scan</strong> button reads barcodes and QR codes with the phone camera. That always works and
            nothing leaves the phone.
          </p>
          <p>
            With AI scanning on, it can also read <strong>supplier invoices</strong>, <strong>visiting cards</strong> and{' '}
            <strong>product labels</strong> and fill in the form for you. The photo is sent to Anthropic&apos;s AI to be
            read; under Anthropic&apos;s commercial API terms it is not used to train their models. The photo is kept only
            here in Atlas, attached to the goods receipt or lead it filled in.
          </p>
          <label className="flex items-center gap-2 font-medium">
            <input id="ai-scan-enabled" type="checkbox" checked={enabled} disabled={!canEdit}
              onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
            Allow reading photos with AI for this business
          </label>
          <Field label="Monthly limit (reads)" htmlFor="ai-scan-limit" hint="Stops at this many reads each calendar month, India time">
            <input id="ai-scan-limit" value={limit} disabled={!canEdit} inputMode="numeric"
              onChange={(e) => setLimit(e.target.value)} className={`${inputClass} max-w-40 tabular-nums`} />
          </Field>
          {!status.configured && (
            <p className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs">
              <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>The server has no Anthropic key yet, so AI reading will not work even when switched on. Add <code>ANTHROPIC_API_KEY</code> in the hosting settings.</span>
            </p>
          )}
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground">This month</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{status.used.toLocaleString('en-IN')}<span className="text-sm font-normal text-muted-foreground"> / {status.limit.toLocaleString('en-IN')}</span></p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div className={`h-full ${pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-warning' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {status.enabled ? `${status.remaining.toLocaleString('en-IN')} reads left` : 'AI reading is off'}
          </p>
          <Badge tone={status.enabled && status.configured ? 'success' : 'neutral'}>
            {status.enabled ? (status.configured ? 'On' : 'On - key missing') : 'Off'}
          </Badge>
        </div>
      </div>
    </SectionCard>
  );
}

function OrgForm({
  org, canEdit, busy, onSave,
}: {
  org: Props['org'];
  canEdit: boolean;
  busy: boolean;
  onSave: (p: Record<string, string | null>) => void;
}) {
  const [name, setName] = useState(org.name);
  const [gstin, setGstin] = useState(org.gstin ?? '');
  const [email, setEmail] = useState(org.email ?? '');
  const [mobile, setMobile] = useState(org.mobile ?? '');
  const [industry, setIndustry] = useState(org.industry ?? '');
  const [orgSize, setOrgSize] = useState(org.orgSize ?? '');
  const [paymentLink, setPaymentLink] = useState(org.paymentLink ?? '');

  return (
    <SectionCard
      title="Company"
      icon="building"
      action={
        canEdit ? (
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={() => onSave({
              name: name.trim(),
              gstin: gstin.trim() || null,
              email: email.trim() || null,
              mobile: mobile.trim() || null,
              industry: industry.trim() || null,
              orgSize: orgSize.trim() || null,
              paymentLink: paymentLink.trim() || null,
            })}
          >
            Save
          </Button>
        ) : undefined
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Organisation name" required htmlFor="o-name" className="sm:col-span-2">
          <input id="o-name" value={name} disabled={!canEdit}
            onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="GSTIN" hint="15 characters" htmlFor="o-gstin">
          <input id="o-gstin" value={gstin} disabled={!canEdit} maxLength={15}
            onChange={(e) => setGstin(e.target.value.toUpperCase())}
            className={`${inputClass} font-mono`} />
        </Field>
        <Field label="Organisation code" hint="Set at provisioning; not editable" htmlFor="o-code">
          <input id="o-code" value={org.orgCode} disabled className={`${inputClass} font-mono`} />
        </Field>
        <Field label="Email" htmlFor="o-email">
          <input id="o-email" type="email" value={email} disabled={!canEdit}
            onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Mobile" htmlFor="o-mobile">
          <input id="o-mobile" value={mobile} disabled={!canEdit}
            onChange={(e) => setMobile(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Industry" htmlFor="o-industry">
          <input id="o-industry" value={industry} disabled={!canEdit}
            onChange={(e) => setIndustry(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Size" hint="e.g. 10-49" htmlFor="o-size">
          <input id="o-size" value={orgSize} disabled={!canEdit}
            onChange={(e) => setOrgSize(e.target.value)} className={inputClass} />
        </Field>
        <Field
          label="Payment link"
          hint="Shown on invoices next to the payment QR - a UPI link or payment-gateway page"
          htmlFor="o-payment-link"
          className="sm:col-span-2"
        >
          <input id="o-payment-link" value={paymentLink} disabled={!canEdit}
            onChange={(e) => setPaymentLink(e.target.value)} className={inputClass} />
        </Field>
      </div>
    </SectionCard>
  );
}

function ThemeEditor({
  theme, canEdit, busy, onSave,
}: {
  theme: Props['theme'];
  canEdit: boolean;
  busy: boolean;
  onSave: (tokens: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(theme.map((t) => [t.key, t.hex ?? t.defaultHex])),
  );

  const overridden = theme.some((t) => t.hex !== null);
  const dirty = theme.some((t) => values[t.key] !== (t.hex ?? t.defaultHex));

  return (
    <SectionCard
      title="Brand palette"
      icon="image"
      action={
        canEdit ? (
          <div className="flex gap-2">
            {overridden && (
              <Button size="sm" loading={busy} onClick={() => onSave({})}>
                Reset
              </Button>
            )}
            <Button size="sm" variant="primary" loading={busy} disabled={!dirty}
              onClick={() => onSave(values)}>
              Save
            </Button>
          </div>
        ) : undefined
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">
        Stored on the organisation and injected as <code>:root</code> overrides, so it rebrands the
        product for <strong>every user of this tenant</strong> - including printed documents. Not a
        personal preference.
      </p>

      <div className="grid gap-3">
        {theme.map((t) => (
          <div key={t.key} className="flex items-center gap-3">
            <input
              type="color"
              aria-label={t.label}
              value={values[t.key]}
              disabled={!canEdit}
              onChange={(e) => setValues((v) => ({ ...v, [t.key]: e.target.value }))}
              className="h-9 w-12 shrink-0 cursor-pointer rounded border border-border bg-card p-0.5 disabled:cursor-not-allowed"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t.label}</span>
                {t.hex === null && <Badge tone="neutral">default</Badge>}
              </div>
              <p className="truncate text-xs text-muted-foreground">{t.hint}</p>
            </div>
            <input
              value={values[t.key]}
              disabled={!canEdit}
              onChange={(e) => setValues((v) => ({ ...v, [t.key]: e.target.value }))}
              className="h-9 w-28 shrink-0 rounded-lg border border-border bg-card px-2 font-mono text-xs uppercase outline-none focus:border-brand disabled:bg-muted"
            />
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
        <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
          Preview
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {theme.map((t) => (
            <span
              key={t.key}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white shadow-card"
              style={{ backgroundColor: values[t.key] }}
            >
              {t.label}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Save to apply. Hovers, foregrounds and muted variants are computed from these three, which
          is why only three are exposed - a full token set lets a client build combinations nobody
          can read.
        </p>
      </div>
    </SectionCard>
  );
}

const BRAND_SLOTS: { kind: BrandKind; label: string; hint: string }[] = [
  { kind: 'logo', label: 'Logo', hint: 'Shown in the sidebar, the header, and on quotations and sales orders' },
  { kind: 'invoiceLogo', label: 'Invoice logo', hint: 'A separate logo for tax invoices, if it differs from the main one' },
  { kind: 'seal', label: 'Company seal', hint: 'The round stamp printed on documents, next to the signature line' },
  { kind: 'paymentQr', label: 'Payment QR', hint: 'A UPI or payment-gateway QR code, printed on invoices' },
  { kind: 'icon', label: 'App icon', hint: 'Square icon used inside the product' },
  { kind: 'favicon', label: 'Favicon', hint: 'Shown in the browser tab' },
];

function BrandAssetsEditor({
  brand, canEdit, onDone,
}: {
  brand: Props['brand'];
  canEdit: boolean;
  onDone: (message: string | null, isError: boolean) => void;
}) {
  const [urls, setUrls] = useState(brand);
  const [busyKind, setBusyKind] = useState<BrandKind | null>(null);

  async function upload(kind: BrandKind, file: File) {
    setBusyKind(kind);
    try {
      const form = new FormData();
      form.set('kind', kind);
      form.set('file', file);
      const res = await fetch('/api/brand', { method: 'POST', body: form });
      const body = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        onDone(body.error ?? 'Upload failed.', true);
        return;
      }
      setUrls((u) => ({ ...u, [kind]: body.url ?? null }));
      onDone('Saved. It applies wherever this image is used immediately.', false);
    } catch {
      onDone('Upload failed. Check your connection and try again.', true);
    } finally {
      setBusyKind(null);
    }
  }

  async function remove(kind: BrandKind) {
    setBusyKind(kind);
    try {
      const res = await fetch('/api/brand', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        onDone(body.error ?? 'Remove failed.', true);
        return;
      }
      setUrls((u) => ({ ...u, [kind]: null }));
      onDone('Removed.', false);
    } catch {
      onDone('Remove failed. Check your connection and try again.', true);
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <SectionCard title="Brand assets" icon="image" className="mt-4">
      <p className="mb-3 text-xs text-muted-foreground">
        JPEG, PNG or WebP, up to 2 MB. Stored on this organisation and public by design - a logo has to
        render inside a printed PDF and an emailed invoice, neither of which carries a login.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BRAND_SLOTS.map((slot) => (
          <BrandSlot
            key={slot.kind}
            {...slot}
            url={urls[slot.kind]}
            canEdit={canEdit}
            busy={busyKind === slot.kind}
            onUpload={(f) => upload(slot.kind, f)}
            onRemove={() => remove(slot.kind)}
          />
        ))}
      </div>
    </SectionCard>
  );
}

function BrandSlot({
  kind, label, hint, url, canEdit, busy, onUpload, onRemove,
}: {
  kind: BrandKind; label: string; hint: string; url: string | null;
  canEdit: boolean; busy: boolean;
  onUpload: (file: File) => void; onRemove: () => void;
}) {
  const inputId = `brand-${kind}`;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted/40">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- tenant-hosted, no fixed domain to allowlist
          <img src={url} alt={label} className="h-full w-full object-contain" />
        ) : (
          <Icon name="image" className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{hint}</p>
        {canEdit && (
          <div className="mt-1.5 flex gap-2">
            <label htmlFor={inputId} className="cursor-pointer">
              <span className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted/60">
                {busy ? 'Uploading…' : url ? 'Replace' : 'Upload'}
              </span>
              <input
                id={inputId}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onUpload(f);
                  e.target.value = '';
                }}
              />
            </label>
            {url && (
              <button
                type="button"
                disabled={busy}
                onClick={onRemove}
                className="inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium text-danger hover:bg-danger/10"
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StoreRow({
  store, canEdit, busy, onSave,
}: {
  store: Store;
  canEdit: boolean;
  busy: boolean;
  onSave: (p: Record<string, string | null | boolean>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(store.name);
  const [stateId, setStateId] = useState(store.stateId ?? '');
  const [city, setCity] = useState(store.cityId ?? '');
  const [address, setAddress] = useState(store.address ?? '');
  const [currency, setCurrency] = useState(store.currency);
  const [timezone, setTimezone] = useState(store.timezone);

  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-muted/40"
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium">{store.name}</span>
        <span className="font-mono text-xs text-muted-foreground">{store.branchCode}</span>
        <Badge tone={store.isActive ? 'success' : 'neutral'}>
          {store.isActive ? 'Active' : 'Inactive'}
        </Badge>
      </button>

      {open && (
        <div className="border-t border-border bg-muted/20 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Branch name" htmlFor={`s-name-${store.id}`}>
              <input id={`s-name-${store.id}`} value={name} disabled={!canEdit}
                onChange={(e) => setName(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Branch code" hint="Not editable - it is in every document number" htmlFor={`s-code-${store.id}`}>
              <input id={`s-code-${store.id}`} value={store.branchCode} disabled
                className={`${inputClass} font-mono`} />
            </Field>
            <Field
              label="State"
              hint="Drives CGST+SGST vs IGST on every document raised here"
              htmlFor={`s-state-${store.id}`}
            >
              <input id={`s-state-${store.id}`} value={stateId} disabled={!canEdit}
                onChange={(e) => setStateId(e.target.value)} className={inputClass} />
            </Field>
            <Field label="City" htmlFor={`s-city-${store.id}`}>
              <input id={`s-city-${store.id}`} value={city} disabled={!canEdit}
                onChange={(e) => setCity(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Address" htmlFor={`s-addr-${store.id}`} className="sm:col-span-2">
              <textarea id={`s-addr-${store.id}`} rows={2} value={address} disabled={!canEdit}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg border border-border bg-card p-2 text-sm outline-none focus:border-brand disabled:bg-muted" />
            </Field>
            <Field label="Currency" hint="3-letter code, e.g. INR" htmlFor={`s-currency-${store.id}`}>
              <input id={`s-currency-${store.id}`} value={currency} disabled={!canEdit} maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className={`${inputClass} font-mono uppercase`} />
            </Field>
            <Field label="Timezone" hint="IANA name, e.g. Asia/Kolkata" htmlFor={`s-timezone-${store.id}`}>
              <input id={`s-timezone-${store.id}`} value={timezone} disabled={!canEdit}
                onChange={(e) => setTimezone(e.target.value)} className={`${inputClass} font-mono`} />
            </Field>
          </div>

          {canEdit && (
            <div className="mt-3 flex justify-end gap-2">
              <Button
                size="sm"
                loading={busy}
                onClick={() => onSave({ isActive: !store.isActive })}
              >
                {store.isActive ? 'Deactivate branch' : 'Reactivate branch'}
              </Button>
              <Button
                size="sm"
                variant="primary"
                loading={busy}
                disabled={!name.trim()}
                onClick={() => onSave({
                  name: name.trim(),
                  stateId: stateId.trim() || null,
                  cityId: city.trim() || null,
                  address: address.trim() || null,
                  currency: currency.trim().toUpperCase() || 'INR',
                  timezone: timezone.trim() || 'Asia/Kolkata',
                })}
              >
                Save branch
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
