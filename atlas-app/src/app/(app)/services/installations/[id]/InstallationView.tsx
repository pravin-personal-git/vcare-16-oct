'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Badge, type BadgeTone } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { ActionBar } from '@/components/document/ActionBar';
import { AttachmentPanel } from '@/components/ui/AttachmentPanel';
import type { AttachmentView } from '@/components/ui/Attachments';
import { SearchSelect, type SearchOption } from '@/components/ui/SearchSelect';
import { QuickVisitDialog } from '@/components/services/QuickVisitDialog';
import { CustomerPicker } from '@/components/services/CustomerPicker';
import { SitePicker, type SiteChoice } from '@/components/services/SitePicker';
import { ShelfUnits } from '@/components/services/GdnFix';
import { docMessage } from '@/lib/wa-message';
import { openWhatsApp } from '@/lib/wa-open';
import { formatCurrency } from '@/lib/format';
import { INSTALL_STAGES, stageIndex, stageLabel } from '@/lib/installation-stages';
import type { InstallationPage, InstallationBillDraft } from '@/server/installation-page';
import type { FindableProduct } from '@/components/document/ProductFinder';
import { searchGoodsAction } from '@/app/actions/search-options';
import { JobParts, type ChallanVM } from '../../complaints/[id]/JobParts';
import {
  installAddItemAction, installBillAction, installBillDraftAction, installItemQtyAction, installItemsAction,
  installRemarkAction, installRemoveItemAction, installReturnAction, installSendBackAction, installTeamAction,
  installCustomerAction, installSiteAction, installWaiveAction, installWorkDoneAction, getInstallationShareLink, updatePaperworkAction,
} from '../actions';

const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

/** One badge at the top: where the job is (27 Oct 2026 - it used to show two). */
const STAGE_TONE: Record<string, BadgeTone> = {
  raised: 'neutral', technician: 'info', visit: 'info', fitting: 'brand', work_done: 'warning', billed: 'success',
};

function Panel({ title, sub, icon, right, children, pad = true }: { title: string; sub?: string; icon?: IconName; right?: React.ReactNode; children: React.ReactNode; pad?: boolean }) {
  return (
    <section className="rounded border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3.5">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-title font-semibold">{icon && <Icon name={icon} className="h-4 w-4 text-muted-foreground" />}{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        {right}
      </header>
      <div className={pad ? 'px-4 pb-4 pt-3' : 'pt-3'}>{children}</div>
    </section>
  );
}

/**
 * ONE INSTALLATION, worked like a complaint (27 Oct 2026, Vcare redesign).
 * The stages move by themselves; items can be added until billed; material
 * goes out only through the Parts card; Bill this installation closes it.
 */
export function InstallationView({ data: d, files, canEdit, canBill, parts }: {
  data: InstallationPage; files: unknown[]; canEdit: boolean;
  /** invoice.create - Bill this installation and Don't bill. */
  canBill: boolean;
  /** Material challans (R3, 22 Oct 2026). */
  parts?: { challans: ChallanVM[]; catalogue: FindableProduct[]; canIssue: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [visit, setVisit] = useState(false);
  const [workDone, setWorkDone] = useState(false);
  const [billing, setBilling] = useState(false);
  const [changingSite, setChangingSite] = useState(false);
  const [reasonFor, setReasonFor] = useState<null | { title: string; label: string; run: (r: string) => Promise<{ error?: string }> }>(null);
  const [tab, setTab] = useState<'remarks' | 'activity' | 'photos'>('remarks');
  const [team, setTeam] = useState<string[]>(d.team.map((t) => t.id));
  const [priority, setPriority] = useState(d.priority);
  const [remark, setRemark] = useState('');
  const [adding, setAdding] = useState<{ product: SearchOption | null; qty: string; units: { id: string; serialNo: string }[] } | null>(null);
  // A serial product must name its units when added (30 Oct 2026, Vcare).
  const addSerial = !!adding?.product && !!parts?.catalogue.find((p) => p.id === adding.product!.id)?.serial;
  // The line whose unused goods are being sent back, and how many (R2).
  const [returning, setReturning] = useState<{ id: string; n: number } | null>(null);

  const locked = d.closed || !canEdit;
  const run = (fn: () => Promise<{ error?: string; ok?: boolean; message?: string }>, done?: string) => start(async () => {
    setError(null);
    const r = await fn();
    if (r.error) { setError(r.error); return; }
    const say = r.message ?? done;
    if (say) { setToast(say); setTimeout(() => setToast(null), 4000); }
    router.refresh();
  });

  const idx = stageIndex(d.stage);
  const atWorkDone = d.stage === 'work_done';
  const fitted = d.items.filter((i) => i.fitStatus !== 'to_fit').length;
  const mapHref = d.site.lat !== null && d.site.lng !== null ? `https://www.google.com/maps/search/?api=1&query=${d.site.lat},${d.site.lng}` : d.site.text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.site.text)}` : null;

  // The one thing to do next, as one button - the same thing the stage says.
  const nextAction = (() => {
    if (d.closed) return null;
    if (atWorkDone && canBill) return { label: 'Bill this installation', icon: 'file-text' as const, onClick: () => setBilling(true), variant: 'success' as const };
    if (locked) return null;
    if (d.stage === 'raised') return null; // name the technician in Job
    if (d.stage === 'technician') return { label: 'Schedule a visit', icon: 'calendar' as const, onClick: () => setVisit(true) };
    if (d.stage === 'visit' || d.stage === 'fitting') return { label: 'Mark work done', icon: 'check-circle' as const, onClick: () => setWorkDone(true) };
    return null;
  })();

  return (
    <div className="space-y-4">
      {/* ---- header ---------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand/10 text-on-tint-brand"><Icon name="home" className="h-5 w-5" /></span>
          <div>
            <h1 className="text-h1 font-bold leading-tight">Installation {d.challanNo}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge tone={d.status === 'rejected' ? 'danger' : STAGE_TONE[d.stage] ?? 'neutral'}>
                {d.status === 'rejected' && !d.closed ? 'Sent back' : d.stage === 'billed' && !d.isInvoiced ? 'Closed - not billed' : stageLabel(d.stage)}
              </Badge>
              {d.customer.name ? (d.customer.id ? <Link href={`/customers/${d.customer.id}`} className="hover:text-brand hover:underline">{d.customer.name}</Link> : <span>{d.customer.name}</span>) : <span>No customer on the challan</span>}
              {d.customer.phone && <>· <a href={`tel:${d.customer.phone}`} className="hover:text-brand hover:underline">{d.customer.phone}</a></>}
              {d.order ? <>· <Link href={`/sales/orders/${d.order.id}`} className="font-mono hover:text-brand hover:underline">{d.order.orderNo}</Link></> : <>· no sales order</>}
            </div>
          </div>
        </div>
        <Link href="/services/installations" className="text-sm text-brand hover:underline">All installations</Link>
      </div>

      <ActionBar
        next={nextAction ?? undefined}
        // The installation's own customer link (/c) and one wording (A1/A2,
        // 11 Oct 2026). No prices - Pravin, W2.
        whatsapp={d.customer.phone ? {
          label: 'Update customer', onClick: async () => {
            setError(null);
            const err = await openWhatsApp(d.customer.phone, async () => {
              const r = await getInstallationShareLink(d.id);
              if (r.error || !r.url) return { error: r.error ?? 'Could not create a link.' };
              return docMessage({ kind: 'installation', number: d.challanNo, customerName: d.customer.name, status: stageLabel(d.stage), url: r.url });
            });
            if (err) setError(err);
          },
        } : undefined}
        sendMenu={[{
          label: 'Copy customer link', icon: 'copy', onClick: async () => {
            setError(null);
            const r = await getInstallationShareLink(d.id);
            if (r.error || !r.url) return setError(r.error ?? 'Could not create a link.');
            const copied = await navigator.clipboard.writeText(r.url).then(() => true, () => false);
            setToast(copied ? 'Customer link copied.' : r.url);
          },
        }]}
        actions={[
          ...(d.customer.phone ? [{ label: 'Call customer', icon: 'phone' as const, iconTone: 'brand' as const, onClick: () => window.open(`tel:${d.customer.phone}`) }] : []),
          { label: 'Print', icon: 'printer' as const, onClick: () => window.print() },
        ]}
        more={[
          ...(d.order ? [{ label: 'Open the sales order', icon: 'file-text' as const, onClick: () => router.push(`/sales/orders/${d.order!.id}`) }] : []),
          ...(d.customer.id ? [{ label: 'Open the customer', icon: 'user' as const, onClick: () => router.push(`/customers/${d.customer.id}`) }] : []),
          ...(!locked ? [{ label: d.physicalChallanNo ? `Paper slip ${d.physicalChallanNo}…` : 'Paper slip number…', icon: 'file-text' as const, onClick: () => setReasonFor({ title: 'Paper slip number', label: 'The number on the paper slip the customer signed', run: (r) => updatePaperworkAction({ id: d.id, physicalChallanNo: r, technicianRemark: d.technicianRemark, note: d.note }) }) }] : []),
        ]}
        destructive={!locked && atWorkDone ? { label: 'Send back…', icon: 'rotate-ccw', onClick: () => setReasonFor({ title: 'Send this installation back', label: 'What does the technician have to fix?', run: (r) => installSendBackAction(d.id, r) }) } : undefined}
      />
      {error && <p className="rounded-sm bg-danger/10 px-3 py-2 text-sm text-on-tint-danger" role="alert">{error}</p>}
      {d.status === 'rejected' && d.rejectionReason && !d.closed && <p className="rounded-sm bg-danger/10 px-3 py-2 text-sm text-on-tint-danger">Sent back: {d.rejectionReason}</p>}
      {d.notBilledReason && <p className="rounded-sm bg-muted px-3 py-2 text-sm">Closed without a bill: {d.notBilledReason}</p>}

      {/* ---- site line + stages (they move by themselves) ------------------ */}
      <div className="rounded border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Icon name="map-pin" className="h-4 w-4 text-muted-foreground" />
          <span>{d.site.text || 'No site written'}</span>
          {!locked && d.customer.id && <button type="button" className="text-brand hover:underline" onClick={() => setChangingSite(true)}>Change site</button>}
          {mapHref && <a href={mapHref} target="_blank" rel="noreferrer" className="text-brand hover:underline">Map</a>}
          <Badge>{d.items.length} item{d.items.length === 1 ? '' : 's'}</Badge>
          {d.priority !== 'normal' && <Badge tone={d.priority === 'urgent' || d.priority === 'high' ? 'danger' : 'neutral'}>{d.priority}</Badge>}
          <span className="text-muted-foreground">· raised {fmtDay(d.dispatchedAt)}</span>
        </div>
        <ol className="mt-4 flex overflow-x-auto thin-scroll" aria-label="Stages">
          {INSTALL_STAGES.map((s, i) => (
            <li key={s.key} aria-current={i === idx ? 'step' : undefined} className="flex min-w-[90px] flex-1 flex-col items-center gap-1.5 px-1">
              <span className={`h-1.5 w-full rounded-full ${i <= idx ? 'bg-brand' : 'bg-muted'}`} />
              <span className={`text-xs ${i === idx ? 'font-semibold text-brand' : i < idx ? 'text-foreground' : 'text-muted-foreground'}`}>{i < idx ? '✓ ' : ''}{s.label}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-4 xl:grid-cols-[260px_1fr_280px]">
        {/* ---- left: actions ---------------------------------------------- */}
        <div className="space-y-4">
          <Panel title="Next">
            <p className="text-sm">{d.status === 'rejected' && !d.closed ? 'Fix what was sent back, then mark the work done again.' : d.stage === 'billed' && !d.isInvoiced ? 'Closed without a bill.' : INSTALL_STAGES[idx]?.next}</p>
            {nextAction && <Button variant={nextAction.variant ?? 'primary'} icon={nextAction.icon} className="mt-3 w-full" loading={pending} onClick={nextAction.onClick}>{nextAction.label}</Button>}
          </Panel>
          <Panel title="Job">
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-micro font-semibold uppercase text-muted-foreground">Technicians</p>
                <div className="mt-1 max-h-40 space-y-1 overflow-y-auto thin-scroll">
                  {d.technicians.map((t) => (
                    <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-muted">
                      <input type="checkbox" disabled={locked} checked={team.includes(t.id)} onChange={() => setTeam((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))} className="h-4 w-4 accent-brand" />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="text-micro font-semibold uppercase text-muted-foreground">Priority</span>
                <select disabled={locked} value={priority} onChange={(e) => setPriority(e.target.value)} className="mt-1 h-9 w-full rounded-sm border border-border bg-card px-2 text-sm">
                  {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              {!locked && <Button size="sm" variant="tint" icon="check" onClick={() => run(() => installTeamAction(d.id, team, priority), 'Saved')}>Save</Button>}
            </div>
          </Panel>
          <Panel title="Visits & parts">
            <div className="grid gap-2">
              <Button variant="soft" icon="calendar" iconTone="brand" disabled={locked} onClick={() => setVisit(true)}>Schedule a visit</Button>
              {!locked && !atWorkDone && <Button variant="soft" icon="check-circle" iconTone="success" onClick={() => setWorkDone(true)}>Mark work done</Button>}
              <p className="text-micro text-muted-foreground">Material goes out on a parts challan - raise it in the Parts card.</p>
            </div>
          </Panel>
          <Panel title="Customer & bill">
            <div className="grid gap-2">
              {/* Older challans raised with no order have no customer - the bill needs one. */}
              {!d.customer.id && !locked && (
                <div className="grid gap-1">
                  <p className="text-micro font-semibold uppercase text-muted-foreground">Customer</p>
                  <CustomerPicker id="set-customer" value={null} onChange={(c) => { if (c) run(() => installCustomerAction(d.id, c.id), 'Customer set'); }} />
                </div>
              )}
              {!d.closed && canBill && <Button variant={atWorkDone ? 'success' : 'soft'} icon="file-text" disabled={!atWorkDone} onClick={() => setBilling(true)}>Bill this installation</Button>}
              {!d.closed && canBill && <Button variant="soft" icon="x" onClick={() => setReasonFor({ title: 'Don’t bill this installation', label: 'Why is it not being billed?', run: (r) => installWaiveAction(d.id, r) })}>Don&rsquo;t bill</Button>}
              {!d.closed && !atWorkDone && <p className="text-micro text-muted-foreground">The bill is raised once the work is done.</p>}
              <Button variant="soft" icon="shield-check" onClick={() => router.push('/services/amc')}>Offer AMC</Button>
            </div>
          </Panel>
        </div>

        {/* ---- middle: the work ------------------------------------------- */}
        <div className="min-w-0 space-y-4">
          <Panel title={`What is being installed (${d.items.length})`}
            sub={locked ? 'Serial and location are filled on the phone.' : 'Add, change or remove lines until it is billed. Serial and location are filled on the phone.'}
            right={!locked && !adding ? <Button size="sm" variant="tint" icon="plus" onClick={() => setAdding({ product: null, qty: '1', units: [] })}>Add item</Button> : undefined}
            pad={false}>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-surface"><tr>{['Item', 'Qty', 'Location on site', 'Serial', 'Fitted', 'Unused back', ''].map((h, i) => <th key={i} className="px-3 py-2 text-start text-micro font-semibold uppercase text-muted-foreground">{h}</th>)}</tr></thead>
                <tbody>{d.items.map((it) => (
                  <tr key={it.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{it.productId ? <Link href={`/product-journey?product=${it.productId}`} className="hover:text-brand hover:underline">{it.productName}</Link> : it.productName}</td>
                    <td className="px-3 py-2">
                      {locked ? <span className="font-mono">{it.qty}</span> : (
                        <input type="number" min={Math.max(1, it.qtyReturned + it.qtyReturnPending)} defaultValue={it.qty} aria-label={`Quantity of ${it.productName}`}
                          onBlur={(e) => { const n = Number(e.target.value); if (n && n !== it.qty) run(() => installItemQtyAction(d.id, it.id, n), 'Quantity changed'); }}
                          className="h-8 w-16 rounded-sm border border-border bg-card px-1.5 font-mono text-sm" />
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{it.placement || <span className="text-muted-foreground">-</span>}</td>
                    <td className="px-3 py-2 font-mono text-xs">{it.serialNo || <span className="text-muted-foreground">-</span>}</td>
                    <td className="px-3 py-2">
                      <label className="inline-flex cursor-pointer items-center gap-1.5">
                        <input type="checkbox" disabled={locked} checked={it.fitStatus !== 'to_fit'} aria-label={`${it.productName} fitted`}
                          onChange={(e) => run(() => installItemsAction(d.id, [{ id: it.id, fitStatus: e.target.checked ? 'fitted' : 'to_fit' }]))} className="h-4 w-4 accent-brand" />
                      </label>
                    </td>
                    {/* Unused, back against the order's GDN (R2): the store receives them at the Parts counter. */}
                    <td className="px-3 py-2 text-xs">
                      {it.qtyReturned > 0 && <span className="block tabular-nums">{it.qtyReturned} back · <strong>{it.qty - it.qtyReturned} stay</strong></span>}
                      {it.qtyReturnPending > 0 && <span className="block text-warning">{it.qtyReturnPending} coming back - the store receives them</span>}
                      {!locked && d.dispatched && d.invoices.length === 0 && it.productId && it.qty - it.qtyReturned - it.qtyReturnPending > 0 && (returning?.id === it.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <input aria-label={`How many of ${it.productName} are unused`} type="number" min={1} max={it.qty - it.qtyReturned - it.qtyReturnPending} value={returning.n}
                            onChange={(e) => setReturning({ id: it.id, n: Number(e.target.value) })} className="h-7 w-14 rounded border border-border bg-card px-1.5 text-xs" />
                          <Button size="sm" loading={pending} onClick={() => { const n = returning.n; setReturning(null); run(() => installReturnAction(d.id, it.id, n), 'Noted - the store receives them at the Parts counter'); }}>Send back</Button>
                          <button type="button" className="text-muted-foreground" onClick={() => setReturning(null)}>Cancel</button>
                        </span>
                      ) : (
                        <button type="button" className="font-medium text-brand hover:underline" onClick={() => setReturning({ id: it.id, n: 1 })}>Unused - send back</button>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-end">
                      {!locked && d.items.length > 1 && !it.qtyReturned && !it.qtyReturnPending && !it.stockUnitId && (
                        <button type="button" aria-label={`Remove ${it.productName}`} title="Remove this line"
                          onClick={() => setReasonFor({ title: `Remove ${it.productName}`, label: 'Why is it coming off?', run: (r) => installRemoveItemAction(d.id, it.id, r) })}
                          className="text-muted-foreground hover:text-danger"><Icon name="trash" className="h-3.5 w-3.5" /></button>
                      )}
                    </td>
                  </tr>
                ))}
                {adding && (
                  <tr className="border-t border-border bg-surface/50">
                    <td className="px-3 py-2" colSpan={2}>
                      <div className="flex items-center gap-2">
                        <div className="min-w-[220px] flex-1"><SearchSelect id="add-item" label="Product" value={adding.product} onChange={(o) => setAdding({ ...adding, product: o, units: [] })} search={searchGoodsAction} placeholder="Product name or code…" /></div>
                        <input type="number" min={1} value={adding.qty} onChange={(e) => setAdding({ ...adding, qty: e.target.value, units: adding.units.slice(0, Math.max(0, Number(e.target.value) || 0)) })} aria-label="Quantity" className="h-9 w-16 rounded-sm border border-border bg-card px-1.5 font-mono text-sm" />
                      </div>
                      {addSerial && (
                        <div className="mt-2 grid gap-1 text-sm">
                          <span>Serial numbers <span className="text-danger">*</span> <span className="text-xs text-muted-foreground">- pick {Number(adding.qty) || 0}</span></span>
                          <ShelfUnits productId={adding.product!.id} need={Number(adding.qty) || 0} value={adding.units} onChange={(units) => setAdding({ ...adding, units })} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2" colSpan={5}>
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" icon="check" loading={pending} disabled={!adding.product || !(Number(adding.qty) > 0) || (addSerial && adding.units.length !== Number(adding.qty))}
                          onClick={() => { const a = adding; setAdding(null); run(() => installAddItemAction(d.id, a.product!.id, Number(a.qty), a.units.map((u) => u.id)), 'Item added'); }}>Add</Button>
                        <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>Cancel</Button>
                      </div>
                    </td>
                  </tr>
                )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
              <span>Warranty on each serial starts when the work is done.</span><span className="font-mono">{fitted}/{d.items.length} fitted</span>
            </div>
          </Panel>

          {parts && (
            <JobParts installationChallanId={d.id} challans={parts.challans} faulty={[]} catalogue={parts.catalogue}
              canEdit={!locked} canIssue={parts.canIssue} fmt={fmt} />
          )}

          <Panel title="Visits" icon="calendar">
            {d.visits.length === 0 ? <p className="text-sm text-muted-foreground">No visit booked yet.</p> : (
              <div className="space-y-2">
                {d.visits.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center gap-3 rounded-sm bg-surface px-3 py-2 text-sm">
                    <span className="w-28 font-mono text-xs">{fmt(v.scheduledAt)}</span>
                    <span className="min-w-0 flex-1"><b>{v.reason === 'installation_survey' ? 'Site survey' : 'Installation'}</b> · {v.technician}
                      <span className="block text-xs text-muted-foreground">{v.purpose !== 'field_visit' ? 'A looking trip - no check-in' : v.checkedInAt ? `Checked in ${fmt(v.checkedInAt)}${v.distanceM !== null ? ` · ${v.distanceM} m from the site` : ''}${v.withinRange === false ? ' (outside range)' : ''}` : 'Not checked in yet'}</span>
                    </span>
                    <Badge tone={v.completedAt ? 'success' : v.status === 'cancelled' ? 'neutral' : 'info'}>{v.completedAt ? 'Done' : v.status === 'cancelled' ? 'Cancelled' : 'Booked'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <div className="rounded border border-border bg-card">
            <div className="flex gap-1 border-b border-border px-2 text-sm">
              {([['remarks', `Remarks (${d.activity.filter((a) => a.kind === 'Remark').length})`], ['activity', `Activity log (${d.activity.length})`], ['photos', `Photos & files (${files.length})`]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setTab(k)} className={`border-b-2 px-3 py-2.5 ${tab === k ? 'border-brand font-semibold text-brand' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{l}</button>
              ))}
            </div>
            <div className="p-4">
              {tab === 'remarks' && (
                <div className="space-y-3">
                  {canEdit && (
                    <div className="flex gap-2">
                      <input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Write a remark" aria-label="Remark" className="h-10 min-w-0 flex-1 rounded-sm border border-border bg-card px-3 text-sm" />
                      <Button variant="primary" disabled={!remark.trim()} onClick={() => run(async () => { const r = await installRemarkAction(d.id, remark); if (!r.error) setRemark(''); return r; })}>Add</Button>
                    </div>
                  )}
                  {d.activity.filter((a) => a.kind === 'Remark').map((a) => <div key={a.id} className="rounded-sm bg-surface px-3 py-2 text-sm">{a.text}<div className="text-xs text-muted-foreground">{a.who ?? 'Atlas'} · {fmt(a.at)}</div></div>)}
                  {!d.activity.some((a) => a.kind === 'Remark') && <p className="text-sm text-muted-foreground">No remarks yet.</p>}
                </div>
              )}
              {tab === 'activity' && (
                <div className="space-y-2 border-s-2 border-border ps-4">
                  {d.activity.length === 0 ? <p className="text-sm text-muted-foreground">Nothing recorded yet.</p> : d.activity.map((a) => (
                    <div key={a.id} className="relative text-sm"><span className="absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand" />{a.text}<div className="text-xs text-muted-foreground">{a.who ?? 'Atlas'} · {fmt(a.at)}</div></div>
                  ))}
                </div>
              )}
              {tab === 'photos' && <AttachmentPanel docType="installation_challan" docId={d.id} initial={files as AttachmentView[]} readOnly={!canEdit} phone={d.customer.phone} docLabel={`Installation ${d.challanNo}`} />}
            </div>
          </div>
        </div>

        {/* ---- right: linked documents ------------------------------------ */}
        <div className="space-y-4">
          <Panel title="Linked documents" icon="paperclip">
            <div className="space-y-3 text-sm">
              <div>
                <p className="mb-1 text-micro font-semibold uppercase text-muted-foreground">Sale</p>
                {d.order?.quotation && <Row href={`/quotation/${d.order.quotation.id}`} a={d.order.quotation.no} b="Quotation" />}
                {d.order ? <Row href={`/sales/orders/${d.order.id}`} a={d.order.orderNo} b={formatCurrency(d.order.totalPaise)} /> : <p className="text-xs text-muted-foreground">No sales order - priced from the product list.</p>}
              </div>
              {d.otherInstallations.length > 0 && (
                <div>
                  <p className="mb-1 text-micro font-semibold uppercase text-muted-foreground">Same order</p>
                  {d.otherInstallations.map((o) => <Row key={o.id} href={`/services/installations/${o.id}`} a={o.no} b={stageLabel(o.stage)} />)}
                </div>
              )}
              <div>
                <p className="mb-1 text-micro font-semibold uppercase text-muted-foreground">Material</p>
                {parts?.challans.length ? parts.challans.map((c) => <p key={c.id} className="text-xs"><span className="font-mono">{c.challanNo}</span> · {c.gdnNos.length ? <>GDN <span className="font-mono">{c.gdnNos.join(', ')}</span></> : c.status.replace(/_/g, ' ')}</p>) : <p className="text-xs text-muted-foreground">No parts challan yet.</p>}
              </div>
              <div>
                <p className="mb-1 text-micro font-semibold uppercase text-muted-foreground">Money</p>
                {d.invoices.map((i) => <Row key={i.id} href={`/invoices/${i.id}`} a={i.no} b={i.lifecycle === 'draft' ? 'Draft' : i.paidPaise >= i.totalPaise ? 'Paid' : `${formatCurrency(i.totalPaise - i.paidPaise)} due`} />)}
                {d.receipts.map((r) => <Row key={r.id} href={`/receipts/${r.id}`} a={r.no} b={`${formatCurrency(r.amountPaise)} advance`} />)}
                {!d.invoices.length && !d.receipts.length && <p className="text-xs text-muted-foreground">{d.notBilledReason ? 'Not billed.' : 'Not billed yet.'}</p>}
              </div>
              <div>
                <p className="mb-1 text-micro font-semibold uppercase text-muted-foreground">After care</p>
                <p className="text-xs text-muted-foreground">{d.handover.at ? `Warranty from ${fmtDay(d.handover.at)} on ${d.items.filter((i) => i.serialNo).length} serial(s)${d.handover.to ? ` - received by ${d.handover.to}` : ''}.` : 'Warranty starts when the work is done.'}</p>
              </div>
            </div>
          </Panel>
          <Panel title="Time & money">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[['On site', d.onSiteMinutes ? `${Math.floor(d.onSiteMinutes / 60)} h ${d.onSiteMinutes % 60} m` : '—'], ['Visits', `${d.visits.filter((v) => v.completedAt).length} of ${d.visits.length}`], ['Order value', d.order ? formatCurrency(d.order.totalPaise) : '—'], ['Billed', d.invoices.length ? formatCurrency(d.invoices.reduce((n, i) => n + i.totalPaise, 0)) : '—']].map(([l, v]) => (
                <div key={l} className="rounded-sm bg-surface p-2.5"><p className="text-micro font-semibold uppercase text-muted-foreground">{l}</p><p className="font-mono font-semibold">{v}</p></div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {visit && (
        <QuickVisitDialog subject="installation" subjectId={d.id} defaultReason="new_installation"
          label={`${d.challanNo}${d.customer.name ? ` · ${d.customer.name}` : ''}`}
          technicians={d.technicians.map((t) => ({ id: t.id, fullName: t.name }))} defaultTechnicianId={team[0] ?? ''}
          onClose={() => setVisit(false)} onDone={() => { setVisit(false); router.refresh(); }} />
      )}
      {workDone && <WorkDoneDialog onClose={() => setWorkDone(false)} onSave={(to) => { setWorkDone(false); run(() => installWorkDoneAction(d.id, to), 'Work done - bill it next'); }} />}
      {billing && <BillDialog id={d.id} hasOrder={!!d.order} onClose={() => setBilling(false)} onDone={(msg) => { setBilling(false); setToast(msg); setTimeout(() => setToast(null), 5000); router.refresh(); }} />}
      {changingSite && d.customer.id && (
        <SiteDialog customerId={d.customer.id} current={d.site} onClose={() => setChangingSite(false)}
          onSave={(v) => { setChangingSite(false); run(() => installSiteAction(d.id, v), 'Site changed'); }} />
      )}
      {reasonFor && <ReasonDialog title={reasonFor.title} label={reasonFor.label} onClose={() => setReasonFor(null)} onSave={(r) => { const f = reasonFor; setReasonFor(null); run(() => f.run(r)); }} />}
      {toast && <div role="status" className="fixed bottom-5 start-1/2 z-[60] -translate-x-1/2 rounded bg-foreground px-4 py-3 text-sm text-background shadow-raised rtl:translate-x-1/2">{toast}</div>}
    </div>
  );
}

function Row({ href, a, b }: { href: string; a: string; b: string }) {
  return <div className="flex items-center justify-between gap-2 py-0.5"><Link href={href} className="truncate font-mono text-xs text-brand hover:underline">{a}</Link><span className="shrink-0 text-xs text-muted-foreground">{b}</span></div>;
}

function WorkDoneDialog({ onClose, onSave }: { onClose: () => void; onSave: (to: string | null) => void }) {
  const [to, setTo] = useState('');
  return (
    <Modal title="Mark the work done" subtitle="Every unit still to fit is marked fitted, and the warranty on each serial starts today" icon="check-circle" size="md" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="success" icon="check" onClick={() => onSave(to.trim() || null)}>Work done</Button></>}>
      <label className="block text-sm">Received by (optional)
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="The customer's name" className="mt-1 h-10 w-full rounded-sm border border-border bg-card px-3" />
      </label>
      <p className="mt-2 text-xs text-muted-foreground">Usually the technician taps Work done on the phone - this is for when they could not.</p>
    </Modal>
  );
}

/**
 * Bill this installation (27 Oct 2026) - like Bill this job on a complaint.
 * Fitted goods less unused returned, at the order's price or the product
 * list's; material used on its parts challans; labour typed here. A draft
 * invoice comes out, issued from Invoices as any other.
 */
function BillDialog({ id, hasOrder, onClose, onDone }: { id: string; hasOrder: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [draft, setDraft] = useState<InstallationBillDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [material, setMaterial] = useState(true);
  const [labour, setLabour] = useState('');
  const [labourText, setLabourText] = useState('Installation labour');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void installBillDraftAction(id).then((r) => (r.error ? setError(r.error) : setDraft(r.draft ?? null)));
  }, [id]);

  const withGst = (l: { qty: number; unitPaise: number; taxRatePct: number }) => Math.round(l.qty * l.unitPaise * (1 + l.taxRatePct / 100));
  const labourPaise = Math.round((Number(labour) || 0) * 100);
  const total = draft
    ? draft.goods.reduce((n, l) => n + withGst(l), 0) + (material ? draft.material.reduce((n, l) => n + withGst(l), 0) : 0) + Math.round(labourPaise * 1.18)
    : 0;

  const save = async () => {
    setBusy(true); setError(null);
    const r = await installBillAction(id, { includeMaterial: material, labourRupees: Number(labour) || 0, labourText: labourText.trim() || null });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    onDone(r.message ?? 'Billed.');
  };

  return (
    <Modal title="Bill this installation" subtitle={hasOrder ? 'Fitted goods at the order’s price, less what came back unused' : 'No sales order - priced from the product list; change the draft before issuing if needed'} icon="file-text" size="lg" onClose={onClose}
      footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="success" icon="check" loading={busy} disabled={!draft} onClick={save}>Raise draft invoice</Button></>}>
      {error && <p className="mb-3 rounded-sm bg-danger/10 px-3 py-2 text-sm text-on-tint-danger" role="alert">{error}</p>}
      {!draft && !error && <p className="text-sm text-muted-foreground">Working out the bill…</p>}
      {draft && (
        <div className="space-y-4 text-sm">
          <BillTable title="Goods fitted" lines={draft.goods} />
          {draft.material.length > 0 && (
            <div>
              <label className="mb-1 flex items-center gap-2 font-medium"><input type="checkbox" checked={material} onChange={(e) => setMaterial(e.target.checked)} className="h-4 w-4 accent-brand" />Bill the material used (cable, saddles...)</label>
              {material && <BillTable lines={draft.material} />}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
            <label className="block">Labour line<input value={labourText} onChange={(e) => setLabourText(e.target.value)} className="mt-1 h-9 w-full rounded-sm border border-border bg-card px-2" /></label>
            <label className="block">Amount ₹ (before GST)<input type="number" min={0} value={labour} onChange={(e) => setLabour(e.target.value)} placeholder="0" className="mt-1 h-9 w-full rounded-sm border border-border bg-card px-2 font-mono" /></label>
          </div>
          {draft.warnings.map((w, i) => <p key={i} className="rounded-sm bg-warning/10 px-3 py-2 text-xs text-on-tint-warning">{w}</p>)}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-muted-foreground">{draft.advancePaise > 0 ? `${formatCurrency(draft.advancePaise)} advance taken on site is applied` : 'About, with GST'}</span>
            <span className="font-mono text-base font-semibold">{formatCurrency(total)}</span>
          </div>
        </div>
      )}
    </Modal>
  );
}

function BillTable({ title, lines }: { title?: string; lines: { description: string; qty: number; unitPaise: number; taxRatePct: number; fromCatalogue: boolean }[] }) {
  return (
    <div>
      {title && <p className="mb-1 font-medium">{title}</p>}
      {lines.length === 0 ? <p className="text-xs text-muted-foreground">Nothing.</p> : (
        <table className="w-full text-xs">
          <tbody>{lines.map((l, i) => (
            <tr key={i} className="border-t border-border">
              <td className="py-1.5">{l.description}{l.fromCatalogue && <span className="ms-1 text-muted-foreground">(product list price)</span>}</td>
              <td className="py-1.5 text-end font-mono">{l.qty} × {formatCurrency(l.unitPaise)}</td>
              <td className="py-1.5 text-end font-mono text-muted-foreground">{l.taxRatePct}% GST</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function ReasonDialog({ title, label, onClose, onSave }: { title: string; label: string; onClose: () => void; onSave: (r: string) => void }) {
  const [r, setR] = useState('');
  return (
    <Modal title={title} icon="rotate-ccw" size="sm" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!r.trim()} onClick={() => onSave(r.trim())}>Save</Button></>}>
      <label className="block text-sm">{label}
        <input value={r} onChange={(e) => setR(e.target.value)} autoFocus className="mt-1 h-10 w-full rounded-sm border border-border bg-card px-3" />
      </label>
    </Modal>
  );
}

/** Where it is fitted - one of the customer's sites, or another place (30 Oct 2026). */
function SiteDialog({ customerId, current, onClose, onSave }: {
  customerId: string; current: InstallationPage['site']; onClose: () => void; onSave: (v: { siteId: string | null; otherPlace: boolean; text: string | null }) => void;
}) {
  const [site, setSite] = useState<SiteChoice>(current.id ? { siteId: current.id, otherPlace: false, text: '' } : { siteId: null, otherPlace: true, text: current.text ?? '' });
  const ok = !!site.siteId || (site.otherPlace && !!site.text.trim());
  return (
    <Modal title="Change site" subtitle="The technician's phone and the map follow this" icon="map-pin" size="sm" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={() => onSave({ siteId: site.siteId, otherPlace: site.otherPlace, text: site.text.trim() || null })}>Save</Button></>}>
      <SitePicker id="change-site" customerId={customerId} value={site} onChange={setSite} />
    </Modal>
  );
}
