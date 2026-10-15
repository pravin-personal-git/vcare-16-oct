'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { DialogFrame } from '@/components/ui/DialogFrame';
import { PERIODS, addDays, dm, paramsQuery, type Bucket, type CompareMode, type DashParams, type PeriodKey } from '@/lib/dash/period';
import type { DashAction, Drill } from '@/lib/dash/types';
import type { BusinessData } from '@/server/dash/business';
import type { AccountsData } from '@/server/dash/accounts';
import type { ServiceData } from '@/server/dash/service';
import type { SalesData } from '@/server/dash/sales';
import type { StockData } from '@/server/dash/stock';
import type { PeopleData } from '@/server/dash/people';
import type { MyData } from '@/server/dash/my';
import { decideAction } from '@/app/actions/inbox';
import { makeReorderPoAction, markQuotationLostAction } from './actions';
import { Btn, DIcon, Drawer, SegCtl, Shortcuts, UICtx, type DashUI, type Shortcut } from './kit';
import { DASHES, type DashKey } from './dashes';
import { BusinessDash } from './BusinessDash';
import { AccountsDash } from './AccountsDash';
import { ServiceDash } from './ServiceDash';
import { SalesDash } from './SalesDash';
import { StockDash } from './StockDash';
import { PeopleDash } from './PeopleDash';
import { MyDash } from './MyDash';

export type TabData =
  | { tab: 'business'; data: BusinessData }
  | { tab: 'accounts'; data: AccountsData }
  | { tab: 'service'; data: ServiceData }
  | { tab: 'sales'; data: SalesData }
  | { tab: 'stock'; data: StockData }
  | { tab: 'people'; data: PeopleData }
  | { tab: 'my'; data: MyData };

export function DashboardShell({
  userId, tabs, params, rangeLabel, compareLabel, gran, buckets, today, branches, singleName, counts, payload,
}: {
  userId: string;
  tabs: DashKey[];
  params: DashParams;
  rangeLabel: string;
  compareLabel: string | null;
  gran: 'hour' | 'day' | 'week' | 'month';
  buckets: Bucket[];
  today: string;
  branches: { id: string; name: string }[];
  /** The branch picked in the top bar, when the view is one branch. */
  singleName: string | null;
  counts: Partial<Record<string, number>>;
  payload: TabData;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const tab = payload.tab;
  const [drawer, setDrawer] = useState<Drill | null>(null);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState({ from: params.from ?? `${today.slice(0, 8)}01`, to: params.to ?? today });
  const [crumbs, setCrumbs] = useState<{ q: DashParams; label: string }[]>([]);
  const [ask, setAsk] = useState<{ title: string; label: string; resolve: (v: string | null) => void } | null>(null);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [, tick] = useState(0);
  const tRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const storeKey = `atlas:dash-hidden:${userId}`;
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => { try { setHidden(new Set(JSON.parse(localStorage.getItem(storeKey) || '[]'))); } catch { /* storage off */ } }, [storeKey]);
  useEffect(() => { setLoadedAt(Date.now()); }, [payload]);
  useEffect(() => { const h = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(h); }, []);

  const toast = useCallback((m: string) => { clearTimeout(tRef.current); setToast(m); tRef.current = setTimeout(() => setToast(null), 5200); }, []);
  const navigate = useCallback((p: DashParams & { tab?: string }) => {
    start(() => router.push(`/dashboard${paramsQuery({ tab, ...p })}`, { scroll: false }));
  }, [router, tab]);
  const go = useCallback((href: string) => {
    if (/^(tel:|mailto:|https?:)/.test(href)) { window.open(href, href.startsWith('http') ? '_blank' : '_self'); return; }
    setDrawer(null); router.push(href);
  }, [router]);
  const askReason = (title: string, label: string) => new Promise<string | null>((resolve) => setAsk({ title, label, resolve }));

  const act = useCallback(async (a: DashAction) => {
    if (a.href) { go(a.href); return; }
    if (a.toast) { toast(a.toast); return; }
    if (a.act === 'make-po') {
      const r = await makeReorderPoAction((a.payload as string[]) ?? []);
      if ('error' in r) toast(r.error); else { toast(r.message); setDrawer(null); router.push('/purchase/orders'); }
    }
  }, [go, router, toast]);

  const choosePeriod = (p: string) => { setCrumbs([]); navigate({ ...params, period: p as PeriodKey, from: null, to: null }); };
  const zoom = (i: number) => {
    const b = buckets[i]; if (!b) return;
    if (b.hour !== undefined) { toast(`Showing the whole of ${dm(b.from)} - documents are not split by the hour in the lists.`); return; }
    setCrumbs((c) => [...c, { q: params, label: rangeLabel }]);
    navigate({ ...params, period: 'custom', from: b.from, to: b.to });
  };
  const back = () => { const c = crumbs[crumbs.length - 1]; setCrumbs(crumbs.slice(0, -1)); navigate(c.q); };
  const toggleHide = (id: string) => setHidden((h) => {
    const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id);
    try { localStorage.setItem(storeKey, JSON.stringify([...n])); } catch { /* storage off */ }
    return n;
  });

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable || e.metaKey || e.ctrlKey || e.altKey || drawer || ask) return;
      const p = PERIODS.find((x) => x.key === e.key.toUpperCase()); if (p) { choosePeriod(p.k); return; }
      const n = parseInt(e.key, 10); if (n >= 1 && n <= tabs.length) { navigate({ ...params, tab: tabs[n - 1] }); return; }
      if (e.key === '?') setShowKeys((s) => !s);
      if (e.key === 'c' || e.key === 'C') navigate({ ...params, compare: params.compare === 'none' ? 'prev' : params.compare === 'prev' ? 'ly' : 'none' });
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });

  const ui: DashUI = {
    hidden, editing, toggleHide, go, toast, drill: setDrawer, act, zoom, gran,
    labels: buckets.map((b) => b.label),
    setBranch: (id) => navigate({ ...params, branch: id }),
    goTab: (t) => navigate({ ...params, tab: t }),
  };

  const dash = DASHES.find((d) => d.k === tab)!;
  const shortcuts: Shortcut[] = dash.shortcuts.map((s) => ({ ...s, c: s.count ? counts[s.count] : undefined }));
  const branchLabel = singleName ?? (params.branch === 'all' ? 'All branches' : branches.find((b) => b.id === params.branch)?.name ?? 'Branch');
  const mins = Math.round((Date.now() - loadedAt) / 60_000);

  const body: ReactNode = useMemo(() => {
    switch (payload.tab) {
      case 'business': return <BusinessDash data={payload.data} compare={params.compare} rangeLabel={rangeLabel} gran={gran} />;
      case 'accounts': return <AccountsDash data={payload.data} rangeLabel={rangeLabel} today={today} />;
      case 'service': return <ServiceDash data={payload.data} rangeLabel={rangeLabel} />;
      case 'sales': return (
        <SalesDash data={payload.data} rangeLabel={rangeLabel} onLost={async (id, no) => {
          const why = await askReason(`Why was ${no} lost?`, 'Reason (kept on the quotation)');
          if (!why) return false;
          const r = await markQuotationLostAction(id, why);
          toast('error' in r ? r.error : r.message);
          return !('error' in r);
        }} />
      );
      case 'stock': return <StockDash data={payload.data} rangeLabel={rangeLabel} onMakePo={(ids) => act({ label: 'Make PO', act: 'make-po', payload: ids })} />;
      case 'people': return (
        <PeopleDash data={payload.data} rangeLabel={rangeLabel} onDecide={async (type, id, decision) => {
          let note: string | null = null;
          if (decision === 'rejected') { note = await askReason('Reject this request?', 'Why is it being rejected?'); if (!note) return false; }
          const r = await decideAction(type, id, decision, note);
          if ('error' in r && r.error) { toast(r.error); return false; }
          toast(decision === 'approved' ? 'Approved.' : 'Rejected.');
          router.refresh();
          return true;
        }} />
      );
      case 'my': return <MyDash data={payload.data} />;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, rangeLabel, gran, params.compare, today]);

  return (
    <UICtx.Provider value={ui}>
      <div className="dash -m-3 min-h-full sm:-m-5 lg:-m-6">
        {/* phone: the dashboards as pills */}
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-card px-4 py-2 thin-scroll md:hidden">
          {tabs.map((k) => { const d = DASHES.find((x) => x.k === k)!; return <button type="button" key={k} onClick={() => navigate({ ...params, tab: k })} className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-brand text-brand-fg' : 'text-muted-foreground'}`}><DIcon n={d.i} s={14} />{d.l}</button>; })}
        </div>

        {/* sticky filter bar */}
        {/*
          Sticky only on wide screens, and solid (11 Oct 2026, live review): on a
          phone the bar is three rows tall and sticking it hid a third of the
          screen, and a see-through bar let the cards scroll visibly under it.
        */}
        <div className="page-bg no-print z-20 border-b border-border bg-background px-3 py-2.5 sm:px-6 sm:py-3 lg:sticky lg:-top-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="-mx-1 max-w-full overflow-x-auto px-1 thin-scroll">
              <SegCtl value={params.period === 'custom' ? '' : params.period} onChange={choosePeriod} options={PERIODS} size="sm" nowrap />
            </div>
            <div className="relative">
              <button type="button" onClick={() => setShowCustom(!showCustom)} aria-expanded={showCustom} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${params.period === 'custom' ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-card hover:bg-muted'}`}><DIcon n="calendar" s={13} />{params.period === 'custom' ? rangeLabel : 'Custom'}<DIcon n="chevDown" s={12} /></button>
              {showCustom && (
                <div className="dash-pop absolute start-0 top-10 z-40 w-[280px] rounded border border-border bg-card p-4">
                  <div className="micro-l mb-2">Pick dates</div>
                  <div className="grid grid-cols-2 gap-2">
                    {(['from', 'to'] as const).map((k) => (
                      <label key={k} className="text-xs text-muted-foreground">{k === 'from' ? 'From' : 'To'}
                        <input type="date" value={custom[k]} max={today} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, [k]: e.target.value }))} className="mt-1 h-9 w-full rounded-sm border border-border bg-card px-2 font-mono text-xs text-foreground" />
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {quarterPresets(today).map(([l, a, b]) => <button type="button" key={l} onClick={() => { setShowCustom(false); setCrumbs([]); navigate({ ...params, period: 'custom', from: a, to: b }); }} className="rounded-full bg-muted px-2.5 py-1 text-cap font-medium hover:bg-brand/10 hover:text-brand">{l}</button>)}
                  </div>
                  <Btn size="sm" kind="primary" className="mt-3 w-full" onClick={() => { setShowCustom(false); setCrumbs([]); const [f, t] = custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from]; navigate({ ...params, period: 'custom', from: f, to: t }); }}>Apply</Btn>
                </div>
              )}
            </div>
            <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Compare
              <select value={params.compare} onChange={(e) => navigate({ ...params, compare: e.target.value as CompareMode })} className="h-8 rounded-full border border-border bg-card px-2.5 text-xs font-medium text-foreground">
                <option value="prev">Previous period</option><option value="ly">Same period last year</option><option value="none">Off</option>
              </select>
            </label>
            {branches.length > 1 && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><DIcon n="pin" s={13} /><span className="sr-only">Branch</span>
                <select value={params.branch} onChange={(e) => navigate({ ...params, branch: e.target.value })} className="h-8 rounded-full border border-border bg-card px-2.5 text-xs font-medium text-foreground">
                  <option value="all">All branches</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            )}
            <div className="ms-auto flex items-center gap-1">
              <span className="hidden items-center gap-1.5 pe-2 text-cap text-muted-foreground md:flex"><i className={`inline-block h-1.5 w-1.5 rounded-full ${pending ? 'bg-warning' : 'bg-success'}`} />{pending ? 'Updating…' : `Updated ${mins < 1 ? 'just now' : `${mins} min ago`}`}</span>
              <button type="button" onClick={() => start(() => router.refresh())} title="Refresh" aria-label="Refresh" className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><DIcon n="refresh" s={15} /></button>
              <button type="button" onClick={() => window.print()} title="Print or save as PDF" aria-label="Print or save as PDF" className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><DIcon n="download" s={15} /></button>
              <button type="button" onClick={() => setEditing(!editing)} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${editing ? 'bg-brand text-brand-fg' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><DIcon n="sliders" s={13} />{editing ? 'Done' : 'Customise'}</button>
            </div>
          </div>
        </div>

        {/*
          Full width, like every other page (12 Oct 2026, Pravin's live review).
          It was capped at 1440px and centred, so on a wide screen - or zoomed
          out, which makes the screen wider in CSS pixels - the cards stopped
          growing and the spare width became a gap beside the side menu.
        */}
        <div className={`w-full space-y-5 px-4 py-5 transition-opacity sm:px-6 ${pending ? 'opacity-60' : ''}`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="page-head">
              <div className="page-sub flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {crumbs.length > 0 && <button type="button" onClick={back} className="flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 font-medium text-on-tint-brand hover:bg-brand/15"><DIcon n="arrowLeft" s={12} />Back to {crumbs[crumbs.length - 1].label}</button>}
                {branchLabel && <><span>{branchLabel}</span><span>·</span></>}<span className="font-medium text-foreground">{rangeLabel}</span>
                {compareLabel && <><span>·</span><span>vs {params.compare === 'ly' ? 'last year' : 'previous period'}</span></>}
              </div>
              <h1 className="page-title mt-1 text-h1 font-bold leading-tight">{dash.l} dashboard</h1>
              <p className="page-sub text-sm text-muted-foreground">{dash.q}</p>
            </div>
            {editing && <div className="rounded-full bg-brand/10 px-3 py-1.5 text-xs font-medium text-on-tint-brand">Customise: hide what you don’t need. Saved for you only.</div>}
          </div>

          <Shortcuts items={shortcuts} />

          <div key={tab + rangeLabel + params.compare + params.branch} className="dash-rise">{body}</div>
        </div>

        <Drawer d={drawer} onClose={() => setDrawer(null)} labels={buckets.map((b) => b.label)} />

        {showKeys && (
          <DialogFrame label="Keyboard shortcuts" onClose={() => setShowKeys(false)} closeOnBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <div className="dash dash-pop w-full max-w-sm rounded-lg bg-card p-6">
              <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">Keyboard shortcuts</h2><button type="button" onClick={() => setShowKeys(false)} className="rounded-full p-1.5 hover:bg-muted" aria-label="Close"><DIcon n="x" s={16} /></button></div>
              {[['T', 'Today'], ['W', 'Last 7 days'], ['M', 'This month'], ['Q', 'Last 90 days'], ['Y', 'This financial year'], ['C', 'Cycle compare: previous / last year / off'], [`1 – ${tabs.length}`, 'Switch dashboard'], ['Esc', 'Close the drill-down'], ['?', 'This list']].map(([k, l]) => <div key={k} className="flex items-center justify-between border-t border-border py-2 text-sm"><span>{l}</span><kbd className="rounded-sm bg-muted px-2 py-0.5 font-mono text-xs font-semibold">{k}</kbd></div>)}
            </div>
          </DialogFrame>
        )}

        {ask && <ReasonDialog title={ask.title} label={ask.label} onDone={(v) => { ask.resolve(v); setAsk(null); }} />}

        {toastMsg && (
          <div role="status" aria-live="polite" className="dash-pop fixed bottom-5 start-1/2 z-[60] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded bg-foreground px-4 py-3 text-sm text-background rtl:translate-x-1/2">
            <div className="flex items-start gap-2"><DIcon n="arrowUpRight" s={16} className="mt-0.5 shrink-0" /><div className="min-w-0">{toastMsg}</div></div>
          </div>
        )}
      </div>
    </UICtx.Provider>
  );
}

function ReasonDialog({ title, label, onDone }: { title: string; label: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState('');
  return (
    <DialogFrame label={title} onClose={() => onDone(null)} closeOnBackdrop className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4">
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onDone(v.trim()); }} className="dash dash-pop w-full max-w-sm rounded-lg bg-card p-6">
        <h2 className="text-lg font-bold">{title}</h2>
        <label className="mt-3 block text-xs text-muted-foreground">{label}
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists only to ask this one thing */}
          <input autoFocus value={v} onChange={(e) => setV(e.target.value)} className="mt-1 h-10 w-full rounded-sm border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-brand focus:ring-[3px] focus:ring-brand/20" />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Btn onClick={() => onDone(null)}>Cancel</Btn>
          <button type="submit" disabled={!v.trim()} className="inline-flex h-10 items-center rounded-full bg-brand px-4 text-sm font-semibold text-brand-fg disabled:opacity-50">Save</button>
        </div>
      </form>
    </DialogFrame>
  );
}

/** Quick picks in the custom range box: the last two complete quarters and last FY. */
function quarterPresets(today: string): [string, string, string][] {
  const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7));
  const fy = m >= 4 ? y : y - 1;
  const qs: [string, string, string][] = [
    [`Q1 (Apr–Jun)`, `${fy}-04-01`, `${fy}-06-30`],
    [`Q2 (Jul–Sep)`, `${fy}-07-01`, `${fy}-09-30`],
    [`Q3 (Oct–Dec)`, `${fy}-10-01`, `${fy}-12-31`],
  ].filter(([, , e]) => e < today) as [string, string, string][];
  return [...qs.slice(-2), ['Last FY', `${fy - 1}-04-01`, addDays(`${fy}-04-01`, -1)]];
}
