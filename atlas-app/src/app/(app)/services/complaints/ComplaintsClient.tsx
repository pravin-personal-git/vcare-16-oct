'use client';

import { CustomerLink } from '@/components/document/CustomerLink';
import { EquipmentPicker, type PickedItem } from './EquipmentPicker';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge } from '@/components/ui/Layout';
import { ColoredStatus } from '@/components/ui/PageCustomise';
import type { PaletteKey } from '@/lib/page-customise';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { DataGrid, type Column, type ServerPaging } from '@/components/ui/DataGrid';
import { KpiStrip, type KpiCard } from '@/components/ui/KpiStrip';
import { FilterBar, type FilterBarViews } from '@/components/ui/FilterBar';
import { SearchSelect, type SearchOption } from '@/components/ui/SearchSelect';
import { useListParams } from '@/components/ui/useListParams';
import { LocationCapture, type CapturedLocation } from '@/components/ui/LocationCapture';
import {
  createComplaintAction, assignTechnicianAction,
  saveFieldConfigAction, removeFieldConfigAction,
  loadCustomerSitesAction,
} from '../actions';
import { searchCustomersAction } from '@/app/actions/search-options';
import type { ComplaintRow, ComplaintFieldConfigRow } from '@/server/complaints';
import { TechnicianOptions } from '@/components/services/TechnicianOptions';
import { OFFICE_LABEL } from '@/lib/job-flow';
import { contactActions } from '@/lib/quick-actions';
import { complaintBlocker, stdRequired, stdShown, type FieldSetup } from '@/lib/custom-fields';

type Complaint = Omit<ComplaintRow, 'createdAt'> & { createdAt: string };
type Technician = { id: string; fullName: string; serviceTeam: boolean };

const STATUS_LABEL: Record<string, string> = OFFICE_LABEL;

const fieldClass = 'w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground';
const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function ComplaintsClient({
  rows, paging, counts, card, rangeLabel, technicians, fieldConfigs, rules, canEdit, canConfigure, canExport, views,
  categories, categoryId, raiseFor = null, stageColors = {},
}: {
  /** Stage colours set on the Jobs Dashboard's Customise page (11 Oct 2026). */
  stageColors?: Record<string, PaletteKey>;
  /** From `?raise=<customer id>` (G-39): open the form with this customer chosen. */
  raiseFor?: SearchOption | null;
  /** One page, filtered and sorted on the server. */
  rows: Complaint[];
  paging: ServerPaging;
  counts: Record<string, number>;
  /** null while a search looks across every status. */
  card: string | null;
  /** The date range in force, in words ("FY 2026-27", "All time"). */
  rangeLabel: string;
  technicians: Technician[];
  fieldConfigs: ComplaintFieldConfigRow[];
  /** Field rules: which built-in fields this branch shows and demands. */
  rules: FieldSetup;
  canEdit: boolean;
  canConfigure: boolean;
  canExport: boolean;
  views: FilterBarViews;
  /** Only the categories that actually appear on a complaint (3 Oct 2026). */
  categories: { id: string; name: string }[];
  categoryId: string | null;
}) {
  const router = useRouter();
  const list = useListParams();
  const [showRaise, setShowRaise] = useState(!!raiseFor);
  const [showFields, setShowFields] = useState(false);
  const [pending, startTransition] = useTransition();
  // The row dropdown used to drop a failed save silently (27 Sep 2026).
  const [assignError, setAssignError] = useState<string | null>(null);

  const setTechnician = (complaintId: string, technicianId: string) => {
    if (!technicianId) return;
    setAssignError(null);
    startTransition(async () => {
      const r = await assignTechnicianAction(complaintId, technicianId);
      if (r.error) setAssignError(r.error);
      router.refresh();
    });
  };

  const cards: KpiCard[] = [
    { key: 'open', label: 'Open', count: counts.open, icon: 'alert-circle', tone: 'brand' },
    { key: 'unassigned', label: 'No technician', count: counts.unassigned, icon: 'user-plus', tone: counts.unassigned ? 'warning' : 'default' },
    { key: 'urgent', label: 'Urgent / high', count: counts.urgent, icon: 'alert-triangle', tone: counts.urgent ? 'danger' : 'default' },
    { key: 'received', label: 'New', count: counts.received, icon: 'clock' },
    { key: 'assigned', label: 'Waiting for technician', count: counts.assigned, icon: 'user-plus', tone: counts.assigned ? 'warning' : 'default' },
    { key: 'in_progress', label: 'In the field', count: counts.in_progress, icon: 'refresh' },
    { key: 'awaiting_customer', label: 'Waiting for customer', count: counts.awaiting_customer, icon: 'user' },
    { key: 'resolved', label: 'Waiting to close', count: counts.resolved, icon: 'check-circle', tone: 'success' },
    // Finished jobs - the list opens on Open, these two show the rest (Pravin, 28 Sep 2026).
    { key: 'closed', label: 'Closed', count: counts.closed, icon: 'check-circle' },
    { key: 'cancelled', label: 'Cancelled', count: counts.cancelled, icon: 'ban' },
  ];

  const columns: Column<Complaint>[] = [
    {
      key: 'complaintNo', header: 'Complaint', width: '11rem', sortValue: (c) => c.complaintNo,
      render: (c) => (
        <Link href={`/services/complaints/${c.id}`} className="block">
          <span className="font-mono text-xs font-semibold text-brand hover:underline">{c.complaintNo}</span>
          {c.legacyRef && c.legacyRef !== c.complaintNo && <span className="block text-xs text-muted-foreground">was {c.legacyRef}</span>}
        </Link>
      ),
    },
    { key: 'createdAt', header: 'Raised', sortValue: (c) => c.createdAt, render: (c) => <span className="whitespace-nowrap text-xs">{fmt(c.createdAt)}</span> },
    {
      key: 'customer', header: 'Customer', sortValue: (c) => c.customerName,
      render: (c) => (
        <div className="min-w-[11rem]">
          <p className="text-sm font-medium"><CustomerLink id={c.customerId}>{c.customerName}</CustomerLink></p>
          <p className="text-xs text-muted-foreground">{c.customerPhone}</p>
        </div>
      ),
    },
    {
      key: 'status', header: 'Status', sortValue: (c) => c.status,
      render: (c) => (
        <div className="flex flex-wrap gap-1">
          <ColoredStatus colors={stageColors} status={c.status} label={STATUS_LABEL[c.status]} />
          {c.priority !== 'normal' && c.priority !== 'low' && <Badge tone={c.priority === 'urgent' ? 'danger' : 'warning'}>{c.priority}</Badge>}
          {c.raisedByPortal && <Badge tone="info">Customer</Badge>}
        </div>
      ),
    },
    {
      key: 'technician', header: 'Technician', sortValue: (c) => c.assignedTechnicianName,
      render: (c) => canEdit ? (
        <select
          aria-label={`Technician for ${c.complaintNo}`}
          disabled={pending}
          value={c.assignedTechnicianId ?? ''}
          onChange={(e) => setTechnician(c.id, e.target.value)}
          className="h-8 max-w-[11rem] rounded-lg border border-border bg-card px-2 text-xs outline-none disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          <option value="">Assign…</option>
          <TechnicianOptions technicians={technicians} />
          {c.assignedTechnicianId && !technicians.some((t) => t.id === c.assignedTechnicianId) && (
            <option value={c.assignedTechnicianId}>{c.assignedTechnicianName ?? 'Assigned'}</option>
          )}
        </select>
      ) : <span className="text-xs">{c.assignedTechnicianName ?? '-'}</span>,
    },
    { key: 'product', header: 'Equipment', sortValue: (c) => c.productName, render: (c) => <span className="text-xs">{c.productName ?? '-'}</span> },
    {
      key: 'description', header: 'Problem',
      render: (c) => <p className="line-clamp-2 max-w-[22rem] text-xs text-muted-foreground" title={c.description}>{c.description}</p>,
    },
    {
      key: 'amc', header: 'AMC', optional: true,
      render: (c) => c.amcContractNo ? (
        <Badge tone={c.amcDaysToExpiry !== null && c.amcDaysToExpiry <= 30 ? 'warning' : 'success'} icon="refresh">
          Has AMC{c.amcItemised ? ' (partial)' : ''}
        </Badge>
      ) : <span className="text-xs text-muted-foreground">-</span>,
    },
    { key: 'owner', header: 'Owner', optional: true, sortValue: (c) => c.ownerName, render: (c) => <span className="text-xs">{c.ownerName ?? '-'}</span> },
    { key: 'site', header: 'Site', optional: true, sortValue: (c) => c.siteLocation, render: (c) => <span className="text-xs">{c.siteLocation ?? '-'}</span> },
    { key: 'priority', header: 'Priority', optional: true, sortValue: (c) => c.priority, render: (c) => <span className="text-xs capitalize">{c.priority}</span> },
  ];

  return (
    <div>
      <PageHeader
        badge="SC"
        title="Customer Complaints"
        subtitle="Raised by customers or entered by staff - open one to see its full history"
        actions={
          <div className="flex gap-2">
            {canConfigure && <Button icon="sliders" onClick={() => setShowFields(true)}>Configure fields</Button>}
            {canEdit && <Button variant="primary" icon="plus" onClick={() => setShowRaise(true)}>Raise complaint</Button>}
          </div>
        }
      />

      <FilterBar
        searchPlaceholder="Complaint no, old no, customer, phone, equipment, site…"
        dates={{ defaultPreset: 'all', label: 'Raised', activeLabel: rangeLabel }}
        people={{ label: 'Technician', options: technicians }}
        shown={paging.total}
        clearKeys={['card', 'cat']}
        exportScreen={canExport ? 'complaints' : null}
        views={views}
        extra={categories.length > 0 ? (
          /*
            Filter by WHAT BROKE, not only by what state the job is in. The
            screen had status cards and nothing else, so "every camera
            complaint" was unanswerable. Through the URL like the other filters,
            so it survives a reload, a saved view and the export.
          */
          <select
            value={categoryId ?? ''}
            onChange={(e) => list.set({ cat: e.target.value || null })}
            aria-label="Equipment category"
            className="h-8 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-brand"
          >
            <option value="">All equipment</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : undefined}
      />

      <KpiStrip cards={cards} activeKey={card} onSelect={(k) => list.set({ card: k && (k !== 'open' || list.get('q')) ? k : null })} columns={8} />

      {assignError && (
        <p role="alert" className="mb-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-on-tint-danger">
          {assignError}
        </p>
      )}

      <DataGrid
        rows={rows}
        server={paging}
        columns={columns}
        rowKey={(c) => c.id}
        quickActions={(c) => contactActions(c.customerPhone, `Hello ${c.customerName}, about your complaint ${c.complaintNo}: `)}
        emptyIcon="alert-circle"
        emptyMessage={card === 'open' ? 'No open complaints match' : 'No complaints match'}
        emptyHint="Try another status card, a wider date range, or Clear all filters. New ones are raised above, from the Vcare app or the customer portal."
        mobileCard={(c) => (
          <Link href={`/services/complaints/${c.id}`} className="block">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-brand">{c.complaintNo}</span>
              <ColoredStatus colors={stageColors} status={c.status} label={STATUS_LABEL[c.status]} />
            </div>
            <p className="mt-1 truncate text-sm font-medium">{c.customerName}</p>
            <p className="line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {fmt(c.createdAt)} · {c.assignedTechnicianName ?? 'No technician'}
              {(c.priority === 'urgent' || c.priority === 'high') && <span className="ms-1 font-semibold text-danger">· {c.priority}</span>}
            </p>
          </Link>
        )}
        actions={[
          { label: 'Open complaint', icon: 'external-link', iconTone: 'brand', onSelect: (c) => router.push(`/services/complaints/${c.id}`) },
          { label: 'Schedule a visit', icon: 'calendar', onSelect: (c) => router.push(`/services/visits?complaint=${c.id}`) },
          { label: 'Call customer', icon: 'phone', onSelect: (c) => { window.location.href = `tel:${c.customerPhone}`; } },
        ]}
      />

      {showRaise && (
        <RaiseComplaintDialog
          initialCustomer={raiseFor}
          fieldConfigs={fieldConfigs}
          rules={rules}
          onClose={() => setShowRaise(false)}
          onRaised={(id) => { setShowRaise(false); router.push(`/services/complaints/${id}`); }}
        />
      )}
      {showFields && (
        <FieldConfigDialog fieldConfigs={fieldConfigs} onClose={() => setShowFields(false)} />
      )}
    </div>
  );
}

function RaiseComplaintDialog({
  fieldConfigs, rules, onClose, onRaised, initialCustomer = null,
}: {
  initialCustomer?: SearchOption | null;
  fieldConfigs: ComplaintFieldConfigRow[];
  rules: FieldSetup;
  onClose: () => void;
  onRaised: (id: string) => void;
}) {
  /**
   * Field rules (Settings > Custom Fields > Complaints). A field switched off
   * leaves the form and stops being demanded; one marked required blocks the
   * save. Nothing set means the form behaves as it always has.
   */
  const show = (k: string) => stdShown(rules, k);
  const need = (k: string) => stdShown(rules, k) && stdRequired(rules, k);
  const [customer, setCustomer] = useState<SearchOption | null>(initialCustomer);
  const customerId = customer?.id ?? '';
  // What is broken - one or more items (10 Oct 2026, repair flow stage 2).
  const [items, setItems] = useState<PickedItem[]>([]);
  const productId = items.find((i) => i.productId)?.productId ?? (items.length ? 'not-ours' : '');
  const [siteLocation, setSiteLocation] = useState('');
  const [location, setLocation] = useState<CapturedLocation | null>(null);
  // The customer's named sites (Phase 5). Picking one fills the pin and the
  // note, so a repeat site is one click rather than a pasted link each time.
  const [sites, setSites] = useState<Awaited<ReturnType<typeof loadCustomerSitesAction>>>([]);
  // Opened for a customer (G-39): their sites load as if they had been picked.
  useEffect(() => { if (initialCustomer) loadCustomerSitesAction(initialCustomer.id).then(setSites); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [siteId, setSiteId] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pickCustomer = (o: SearchOption | null) => {
    setCustomer(o);
    const id = o?.id ?? '';
    setItems([]);
    setSites([]);
    setSiteId('');
    if (id) {
      loadCustomerSitesAction(id).then(setSites);
    }
  };

  const pickSite = (id: string) => {
    setSiteId(id);
    const s = sites.find((x) => x.id === id);
    if (!s) return;
    setSiteLocation([s.name, s.address].filter(Boolean).join(' - '));
    // Only a site with a real pin fills the location; one without leaves the
    // location to be shared or pasted, rather than inventing coordinates.
    if (s.latitude !== null && s.longitude !== null) setLocation({ lat: s.latitude, lng: s.longitude, source: 'maps_link' });
  };

  /** What the rules are judged against. Built once; the button and the save
      handler both read it, so they can never disagree. */
  const draftForRules = {
    description, hasLocation: Boolean(location), productId, siteId, siteNote: siteLocation,
  };

  const save = () => {
    setError(null);
    if (!customerId) { setError('Select a customer.'); return; }
    const blocker = complaintBlocker(rules, draftForRules);
    if (blocker) { setError(blocker); return; }
    startTransition(async () => {
      const res = await createComplaintAction({
        customerId, productId: items.find((i) => i.productId)?.productId ?? null,
        items: items.map((i) => ({ ours: i.ours, stockUnitId: i.stockUnitId, productId: i.productId, equipmentName: i.equipmentName, serialNo: i.serialNo })),
        siteLocation: siteLocation || null, siteId: siteId || null,
        siteLat: location?.lat ?? null, siteLng: location?.lng ?? null, siteSource: location?.source ?? null,
        description, priority, customFields,
      });
      if (res.error) { setError(res.error); return; }
      if (res.id) onRaised(res.id); else onClose();
    });
  };

  return (
    <Modal
      title="Raise a complaint"
      subtitle="Customer, equipment, where it is, and what is wrong"
      icon="alert-circle"
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          {/* Was `|| !location`, hard-coded. The GPS pin is now whatever the
              branch's field rules say it is. "What is wrong" cannot be
              switched off (fallback 'block'), so it is always demanded. */}
          <Button variant="primary" onClick={save}
            disabled={pending || complaintBlocker(rules, draftForRules) !== null}>
            Raise complaint
          </Button>
        </div>
      }
    >
        <div className="grid gap-3">
          {error && <p className="rounded border border-danger/40 bg-danger/5 px-2.5 py-2 text-xs text-on-tint-danger">{error}</p>}

          <div className="grid gap-1 text-xs font-medium text-muted-foreground">
            <label htmlFor="raise-customer">Customer</label>
            <SearchSelect
              id="raise-customer"
              value={customer}
              onChange={pickCustomer}
              search={searchCustomersAction}
              placeholder="Type a name, company or phone…"
            />
          </div>

          {customerId && show('productId') && (
            <EquipmentPicker customerId={customerId} value={items} onChange={setItems} required={need('productId')} />
          )}

          {sites.length > 0 && show('siteId') && (
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Site{need('siteId') && <span className="text-danger"> *</span>}
              <select value={siteId} onChange={(e) => pickSite(e.target.value)} className={fieldClass}>
                <option value="">Not one of their saved sites</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}{s.contactName ? ` · ${s.contactName}` : ''}{s.latitude === null ? ' (no pin)' : ''}</option>)}
              </select>
            </label>
          )}

          {show('siteLocation') && (
            <div className="grid gap-1">
              <p className="text-xs font-medium text-muted-foreground">
                Site location{need('siteLocation')
                  ? <span className="text-danger"> *</span>
                  : <span className="text-muted-foreground/70"> (optional)</span>}
              </p>
              <LocationCapture value={location} onChange={setLocation} required={need('siteLocation')} />
            </div>
          )}

          {show('siteNote') && (
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Site note{need('siteNote')
                ? <span className="text-danger"> *</span>
                : <span className="text-muted-foreground/70"> (optional)</span>}
              <input value={siteLocation} onChange={(e) => setSiteLocation(e.target.value)} className={fieldClass} placeholder="Gate 3, near the warehouse" />
            </label>
          )}

          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={fieldClass} placeholder="What's wrong" />
          </label>

          {show('priority') && (
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={fieldClass}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          )}

          {fieldConfigs.map((f) => (
            <label key={f.id} className="grid gap-1 text-xs font-medium text-muted-foreground">
              {f.label}{f.required && <span className="text-danger"> *</span>}
              {f.fieldType === 'select' ? (
                <select value={customFields[f.fieldKey] ?? ''} onChange={(e) => setCustomFields((p) => ({ ...p, [f.fieldKey]: e.target.value }))} className={fieldClass}>
                  <option value="">Choose…</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.fieldType === 'boolean' ? (
                <select value={customFields[f.fieldKey] ?? ''} onChange={(e) => setCustomFields((p) => ({ ...p, [f.fieldKey]: e.target.value }))} className={fieldClass}>
                  <option value="">Choose…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              ) : (
                <input
                  type={f.fieldType === 'number' ? 'number' : 'text'}
                  value={customFields[f.fieldKey] ?? ''}
                  onChange={(e) => setCustomFields((p) => ({ ...p, [f.fieldKey]: e.target.value }))}
                  className={fieldClass}
                />
              )}
            </label>
          ))}
        </div>
    </Modal>
  );
}

function FieldConfigDialog({ fieldConfigs, onClose }: { fieldConfigs: ComplaintFieldConfigRow[]; onClose: () => void }) {
  const [rows, setRows] = useState(fieldConfigs);
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);
  const [pending, startTransition] = useTransition();

  const add = () => {
    if (!label.trim()) return;
    startTransition(async () => {
      const res = await saveFieldConfigAction(null, { fieldKey: '', label, fieldType, options, required });
      if (!res.error) {
        setRows((prev) => [...prev, { id: Math.random().toString(), fieldKey: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label, fieldType, options: options.split(',').map((o) => o.trim()).filter(Boolean), required, sortOrder: prev.length, isActive: true }]);
        setLabel(''); setOptions(''); setRequired(false);
      }
    });
  };
  const remove = (id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    startTransition(() => { void removeFieldConfigAction(id); });
  };

  return (
    <Modal title="Complaint intake fields" subtitle="Extra fields on this branch's complaint form" icon="sliders" size="sm" onClose={onClose}>
        <div>
          <p className="mb-3 text-xs text-muted-foreground">
            Extra fields shown on this branch&apos;s complaint form, on top of customer, equipment, site and description.
          </p>
          <ul className="mb-4 space-y-1.5">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded border border-border px-2.5 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{r.label} <span className="text-xs text-muted-foreground">({r.fieldType}{r.required ? ', required' : ''})</span></span>
                <button type="button" onClick={() => remove(r.id)} className="text-muted-foreground hover:text-danger" aria-label={`Remove ${r.label}`}>
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {rows.length === 0 && <li className="text-xs text-muted-foreground">No extra fields yet.</li>}
          </ul>
          <div className="grid gap-2 border-t border-border pt-3">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Field label, e.g. AMC contract number" className={fieldClass} />
            <div className="flex gap-2">
              <select value={fieldType} onChange={(e) => setFieldType(e.target.value)} className={fieldClass}>
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="select">Dropdown</option>
                <option value="boolean">Yes / No</option>
              </select>
              <label className="flex shrink-0 items-center gap-1.5 text-xs">
                <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
                Required
              </label>
            </div>
            {fieldType === 'select' && (
              <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Options, comma separated" className={fieldClass} />
            )}
            <button type="button" onClick={add} disabled={pending || !label.trim()} className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg disabled:opacity-50">
              Add field
            </button>
          </div>
        </div>
    </Modal>
  );
}
