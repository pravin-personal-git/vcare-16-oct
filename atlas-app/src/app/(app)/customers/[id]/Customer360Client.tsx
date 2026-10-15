'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';
import { EmployeeLink } from '@/components/document/EmployeeLink';
import { SupplierLink } from '@/components/document/SupplierLink';
import { formatCurrency, formatCurrencyCompact } from '@/lib/format';
import { whatsappLink } from '@/lib/revenue';
import { PayChooser } from '@/app/(app)/receipts/PayChooser';
import { ActionBar } from '@/components/document/ActionBar';
import type { C360Activity, C360Doc, Customer360, DocType, Tone } from '@/server/customer-360';

/**
 * THE CUSTOMER PAGE (G-39, 10 Oct 2026) - the customer's whole story, built
 * to the approved demo (09-documentation/customer-360-demo.html): where you
 * came from, who they are and how to reach them, five figures, and tabs for
 * activity, documents, the ledger, service, the items they hold and their
 * sites. Every number, name and serial opens its own page.
 *
 * The ledger, the sites card, custom fields and the change history are the
 * existing server-rendered pieces, handed in as slots - one ledger, one way
 * of editing sites, nothing rebuilt twice.
 */

type Data = Customer360;
const TABS = [
  ['overview', 'Overview', 'sparkles'], ['activity', 'Activity', 'clock'], ['documents', 'Documents', 'file-text'],
  ['ledger', 'Ledger', 'tag'], ['service', 'Service & AMC', 'wrench'], ['items', 'Items & warranty', 'box'], ['sites', 'Sites', 'map-pin'],
] as const;
type Tab = (typeof TABS)[number][0];

const TYPE: Record<DocType, { label: string; one: string; icon: IconName }> = {
  quotation: { label: 'Quotations', one: 'Quotation', icon: 'file-text' }, order: { label: 'Sales orders', one: 'Sales order', icon: 'shopping-cart' },
  invoice: { label: 'Invoices', one: 'Invoice', icon: 'receipt' }, receipt: { label: 'Receipts', one: 'Receipt', icon: 'credit-card' },
  credit: { label: 'Credit notes', one: 'Credit note', icon: 'rotate-ccw' }, return: { label: 'Returns', one: 'Sales return', icon: 'rotate-ccw' },
  challan: { label: 'Challans', one: 'Installation challan', icon: 'truck' }, amc: { label: 'AMC', one: 'AMC contract', icon: 'shield-check' },
};
const TONE: Record<Tone, string> = {
  success: 'bg-success/10 text-on-tint-success', warning: 'bg-warning/10 text-on-tint-warning', danger: 'bg-danger/10 text-on-tint-danger',
  info: 'bg-info/10 text-on-tint-info', brand: 'bg-brand/10 text-on-tint-brand', neutral: 'bg-muted text-muted-foreground',
};
const KIND_TONE: Record<C360Activity['kind'], string> = { sales: 'bg-brand/10 text-on-tint-brand', money: 'bg-success/10 text-on-tint-success', service: 'bg-info/10 text-on-tint-info', calls: 'bg-accent/10 text-accent' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const fmtShort = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
const when = (d: Date | string) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const istMonth = (d: Date | string) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 7);

function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-micro font-semibold ${TONE[tone]}`}>{icon && <Icon name={icon} className="h-3 w-3" />}{children}</span>;
}
function Panel({ className = '', children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-lg border border-border bg-card ${className}`}>{children}</section>;
}
function PanelHead({ icon, title, count, action }: { icon: IconName; title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-brand/10 text-on-tint-brand"><Icon name={icon} className="h-3.5 w-3.5" /></span>
      <h2 className="text-sm font-semibold">{title}</h2>
      {count !== undefined && <span className="rounded-full bg-muted px-1.5 text-micro font-semibold text-muted-foreground tabular-nums">{count}</span>}
      <div className="ms-auto">{action}</div>
    </div>
  );
}
const eyebrow = 'text-micro font-semibold uppercase tracking-wide text-muted-foreground';

export function Customer360Client({
  data, owePaise, canQuote, canPay, canComplain, ledger, sites, about, history,
}: {
  data: Data; canQuote: boolean; canPay: boolean; canComplain: boolean;
  /** All-time closing balance from customer-ledger.ts - the one place balances are worked out. */
  owePaise: number;
  /** Server-rendered slots: the ledger, the sites card, custom fields, the change history. */
  ledger: ReactNode; sites: ReactNode; about: ReactNode; history: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const tabParam = sp.get('tab');
  const initial: Tab = TABS.some((t) => t[0] === tabParam) ? (tabParam as Tab) : data.from?.kind === 'complaint' ? 'service' : 'overview';
  const [tab, setTabState] = useState<Tab>(initial);
  const [docFilter, setDocFilter] = useState<{ type?: DocType; month?: string }>({});
  const [paying, setPaying] = useState(false);
  const [hideFrom, setHideFrom] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const setTab = (t: Tab, filter?: { type?: DocType; month?: string }) => {
    setTabState(t);
    if (t === 'documents') setDocFilter(filter ?? {});
    const q = new URLSearchParams(sp.toString());
    q.set('tab', t);
    // Address only - every tab is already in the page. router.replace would
    // re-run the whole customer loader on the server for each tab click.
    window.history.replaceState(null, '', `${pathname}?${q}`);
    document.getElementById('c360-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const p = data.party;
  const f = data.figures;
  const from = hideFrom ? null : data.from;
  const hotIds = useMemo(() => new Set(from ? [from.id, ...from.links] : []), [from]);
  const owe = owePaise;
  const initials = (p.name || p.companyName || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const phone = `${p.phoneCc ?? '+91'} ${p.phone}`;
  const tile = 'group flex min-w-0 items-center gap-3 rounded-md border border-border bg-card px-3 py-2 transition hover:border-brand/40';
  const counts: Partial<Record<Tab, number>> = { activity: data.activity.length, documents: data.docs.length, service: data.jobs.length, items: data.items.length, sites: data.sites.length };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {flash && <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-on-tint-success print:hidden">{flash}</p>}

      {/* ---- where you came from ------------------------------------------ */}
      {from && (
        <div className="relative overflow-hidden rounded-lg border border-brand/30 bg-brand/[.04] p-4 print:hidden">
          <div className="absolute inset-y-0 start-0 w-1 bg-brand" />
          <div className="flex flex-wrap items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand text-white"><Icon name={from.kind === 'complaint' ? 'wrench' : TYPE[from.kind].icon} className="h-5 w-5" /></span>
            <div className="min-w-[12rem] flex-1">
              <p className="text-micro font-bold uppercase tracking-wider text-brand">You opened this customer from</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{from.kind === 'complaint' ? 'Complaint' : TYPE[from.kind].one}</span>
                <Link href={from.href} className="font-mono text-sm font-semibold text-brand hover:underline">{from.no}</Link>
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {from.lines.map((l) => <li key={l} className="flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-brand/60" />{l}</li>)}
              </ul>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              {from.links.length > 0 && (
                <div className="hidden text-end text-xs md:block">
                  <span className="block font-semibold">Linked to it</span>
                  {from.links.map((id) => { const d = data.docs.find((x) => x.id === id); return d && <Link key={id} href={d.href} className="block font-mono text-brand hover:underline">{d.no}</Link>; })}
                </div>
              )}
              <Link href={from.href} className="inline-flex h-ctl items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold hover:border-border-strong"><Icon name="arrow-left" className="h-4 w-4" />Back to the {from.kind === 'complaint' ? 'complaint' : TYPE[from.kind].one.toLowerCase()}</Link>
              <button type="button" onClick={() => setHideFrom(true)} title="Hide" className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"><Icon name="x" className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      )}

      {/* ---- who they are ----------------------------------------------- */}
      <Panel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-foreground text-xl font-semibold text-background">{initials}</div>
          <div className="min-w-0 flex-1 basis-56">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-h1 font-semibold leading-tight">{p.name || p.companyName}</h1>
              <Badge tone={p.status === 'active' ? 'success' : 'neutral'} icon={p.status === 'active' ? 'check' : undefined}>{p.status === 'active' ? 'Active' : p.status}</Badge>
              {f.activeAmc && <Badge tone="brand" icon="shield-check">AMC covered</Badge>}
              {f.overduePaise > 0 && <Badge tone="danger" icon="alert-triangle">{formatCurrency(f.overduePaise)} overdue</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {p.companyName && p.name && <><span className="font-semibold text-foreground">{p.companyName}</span> · </>}
              <span className="font-mono text-xs">{p.partyCode}</span> · customer since {fmt(p.customerSince)}
              {p.isSupplier && <> · also a <SupplierLink id={p.id} className="text-brand">supplier</SupplierLink></>}
            </p>
          </div>
          {/* The shared action bar (Option A, G6 - 11 Oct 2026). */}
          <ActionBar
            className="print:hidden"
            next={canComplain ? { label: 'Raise complaint', icon: 'wrench', onClick: () => router.push(`/services/complaints?raise=${p.id}`) } : undefined}
            money={canPay ? { label: 'Record payment', icon: 'credit-card', onClick: () => setPaying(true) } : undefined}
            whatsapp={p.phone ? { label: 'WhatsApp', icon: 'whatsapp', onClick: () => window.open(whatsappLink(p.phone, ''), '_blank') } : undefined}
            sendMenu={p.phone ? [{ label: 'Copy mobile number', icon: 'copy', onClick: () => { navigator.clipboard?.writeText(phone).catch(() => {}); setFlash('Mobile number copied.'); setTimeout(() => setFlash(null), 1800); } }] : []}
            actions={[
              ...(canQuote ? [{ label: 'New quotation', icon: 'file-text' as const, iconTone: 'brand' as const, onClick: () => router.push(`/quotation?customer=${p.id}`) }] : []),
              { label: 'Call', icon: 'phone', iconTone: 'success', onClick: () => { window.location.href = `tel:${(p.phoneCc ?? '+91') + p.phone}`; } },
            ]}
          />
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className={tile}>
            <a href={`tel:${(p.phoneCc ?? '+91') + p.phone}`} title="Call" className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-success/10 text-on-tint-success hover:bg-success hover:text-white"><Icon name="phone" className="h-4 w-4" /></a>
            <a href={`tel:${(p.phoneCc ?? '+91') + p.phone}`} className="min-w-0"><span className={`block ${eyebrow}`}>Mobile</span><span className="block whitespace-nowrap font-mono text-sm font-semibold hover:text-brand">{phone}</span></a>
            <span className="ms-auto flex shrink-0 gap-1">
              <a href={whatsappLink(p.phone, '')} target="_blank" rel="noreferrer" title="WhatsApp" className="grid h-7 w-7 place-items-center rounded-md text-success hover:bg-success/10"><Icon name="whatsapp" className="h-4 w-4" /></a>
              <button type="button" title="Copy" onClick={() => { navigator.clipboard?.writeText(phone).catch(() => {}); setFlash('Mobile number copied.'); setTimeout(() => setFlash(null), 1800); }} className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted"><Icon name="copy" className="h-4 w-4" /></button>
            </span>
          </div>
          {p.email ? (
            <a href={`mailto:${p.email}`} className={tile}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-info/10 text-on-tint-info"><Icon name="mail" className="h-4 w-4" /></span>
              <span className="min-w-0"><span className={`block ${eyebrow}`}>Email</span><span className="block truncate text-sm font-medium group-hover:text-brand">{p.email}</span></span>
            </a>
          ) : (
            <div className={tile}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><Icon name="mail" className="h-4 w-4" /></span><span><span className={`block ${eyebrow}`}>Email</span><span className="text-sm text-muted-foreground">Not on file</span></span></div>
          )}
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address || p.city || '')}`} target="_blank" rel="noreferrer" className={tile}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent/10 text-accent"><Icon name="map-pin" className="h-4 w-4" /></span>
            <span className="min-w-0"><span className={`block ${eyebrow}`}>Address · map</span><span className="block truncate text-sm font-medium group-hover:text-brand">{p.address || 'Not on file'}</span></span>
          </a>
          <div className={tile}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand/10 text-on-tint-brand"><Icon name="tag" className="h-4 w-4" /></span>
            <span className="min-w-0"><span className={`block ${eyebrow}`}>GSTIN · Terms</span><span className="block truncate text-sm font-medium"><span className="font-mono text-xs">{p.gstin || 'No GSTIN'}</span> · {p.creditLimitDays ? `${p.creditLimitDays} days` : 'on delivery'}</span></span>
          </div>
        </div>
      </Panel>

      {/* ---- five figures ------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 print:hidden">
        {([
          { label: 'Lifetime sales', money: f.lifetimePaise, value: formatCurrency(f.lifetimePaise), sub: `${f.invoiceCount} invoice${f.invoiceCount === 1 ? '' : 's'}`, icon: 'trending-up', tone: '', go: () => setTab('documents', { type: 'invoice' }) },
          { label: 'They owe', money: Math.max(0, owe), value: formatCurrency(Math.max(0, owe)), sub: f.overduePaise ? `${formatCurrency(f.overduePaise)} overdue · oldest ${f.oldestDays} d` : 'Nothing overdue', icon: 'tag', tone: owe > 0 ? 'text-danger' : '', go: () => setTab('ledger') },
          { label: 'Paid this FY', money: f.paidFyPaise, value: formatCurrency(f.paidFyPaise), sub: f.lastPaymentAt ? `last payment ${fmtShort(f.lastPaymentAt)}` : 'no payments yet', icon: 'credit-card', tone: f.paidFyPaise ? 'text-success' : '', go: () => setTab('documents', { type: 'receipt' }) },
          { label: 'Open jobs', money: 0, value: String(f.openJobs), sub: f.nextVisit ? `visit ${when(f.nextVisit)}` : f.openJobs ? 'see Service' : 'none open', icon: 'wrench', tone: '', go: () => setTab('service') },
          { label: 'Cover', money: 0, value: f.activeAmc ? `AMC + ${f.inWarranty} in warranty` : `${f.inWarranty} in warranty`, sub: f.activeAmc ? `AMC to ${fmt(f.activeAmc.endDate)}` : 'no AMC', icon: 'shield-check', tone: '', go: () => setTab('items') },
        ] as const).map((k) => (
          <button key={k.label} type="button" onClick={k.go} className="group rounded-lg border border-border bg-card p-3.5 text-start transition hover:-translate-y-0.5 hover:border-brand/40">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-brand/10 text-on-tint-brand"><Icon name={k.icon} className="h-3.5 w-3.5" /></span>
              <span className={eyebrow}>{k.label}</span>
              <Icon name="arrow-up-right" className="ms-auto h-3.5 w-3.5 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
            </div>
            {/* A rupee total too long for the tile shows in lakh / crore, the full figure on hover. */}
            <p title={k.value} className={`mt-2 font-mono text-num font-semibold leading-tight ${k.money ? 'whitespace-nowrap' : 'line-clamp-2'} ${k.tone}`}>{k.money && k.value.length > 11 ? formatCurrencyCompact(k.money) : k.value}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{k.sub}</p>
          </button>
        ))}
      </div>

      {/* ---- tabs --------------------------------------------------------- */}
      <div id="c360-tabs" className="sticky top-0 z-20 -mx-3 scroll-mt-16 border-b border-border bg-background px-3 sm:-mx-5 sm:px-5 lg:-mx-6 lg:px-6 print:hidden">
        <div className="scrollbar-none flex gap-1 overflow-x-auto">
          {TABS.map(([k, l, ic]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`relative flex shrink-0 items-center gap-1.5 px-3 py-3 text-sm font-semibold transition ${tab === k ? 'text-brand' : 'text-muted-foreground hover:text-foreground'}`}>
              <Icon name={ic} className="h-4 w-4" />{l}
              {counts[k] !== undefined && <span className={`rounded-full px-1.5 text-micro tabular-nums ${tab === k ? 'bg-brand/10' : 'bg-muted'}`}>{counts[k]}</span>}
              {tab === k && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand" />}
            </button>
          ))}
        </div>
      </div>

      <div key={tab} className="animate-fade-in">
        {tab === 'overview' && <Overview data={data} hot={hotIds} setTab={setTab} about={about} />}
        {tab === 'activity' && <ActivityTab rows={data.activity} hot={hotIds} />}
        {tab === 'documents' && <DocumentsTab docs={data.docs} hot={hotIds} fromId={from?.id ?? null} filter={docFilter} setFilter={setDocFilter} />}
        {tab === 'ledger' && ledger}
        {tab === 'service' && <ServiceTab data={data} hot={hotIds} canComplain={canComplain} />}
        {tab === 'items' && <ItemsTab data={data} />}
        {tab === 'sites' && sites}
      </div>

      <div className="print:hidden">{history}</div>

      {paying && (
        <PayChooser
          party={{ id: p.id, label: p.companyName ? `${p.companyName} - ${p.name}` : p.name, sub: [p.partyCode, phone].join(' · ') }}
          onClose={() => setPaying(false)}
          onDone={(msg) => { setPaying(false); setFlash(msg); router.refresh(); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- pieces -- */
function Timeline({ rows, hot, compact = false }: { rows: C360Activity[]; hot: Set<string>; compact?: boolean }) {
  return (
    <ol className="relative">
      {rows.map((a, i) => {
        const isHot = !!a.ref && hot.has(a.ref);
        const body = (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <p className="text-sm font-semibold">{a.title}</p>
              {isHot && <Badge tone="brand">linked to where you came from</Badge>}
              <span className="ms-auto text-xs text-muted-foreground tabular-nums">{when(a.at)}</span>
            </div>
            {a.detail && <p className="mt-0.5 text-xs text-muted-foreground">{a.detail}</p>}
          </>
        );
        const cls = `block min-w-0 flex-1 rounded-md px-3 py-2 transition ${isHot ? 'bg-brand/[.06] ring-1 ring-brand/30' : 'hover:bg-muted/60'}`;
        return (
          <li key={a.id} className={`relative flex gap-3 ${compact ? 'pb-3' : 'pb-4'}`}>
            {i < rows.length - 1 && <span className="absolute start-[15px] top-8 bottom-0 w-px bg-border" />}
            <span className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full ring-4 ring-card ${KIND_TONE[a.kind]}`}><Icon name={a.icon} className="h-3.5 w-3.5" /></span>
            <div className="min-w-0 flex-1">
              {a.href ? <Link href={a.href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}
              {!compact && a.byId && <p className="ms-3 mt-0.5 text-micro text-muted-foreground">by <EmployeeLink id={a.byId}>{a.byName ?? 'a colleague'}</EmployeeLink></p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Overview({ data, hot, setTab, about }: { data: Data; hot: Set<string>; setTab: (t: Tab, f?: { type?: DocType; month?: string }) => void; about: ReactNode }) {
  const now = new Date();
  const attention: { dot: string; title: string; sub: string; href: string }[] = [
    ...data.docs.filter((d) => d.type === 'invoice' && d.status.tone === 'danger').map((d) => ({ dot: 'bg-danger', title: `${d.no} ${d.status.label.toLowerCase()}`, sub: `${formatCurrency(d.duePaise ?? 0)} due since ${fmtShort(d.dueDate!)}`, href: d.href })),
    ...data.jobs.filter((j) => j.tone !== 'success').map((j) => ({ dot: 'bg-info', title: j.nextVisit && new Date(j.nextVisit) >= now ? `Visit ${when(j.nextVisit)}` : `${j.no} · ${j.status.toLowerCase()}`, sub: `${j.no}${j.techName ? ` · ${j.techName}` : ' · no technician yet'}`, href: j.href })),
    ...data.docs.filter((d) => d.type === 'credit' && d.status.label === 'Draft').map((d) => ({ dot: 'bg-warning', title: 'Credit note still a draft', sub: `${d.no} · ${d.note}`, href: d.href })),
  ];
  // Invoiced by month, this financial year (April to March), India months.
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = (3 + i) % 12; const y = m >= 3 ? fyStartYear : fyStartYear + 1;
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    const v = data.docs.filter((d) => d.type === 'invoice' && istMonth(d.at) === key && !['Draft', 'Cancelled'].includes(d.status.label)).reduce((s, d) => s + d.amountPaise, 0);
    return { key, label: MON[m], v };
  });
  const max = Math.max(1, ...months.map((m) => m.v));
  const p = data.party;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
      <Panel className="lg:col-span-2">
        <PanelHead icon="clock" title="Recent activity" count={data.activity.length} action={<button type="button" onClick={() => setTab('activity')} className="text-xs font-semibold text-brand hover:underline">See all →</button>} />
        <div className="p-4">{data.activity.length ? <Timeline rows={data.activity.slice(0, 6)} hot={hot} compact /> : <p className="py-8 text-center text-sm text-muted-foreground">Nothing yet.</p>}</div>
      </Panel>
      <div className="grid min-w-0 content-start gap-4">
        <Panel>
          <PanelHead icon="alert-triangle" title="Needs attention" count={attention.length} />
          <ul className="divide-y divide-border">
            {attention.map((a) => (
              <li key={a.title + a.sub}><Link href={a.href} className="flex gap-3 px-4 py-3 transition hover:bg-muted/50">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.dot}`} />
                <span className="min-w-0 text-sm"><span className="block font-semibold">{a.title}</span><span className="block text-xs text-muted-foreground">{a.sub}</span></span>
                <Icon name="arrow-up-right" className="ms-auto mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Link></li>
            ))}
            {!attention.length && <li className="px-4 py-6 text-center text-sm text-muted-foreground">All clear.</li>}
          </ul>
        </Panel>
        <Panel className="p-4">
          <div className="flex h-28 items-end gap-1.5">
            {months.map((m) => (
              <button key={m.key} type="button" disabled={!m.v} title={m.v ? formatCurrency(m.v) : undefined} onClick={() => setTab('documents', { month: m.key })} className="flex flex-1 flex-col items-center gap-1 disabled:cursor-default">
                <div className="flex h-24 w-full items-end"><div className={`w-full rounded-t-[4px] transition ${m.v ? 'bg-brand/80 hover:bg-brand' : 'bg-muted'}`} style={{ height: m.v ? `${Math.max(8, (m.v / max) * 100)}%` : '4px' }} /></div>
                <span className="text-micro text-muted-foreground">{m.label}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Invoiced by month · this financial year · click a bar for that month</p>
        </Panel>
        <Panel>
          <PanelHead icon="user" title="About" />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 p-4 text-sm">
            <div><dt className={eyebrow}>Account manager</dt><dd>{p.assignedManagerId ? <EmployeeLink id={p.assignedManagerId}>{p.managerName ?? 'Assigned'}</EmployeeLink> : <span className="text-muted-foreground">Not set</span>}</dd></div>
            <div><dt className={eyebrow}>Source</dt><dd className="font-medium">{p.source || '-'}</dd></div>
            <div><dt className={eyebrow}>Credit limit</dt><dd className="font-mono font-medium">{p.creditLimitPaise ? formatCurrency(p.creditLimitPaise) : 'None'}</dd></div>
            <div><dt className={eyebrow}>Other phone</dt><dd>{p.altPhone ? <a href={`tel:${p.altPhone}`} className="font-mono font-medium hover:text-brand hover:underline">{p.altPhone}</a> : '-'}</dd></div>
            <div><dt className={eyebrow}>Customer portal</dt><dd className="font-medium">{p.portalEnabled ? 'Signed up' : 'Not yet'}</dd></div>
            <div><dt className={eyebrow}>Sites</dt><dd><button type="button" onClick={() => setTab('sites')} className="font-medium hover:text-brand hover:underline">{data.sites.length}</button></dd></div>
          </dl>
          {about}
        </Panel>
      </div>
    </div>
  );
}

function ActivityTab({ rows, hot }: { rows: C360Activity[]; hot: Set<string> }) {
  const [kind, setKind] = useState<'all' | C360Activity['kind']>('all');
  const [q, setQ] = useState('');
  const kinds = [['all', 'Everything'], ['sales', 'Sales'], ['money', 'Money'], ['service', 'Service'], ['calls', 'Calls']] as const;
  const shown = rows.filter((a) => (kind === 'all' || a.kind === kind) && `${a.title} ${a.detail}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="flex flex-wrap gap-1 rounded-full bg-muted p-1">
          {kinds.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-xs font-semibold transition ${kind === k ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {l} <span className="tabular-nums opacity-60">{k === 'all' ? rows.length : rows.filter((a) => a.kind === k).length}</span>
            </button>
          ))}
        </div>
        <label className="ms-auto flex h-9 w-full items-center gap-2 rounded-full border border-border bg-card px-3 sm:w-64">
          <Icon name="search" className="h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search activity…" className="w-full bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/40" />
        </label>
      </div>
      <div className="p-4">{shown.length ? <Timeline rows={shown} hot={hot} /> : <p className="py-10 text-center text-sm text-muted-foreground">Nothing matches.</p>}</div>
    </Panel>
  );
}

function SortHead({ label, k, sort, setSort, right = false }: { label: string; k: 'date' | 'amount'; sort: { key: 'date' | 'amount'; dir: 'asc' | 'desc' }; setSort: (s: { key: 'date' | 'amount'; dir: 'asc' | 'desc' }) => void; right?: boolean }) {
  const on = sort.key === k;
  return (
    <th className={`px-4 py-2.5 ${right ? 'text-right' : ''}`}>
      <button type="button" onClick={() => setSort({ key: k, dir: on && sort.dir === 'desc' ? 'asc' : 'desc' })}
        title={on ? (sort.dir === 'desc' ? 'Newest / largest first - click for oldest / smallest first' : 'Oldest / smallest first - click for newest / largest first') : 'Sort'}
        className={`-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase tracking-wide transition hover:bg-muted hover:text-foreground ${on ? 'text-brand' : ''}`}>
        {label}<Icon name={on ? (sort.dir === 'desc' ? 'chevron-down' : 'chevron-up') : 'columns'} className="h-3.5 w-3.5" />
        {on && k === 'date' && <span className="text-micro font-semibold normal-case tracking-normal">{sort.dir === 'desc' ? 'newest' : 'oldest'}</span>}
      </button>
    </th>
  );
}

function DocumentsTab({ docs, hot, fromId, filter, setFilter }: { docs: C360Doc[]; hot: Set<string>; fromId: string | null; filter: { type?: DocType; month?: string }; setFilter: (f: { type?: DocType; month?: string }) => void }) {
  const [sort, setSort] = useState<{ key: 'date' | 'amount'; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [q, setQ] = useState('');
  const types = (Object.keys(TYPE) as DocType[]).filter((t) => docs.some((d) => d.type === t));
  const rows = docs
    .filter((d) => (!filter.type || d.type === filter.type) && (!filter.month || istMonth(d.at) === filter.month) && `${d.no} ${d.note}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => { const v = sort.key === 'date' ? new Date(a.at).getTime() - new Date(b.at).getTime() : a.amountPaise - b.amountPaise; return sort.dir === 'asc' ? v : -v; });
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="thin-scroll flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5">
          {([undefined, ...types] as (DocType | undefined)[]).map((t) => {
            const on = filter.type === t;
            return (
              <button key={t ?? 'all'} type="button" onClick={() => setFilter({ ...filter, type: t })} className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${on ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:border-border-strong'}`}>
                {t && <Icon name={TYPE[t].icon} className="h-3.5 w-3.5" />}{t ? TYPE[t].label : 'All documents'}
                <span className={`rounded-full px-1.5 tabular-nums ${on ? 'bg-background/20' : 'bg-muted text-muted-foreground'}`}>{t ? docs.filter((d) => d.type === t).length : docs.length}</span>
              </button>
            );
          })}
        </div>
        <label className="flex h-9 w-full items-center gap-2 rounded-full border border-border bg-card px-3 sm:w-56">
          <Icon name="search" className="h-4 w-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number or detail…" className="w-full bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/40" />
        </label>
      </div>
      {filter.month && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs">
          <span className="text-muted-foreground">Showing</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 font-semibold text-on-tint-brand">{MON[Number(filter.month.slice(5)) - 1]} {filter.month.slice(0, 4)}<button type="button" aria-label="Clear the month filter" onClick={() => setFilter({ ...filter, month: undefined })}><Icon name="x" className="h-3 w-3" /></button></span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-sm">
          <thead><tr className="border-b border-border bg-muted/40 text-left text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2.5">Document</th>
            <SortHead label="Date" k="date" sort={sort} setSort={setSort} />
            <th className="px-4 py-2.5">Details</th><th className="px-4 py-2.5">Status</th>
            <SortHead label="Amount" k="amount" sort={sort} setSort={setSort} right />
          </tr></thead>
          <tbody>
            {rows.map((d) => {
              const isHot = hot.has(d.id);
              return (
                <tr key={d.id} className={`border-b border-border last:border-0 transition ${isHot ? 'bg-brand/[.05]' : 'hover:bg-muted/40'}`}>
                  <td className="px-4 py-2.5"><Link href={d.href} className="group flex items-center gap-2.5">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${isHot ? 'bg-brand text-white' : 'bg-muted text-muted-foreground'}`}><Icon name={TYPE[d.type].icon} className="h-3.5 w-3.5" /></span>
                    <span><span className="font-mono text-sm font-semibold text-brand group-hover:underline">{d.no}</span>{isHot && <span className="ms-2"><Badge tone="brand">{d.id === fromId ? 'you came from here' : 'linked'}</Badge></span>}<span className="block text-micro text-muted-foreground">{TYPE[d.type].one}</span></span>
                  </Link></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">{fmt(d.at)}</td>
                  <td className="px-4 py-2.5 text-xs">{d.note || '-'}</td>
                  <td className="px-4 py-2.5"><Badge tone={d.status.tone}>{d.status.label}</Badge></td>
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-semibold">{d.amountPaise ? formatCurrency(d.amountPaise) : '-'}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="py-10 text-center text-sm text-muted-foreground">No documents match.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ServiceTab({ data, hot, canComplain }: { data: Data; hot: Set<string>; canComplain: boolean }) {
  const amcs = data.docs.filter((d) => d.type === 'amc');
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
      <Panel className="lg:col-span-2">
        <PanelHead icon="wrench" title="Complaints & jobs" count={data.jobs.length} action={canComplain && <Link href={`/services/complaints?raise=${data.party.id}`} className="text-xs font-semibold text-brand hover:underline">+ New</Link>} />
        <div className="grid gap-3 p-4">
          {data.jobs.map((j) => (
            <Link key={j.id} href={j.href} className={`block rounded-md border p-3 transition ${hot.has(j.id) ? 'border-brand/40 bg-brand/[.05]' : 'border-border hover:border-brand/30'}`}>
              <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-sm font-semibold text-brand">{j.no}</span><Badge tone={j.tone}>{j.status}</Badge>{hot.has(j.id) && <Badge tone="brand">you came from here</Badge>}<span className="ms-auto text-xs text-muted-foreground">opened {fmt(j.at)}</span></div>
              <p className="mt-1 text-sm font-semibold">{j.item}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Icon name="user" className="h-3.5 w-3.5" />{j.techName ?? 'No technician yet'}</span>
                {j.nextVisit && <span className="flex items-center gap-1"><Icon name="calendar" className="h-3.5 w-3.5" />Visit {when(j.nextVisit)}</span>}
              </div>
            </Link>
          ))}
          {!data.jobs.length && <p className="py-8 text-center text-sm text-muted-foreground">No complaints from this customer.</p>}
        </div>
      </Panel>
      <Panel>
        <PanelHead icon="shield-check" title="Maintenance contracts" count={amcs.length} />
        <div className="grid gap-3 p-4">
          {amcs.map((a) => (
            <Link key={a.id} href={a.href} className="block rounded-md border border-border p-3 transition hover:border-brand/30">
              <div className="flex items-center justify-between gap-2"><span className="font-mono text-sm font-semibold text-brand">{a.no}</span><Badge tone={a.status.tone}>{a.status.label}</Badge></div>
              <p className="mt-1 text-xs text-muted-foreground">{a.note}</p>
              <p className="mt-1 font-mono text-sm font-semibold">{formatCurrency(a.amountPaise)}</p>
            </Link>
          ))}
          {!amcs.length && <p className="py-6 text-center text-sm text-muted-foreground">No AMC with this customer.</p>}
        </div>
      </Panel>
    </div>
  );
}

function ItemsTab({ data }: { data: Data }) {
  const now = Date.now();
  return (
    <Panel>
      <PanelHead icon="box" title="What they have from us" count={data.items.length} action={<span className="text-xs text-muted-foreground">by serial number</span>} />
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.items.map((u) => {
          const until = u.warrantyUntil ? new Date(u.warrantyUntil).getTime() : null;
          const live = until !== null && until >= now;
          return (
            <div key={u.id} className="rounded-md border border-border p-3 transition hover:border-brand/30">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><Icon name="box" className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <Link href={`/product-journey?product=${u.productId}`} className="block truncate text-sm font-semibold hover:text-brand hover:underline">{u.product}</Link>
                  <Link href={u.href} className="font-mono text-micro font-semibold text-brand hover:underline">{u.serial}</Link>
                  <p className="text-micro text-muted-foreground">{u.status}{u.invoice && <> · sold on <Link href={`/invoices/${u.invoice.id}`} className="font-mono text-brand hover:underline">{u.invoice.no}</Link></>}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-micro">
                <span className={live ? 'text-success' : 'text-muted-foreground'}>{until ? `${live ? 'Warranty to' : 'Warranty ended'} ${fmt(u.warrantyUntil!)}` : 'No warranty on record'}</span>
                {u.amc && <Badge tone="brand">AMC</Badge>}
              </div>
            </div>
          );
        })}
        {!data.items.length && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">No serial-numbered items with this customer.</p>}
      </div>
    </Panel>
  );
}
