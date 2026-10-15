'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Badge, type BadgeTone } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { ActionBar } from '@/components/document/ActionBar';
import { AttachmentPanel } from '@/components/ui/AttachmentPanel';
import type { AttachmentView } from '@/components/ui/Attachments';
import { QuickVisitDialog } from '@/components/services/QuickVisitDialog';
import { docMessage } from '@/lib/wa-message';
import { openWhatsApp } from '@/lib/wa-open';
import { formatCurrency } from '@/lib/format';
import { INSTALL_STAGES, SURVEY_ITEMS, TESTING_ITEMS, nextStage, stageIndex, stageLabel, type MaterialRow } from '@/lib/installation-stages';
import type { InstallationPage } from '@/server/installation-page';
import {
  installChecklistAction, installDecideAction, installHandoverAction, installItemsAction, installMaterialsAction,
  installRemarkAction, installStageAction, installTeamAction, getInstallationShareLink,
} from '../actions';

const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const FIT: Record<string, { label: string; tone: BadgeTone }> = {
  to_fit: { label: 'To fit', tone: 'neutral' }, fitted: { label: 'Fitted', tone: 'info' }, tested: { label: '✓ Tested', tone: 'success' },
};
const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: 'In progress', tone: 'info' }, work_done: { label: 'Waiting for approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' }, rejected: { label: 'Sent back', tone: 'danger' }, legacy_unknown: { label: 'Not recorded', tone: 'neutral' },
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

export function InstallationView({ data: d, files, canEdit }: { data: InstallationPage; files: unknown[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [visit, setVisit] = useState<null | 'installation_survey' | 'new_installation'>(null);
  const [handover, setHandover] = useState(false);
  const [reasonFor, setReasonFor] = useState<null | { title: string; run: (r: string) => Promise<{ error?: string }> }>(null);
  const [tab, setTab] = useState<'remarks' | 'activity' | 'photos'>('remarks');
  const [items, setItems] = useState(d.items);
  const [survey, setSurvey] = useState<Record<string, boolean | string | number>>(d.survey);
  const [testing, setTesting] = useState<Record<string, boolean>>(d.testing);
  const [materials, setMaterials] = useState<MaterialRow[]>(d.materials.length ? d.materials : [{ name: '', unit: 'm', issued: 0, used: 0, extraPaise: 0 }]);
  const [team, setTeam] = useState<string[]>(d.team.map((t) => t.id));
  const [priority, setPriority] = useState(d.priority);
  const [remark, setRemark] = useState('');

  const locked = d.status === 'approved' || !canEdit;
  const run = (fn: () => Promise<{ error?: string; ok?: boolean }>, done?: string) => start(async () => {
    setError(null);
    const r = await fn();
    if (r.error) { setError(r.error); return; }
    if (done) { setToast(done); setTimeout(() => setToast(null), 3500); }
    router.refresh();
  });

  const idx = stageIndex(d.stage);
  const nxt = nextStage(d.stage);
  const tested = items.filter((i) => i.fitStatus === 'tested').length;
  const extra = materials.reduce((n, m) => n + (m.extraPaise || 0), 0);
  const mapHref = d.site.lat !== null && d.site.lng !== null ? `https://www.google.com/maps/search/?api=1&query=${d.site.lat},${d.site.lng}` : d.site.text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.site.text)}` : null;

  // The one thing to do next, as one button.
  const nextAction = (() => {
    if (locked) return null;
    if (d.stage === 'testing' || (d.stage !== 'handover' && d.stage !== 'approved' && nxt === 'handover')) return { label: 'Hand over to customer', icon: 'check-circle' as const, onClick: () => setHandover(true) };
    if (d.stage === 'handover' && d.status === 'work_done') return { label: 'Approve installation', icon: 'check' as const, onClick: () => run(() => installDecideAction(d.id, 'approved', null), 'Approved'), variant: 'success' as const };
    if (nxt && nxt !== 'handover' && nxt !== 'approved') return { label: `Mark ${stageLabel(nxt)}`, icon: 'arrow-right' as const, onClick: () => run(() => installStageAction(d.id, nxt), `Moved to ${stageLabel(nxt)}`) };
    return null;
  })();

  const saveItem = (id: string, patch: Partial<(typeof items)[number]>) => {
    const next = items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    setItems(next);
    run(() => installItemsAction(d.id, [{ id, placement: patch.placement, serialNo: patch.serialNo, fitStatus: patch.fitStatus }]));
  };
  const cycleFit = (s: string) => (s === 'to_fit' ? 'fitted' : s === 'fitted' ? 'tested' : 'to_fit');

  return (
    <div className="space-y-4">
      {/* ---- header ---------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand/10 text-on-tint-brand"><Icon name="home" className="h-5 w-5" /></span>
          <div>
            <h1 className="text-h1 font-bold leading-tight">Installation {d.challanNo}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge tone="brand">{stageLabel(d.stage)}</Badge>
              <Badge tone={STATUS[d.status]?.tone ?? 'neutral'}>{STATUS[d.status]?.label ?? d.status}</Badge>
              {d.customer.name && (d.customer.id ? <Link href={`/customers/${d.customer.id}`} className="hover:text-brand hover:underline">{d.customer.name}</Link> : <span>{d.customer.name}</span>)}
              {d.order && <>· <Link href={`/sales/orders/${d.order.id}`} className="font-mono hover:text-brand hover:underline">{d.order.orderNo}</Link></>}
              {d.team.length > 0 && <>· {d.team.map((t) => t.name).join(', ')}</>}
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
        ]}
        destructive={!locked && d.status === 'work_done' ? { label: 'Send back…', icon: 'rotate-ccw', onClick: () => setReasonFor({ title: 'Send this installation back', run: (r) => installDecideAction(d.id, 'rejected', r) }) } : undefined}
      />
      {error && <p className="rounded-sm bg-danger/10 px-3 py-2 text-sm text-on-tint-danger" role="alert">{error}</p>}
      {d.status === 'rejected' && d.rejectionReason && <p className="rounded-sm bg-danger/10 px-3 py-2 text-sm text-on-tint-danger">Sent back: {d.rejectionReason}</p>}

      {/* ---- site line + stepper ------------------------------------------ */}
      <div className="rounded border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Icon name="map-pin" className="h-4 w-4 text-muted-foreground" />
          <span>{d.site.text || 'No site written'}</span>
          {mapHref && <a href={mapHref} target="_blank" rel="noreferrer" className="text-brand hover:underline">Map</a>}
          {d.customer.phone && <span className="text-muted-foreground">· {d.customer.phone}</span>}
          <Badge>{items.length} item{items.length === 1 ? '' : 's'}</Badge>
          {d.priority !== 'normal' && <Badge tone={d.priority === 'urgent' || d.priority === 'high' ? 'danger' : 'neutral'}>{d.priority}</Badge>}
          <span className="text-muted-foreground">· raised {fmtDay(d.dispatchedAt)}</span>
        </div>
        <div className="mt-4 flex overflow-x-auto thin-scroll">
          {INSTALL_STAGES.map((s, i) => (
            <button key={s.key} type="button" disabled={locked || s.key === 'handover' || s.key === 'approved' || s.key === d.stage}
              onClick={() => (i < idx
                ? setReasonFor({ title: `Back to ${s.label}`, run: (r) => installStageAction(d.id, s.key, r) })
                : run(() => installStageAction(d.id, s.key), `Moved to ${s.label}`))}
              className="group flex min-w-[100px] flex-1 flex-col items-center gap-1.5 px-1 disabled:cursor-default">
              <span className={`h-1.5 w-full rounded-full ${i <= idx ? 'bg-brand' : 'bg-muted'}`} />
              <span className={`text-xs ${i === idx ? 'font-semibold text-brand' : i < idx ? 'text-foreground' : 'text-muted-foreground'}`}>{i < idx ? '✓ ' : ''}{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[260px_1fr_280px]">
        {/* ---- left: actions ---------------------------------------------- */}
        <div className="space-y-4">
          <Panel title="Next">
            <p className="text-sm">{INSTALL_STAGES[idx]?.next}</p>
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
          <Panel title="Visits & material">
            <div className="grid gap-2">
              <Button variant="soft" icon="map-pin" iconTone="brand" disabled={locked} onClick={() => setVisit('installation_survey')}>Book survey visit</Button>
              <Button variant="soft" icon="calendar" iconTone="brand" disabled={locked} onClick={() => setVisit('new_installation')}>Book installation visit</Button>
              <Button variant="soft" icon="truck" onClick={() => router.push('/goods-dispatch')}>Issue material (GDN)</Button>
            </div>
          </Panel>
          <Panel title="Customer">
            <div className="grid gap-2">
              <Button variant="soft" icon="check-circle" iconTone="success" disabled={locked || d.stage === 'handover'} onClick={() => setHandover(true)}>Hand over</Button>
              <Button variant="soft" icon="shield-check" onClick={() => router.push('/services/amc')}>Offer AMC</Button>
            </div>
          </Panel>
        </div>

        {/* ---- middle: the work ------------------------------------------- */}
        <div className="min-w-0 space-y-4">
          <Panel title={`What is being installed (${items.length})`} sub="Where each unit goes, its serial scanned on site, and whether it is tested - click the status to move it on" pad={false}>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-surface"><tr>{['Item', 'Qty', 'Location on site', 'Serial', 'Status'].map((h) => <th key={h} className="px-4 py-2 text-start text-micro font-semibold uppercase text-muted-foreground">{h}</th>)}</tr></thead>
                <tbody>{items.map((it) => (
                  <tr key={it.id} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">{it.productId ? <Link href={`/product-journey?product=${it.productId}`} className="hover:text-brand hover:underline">{it.productName}</Link> : it.productName}</td>
                    <td className="px-4 py-2 font-mono">{it.qty}</td>
                    <td className="px-4 py-2"><input disabled={locked} defaultValue={it.placement ?? ''} placeholder="e.g. Main gate" aria-label={`Location of ${it.productName}`}
                      onBlur={(e) => { if (e.target.value !== (it.placement ?? '')) saveItem(it.id, { placement: e.target.value }); }}
                      className="h-8 w-full rounded-sm border border-transparent bg-transparent px-1.5 hover:border-border focus:border-brand focus:outline-none" /></td>
                    <td className="px-4 py-2"><input disabled={locked} defaultValue={it.serialNo ?? ''} placeholder="Scan / type" aria-label={`Serial of ${it.productName}`}
                      onBlur={(e) => { if (e.target.value !== (it.serialNo ?? '')) saveItem(it.id, { serialNo: e.target.value }); }}
                      className="h-8 w-full rounded-sm border border-transparent bg-transparent px-1.5 font-mono text-xs hover:border-border focus:border-brand focus:outline-none" /></td>
                    <td className="px-4 py-2"><button type="button" disabled={locked} onClick={() => saveItem(it.id, { fitStatus: cycleFit(it.fitStatus) })}><Badge tone={FIT[it.fitStatus]?.tone ?? 'neutral'}>{FIT[it.fitStatus]?.label ?? it.fitStatus}</Badge></button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
              <span>Warranty on each serial starts at handover.</span><span className="font-mono">{tested}/{items.length} tested</span>
            </div>
          </Panel>

          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Site survey" icon="map-pin" sub="Filled on the first visit - before material goes out">
              <div className="space-y-1">
                {SURVEY_ITEMS.map((s) => (
                  <label key={s.key} className="flex cursor-pointer items-center gap-2.5 rounded-sm px-1.5 py-1 text-sm hover:bg-muted">
                    <input type="checkbox" disabled={locked} checked={!!survey[s.key]} onChange={() => setSurvey({ ...survey, [s.key]: !survey[s.key] })} className="h-4 w-4 accent-brand" />
                    <span className={survey[s.key] ? '' : 'text-muted-foreground'}>{s.label}</span>
                  </label>
                ))}
                <label className="flex items-center gap-2 px-1.5 pt-1 text-sm">Cable estimate
                  <input type="number" min={0} disabled={locked} value={Number(survey.cableMetres ?? 0) || ''} onChange={(e) => setSurvey({ ...survey, cableMetres: Number(e.target.value) })} className="h-8 w-20 rounded-sm border border-border bg-card px-2 font-mono text-sm" /> m
                </label>
              </div>
              {!locked && <Button size="sm" variant="tint" icon="check" className="mt-2" onClick={() => run(() => installChecklistAction(d.id, 'survey', survey), 'Survey saved')}>Save survey</Button>}
            </Panel>
            <Panel title="Material & cable used" icon="box" sub="Recorded by the technician - extra beyond the quote is flagged to bill">
              <div className="space-y-1.5">
                {materials.map((m, i) => (
                  <div key={i} className="grid grid-cols-[1fr_52px_52px_70px] items-center gap-1.5">
                    <input disabled={locked} value={m.name} placeholder="Item" aria-label="Material" onChange={(e) => setMaterials(materials.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="h-8 min-w-0 rounded-sm border border-border bg-card px-2 text-xs" />
                    <input disabled={locked} type="number" min={0} value={m.issued || ''} placeholder="Out" aria-label="Issued" onChange={(e) => setMaterials(materials.map((x, j) => (j === i ? { ...x, issued: Number(e.target.value) } : x)))} className="h-8 rounded-sm border border-border bg-card px-1.5 font-mono text-xs" />
                    <input disabled={locked} type="number" min={0} value={m.used || ''} placeholder="Used" aria-label="Used" onChange={(e) => setMaterials(materials.map((x, j) => (j === i ? { ...x, used: Number(e.target.value) } : x)))} className="h-8 rounded-sm border border-border bg-card px-1.5 font-mono text-xs" />
                    <input disabled={locked} type="number" min={0} value={m.extraPaise ? m.extraPaise / 100 : ''} placeholder="₹ extra" aria-label="Extra to bill" onChange={(e) => setMaterials(materials.map((x, j) => (j === i ? { ...x, extraPaise: Math.round(Number(e.target.value) * 100) } : x)))} className="h-8 rounded-sm border border-border bg-card px-1.5 font-mono text-xs" />
                  </div>
                ))}
              </div>
              {!locked && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" icon="plus" onClick={() => setMaterials([...materials, { name: '', unit: '', issued: 0, used: 0, extraPaise: 0 }])}>Add line</Button>
                  <Button size="sm" variant="tint" icon="check" onClick={() => run(() => installMaterialsAction(d.id, materials), 'Material saved')}>Save material</Button>
                </div>
              )}
              {extra > 0 && <p className="mt-2 text-xs"><Badge tone="warning">Extra to bill {formatCurrency(extra)}</Badge></p>}
            </Panel>
          </div>

          <Panel title="Visits" icon="calendar">
            {d.visits.length === 0 ? <p className="text-sm text-muted-foreground">No visits yet - book the survey first.</p> : (
              <div className="space-y-2">
                {d.visits.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-center gap-3 rounded-sm bg-surface px-3 py-2 text-sm">
                    <span className="w-28 font-mono text-xs">{fmt(v.scheduledAt)}</span>
                    <span className="min-w-0 flex-1"><b>{v.reason === 'installation_survey' ? 'Site survey' : 'Installation'}</b> · {v.technician}
                      <span className="block text-xs text-muted-foreground">{v.checkedInAt ? `Checked in ${fmt(v.checkedInAt)}${v.distanceM !== null ? ` · ${v.distanceM} m from the site` : ''}${v.withinRange === false ? ' (outside range)' : ''}` : 'Not checked in yet'}</span>
                    </span>
                    <Badge tone={v.completedAt ? 'success' : v.status === 'cancelled' ? 'neutral' : 'info'}>{v.completedAt ? 'Done' : v.status === 'cancelled' ? 'Cancelled' : 'Booked'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Testing & handover" icon="shield-check" sub="Ticked before the customer signs off - warranty starts at handover">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {TESTING_ITEMS.map((t) => (
                <label key={t.key} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" disabled={locked} checked={!!testing[t.key]} onChange={() => setTesting({ ...testing, [t.key]: !testing[t.key] })} className="h-4 w-4 accent-brand" />{t.label}
                </label>
              ))}
            </div>
            {!locked && <Button size="sm" variant="tint" icon="check" className="mt-3" onClick={() => run(() => installChecklistAction(d.id, 'testing', testing), 'Testing saved')}>Save testing</Button>}
            {d.handover.at && <p className="mt-3 rounded-sm bg-success/10 px-3 py-2 text-sm text-on-tint-success">Handed over to {d.handover.to} on {fmt(d.handover.at)}{d.handover.by ? ` by ${d.handover.by}` : ''}.</p>}
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
                {d.order ? <Row href={`/sales/orders/${d.order.id}`} a={d.order.orderNo} b={formatCurrency(d.order.totalPaise)} /> : <p className="text-xs text-muted-foreground">No sales order.</p>}
              </div>
              {d.otherInstallations.length > 0 && (
                <div>
                  <p className="mb-1 text-micro font-semibold uppercase text-muted-foreground">Same order</p>
                  {d.otherInstallations.map((o) => <Row key={o.id} href={`/services/installations/${o.id}`} a={o.no} b={stageLabel(o.stage)} />)}
                </div>
              )}
              <div>
                <p className="mb-1 text-micro font-semibold uppercase text-muted-foreground">Money</p>
                {d.invoices.map((i) => <Row key={i.id} href={`/invoices/${i.id}`} a={i.no} b={i.paidPaise >= i.totalPaise ? 'Paid' : `${formatCurrency(i.totalPaise - i.paidPaise)} due`} />)}
                {d.receipts.map((r) => <Row key={r.id} href={`/receipts/${r.id}`} a={r.no} b={`${formatCurrency(r.amountPaise)} advance`} />)}
                {!d.invoices.length && !d.receipts.length && <p className="text-xs text-muted-foreground">Not billed yet.</p>}
              </div>
              <div>
                <p className="mb-1 text-micro font-semibold uppercase text-muted-foreground">After care</p>
                <p className="text-xs text-muted-foreground">{d.handover.at ? `Warranty from ${fmtDay(d.handover.at)} on ${items.filter((i) => i.serialNo).length} serial(s).` : 'Warranty starts at handover.'}</p>
              </div>
            </div>
          </Panel>
          <Panel title="Time & money">
            <div className="grid grid-cols-2 gap-2 text-sm">
              {[['On site', d.onSiteMinutes ? `${Math.floor(d.onSiteMinutes / 60)} h ${d.onSiteMinutes % 60} m` : '—'], ['Visits', `${d.visits.filter((v) => v.completedAt).length} of ${d.visits.length}`], ['Order value', d.order ? formatCurrency(d.order.totalPaise) : '—'], ['Extra to bill', extra ? formatCurrency(extra) : '—']].map(([l, v]) => (
                <div key={l} className="rounded-sm bg-surface p-2.5"><p className="text-micro font-semibold uppercase text-muted-foreground">{l}</p><p className="font-mono font-semibold">{v}</p></div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {visit && (
        <QuickVisitDialog subject="installation" subjectId={d.id} defaultReason={visit}
          label={`${d.challanNo}${d.customer.name ? ` · ${d.customer.name}` : ''}`}
          technicians={d.technicians.map((t) => ({ id: t.id, fullName: t.name }))} defaultTechnicianId={team[0] ?? ''}
          onClose={() => setVisit(null)} onDone={() => { setVisit(null); router.refresh(); }} />
      )}
      {handover && <HandoverDialog onClose={() => setHandover(false)} onSave={(to, note) => { setHandover(false); run(() => installHandoverAction(d.id, to, note), 'Handed over - the office approves next'); }} />}
      {reasonFor && <ReasonDialog title={reasonFor.title} onClose={() => setReasonFor(null)} onSave={(r) => { const f = reasonFor; setReasonFor(null); run(() => f.run(r)); }} />}
      {toast && <div role="status" className="fixed bottom-5 start-1/2 z-[60] -translate-x-1/2 rounded bg-foreground px-4 py-3 text-sm text-background shadow-raised rtl:translate-x-1/2">{toast}</div>}
    </div>
  );
}

function Row({ href, a, b }: { href: string; a: string; b: string }) {
  return <div className="flex items-center justify-between gap-2 py-0.5"><Link href={href} className="truncate font-mono text-xs text-brand hover:underline">{a}</Link><span className="shrink-0 text-xs text-muted-foreground">{b}</span></div>;
}

function HandoverDialog({ onClose, onSave }: { onClose: () => void; onSave: (to: string, note: string | null) => void }) {
  const [to, setTo] = useState(''); const [note, setNote] = useState('');
  return (
    <Modal title="Hand over to the customer" subtitle="Who received it - the warranty on every serial starts today" icon="check-circle" size="md" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="success" icon="check" disabled={!to.trim()} onClick={() => onSave(to.trim(), note.trim() || null)}>Hand over</Button></>}>
      <label className="block text-sm">Received by (customer’s name)
        <input value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-10 w-full rounded-sm border border-border bg-card px-3" />
      </label>
      <label className="mt-3 block text-sm">Note (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full rounded-sm border border-border bg-card px-3 py-2" />
      </label>
    </Modal>
  );
}

function ReasonDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (r: string) => void }) {
  const [r, setR] = useState('');
  return (
    <Modal title={title} icon="rotate-ccw" size="sm" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!r.trim()} onClick={() => onSave(r.trim())}>Save</Button></>}>
      <label className="block text-sm">Why?
        <input value={r} onChange={(e) => setR(e.target.value)} className="mt-1 h-10 w-full rounded-sm border border-border bg-card px-3" />
      </label>
    </Modal>
  );
}
