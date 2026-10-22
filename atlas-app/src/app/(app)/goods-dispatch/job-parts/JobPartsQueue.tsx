'use client';
import { CustomerLink } from '@/components/document/CustomerLink';
import { SerialLink, SerialLinks } from '@/components/document/SerialLink';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Badge, Card, PageHeader, SectionCard } from '@/components/ui/Layout';
import { receiveFaultyPartAction } from '../../services/actions';
import { GdnFix, IssueParts, ReceiveBack, ReceiveInstallBack, ReceiveWithSerial } from '@/components/services/GdnFix';
import { AutoRefresh } from '@/components/ui/AutoRefresh';

interface Challan {
  id: string; challanNo: string; complaintNo: string; jobHref: string; customerId?: string; customerName: string; type: string; status: string;
  createdAt: string; createdByName: string | null; note: string | null;
  lines: { id: string; productName: string; productCode: string; qty: number; qtyIssued: number; qtyReturned: number; qtyReturnPending: number; serial?: boolean; units?: { id: string; serialNo: string }[] }[];
  gdnNos: string[];
  /** Products the branch does not have enough of - why an approved challan is still waiting. */
  short?: string[];
}
interface Returning { lineId: string; qty: number; serial?: boolean; units?: { id: string; serialNo: string }[]; productName: string; productCode: string; challanNo: string; gdnNo: string | null; complaintNo: string; jobHref: string }
/** An installation's goods coming back against its order's GDN (R2, 22 Oct 2026). */
interface InstallReturning { itemId: string; qty: number; productName: string; productCode: string; serialNo: string | null; challanId: string; challanNo: string; orderNo: string | null }
interface Faulty { id: string; complaintId: string; complaintNo: string; description: string; serialNo: string | null; productName: string | null; loggedAt: string }

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const newest = <T,>(at: (x: T) => string) => (a: T, b: T) => at(b).localeCompare(at(a));

/**
 * The Parts counter (15 Oct 2026; was "Job parts to issue").
 *
 * The same queue and the same buttons, laid out as the flow it is - four
 * columns, left to right - instead of five boxes stacked in an order that
 * was not the flow ("Issued" sat above "Waiting for approval"). Pravin and
 * Vcare could not tell what the page did; the step that confused them most,
 * the GDN Atlas makes by itself on approval, is now said at the top, and an
 * approved challan that is still here says why (serials to pick, or which
 * part is short).
 */
export function JobPartsQueue({ challans, faulty, returns = [], installReturns = [], canIssue, autoGdn = true }: {
  challans: Challan[]; faulty: Faulty[]; returns?: Returning[]; installReturns?: InstallReturning[]; canIssue: boolean; autoGdn?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState('');
  const run = <R extends { error?: string }>(fn: () => Promise<R>, okText: (r: R) => string) => start(async () => {
    setMsg(null);
    const r = await fn();
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: okText(r) });
    router.refresh();
  });

  // One search over every column: challan, GDN, job number, customer, part.
  const needle = q.trim().toLowerCase();
  const hit = (...v: (string | null | undefined)[]) => !needle || v.some((x) => x?.toLowerCase().includes(needle));
  const matchC = (c: Challan) => hit(c.challanNo, c.complaintNo, c.customerName, c.createdByName, c.note, ...c.gdnNos, ...c.lines.map((l) => `${l.productName} ${l.productCode}`));

  const waiting = challans.filter((c) => c.status === 'pending_approval' && matchC(c)).sort(newest((c) => c.createdAt));
  const toIssue = challans.filter((c) => c.status === 'approved' && matchC(c)).sort(newest((c) => c.createdAt));
  const issued = challans.filter((c) => c.status === 'issued' && matchC(c)).sort(newest((c) => c.createdAt));
  const back = returns.filter((r) => hit(r.complaintNo, r.productName, r.productCode, r.challanNo, r.gdnNo));
  const broken = faulty.filter((f) => hit(f.complaintNo, f.description, f.productName, f.serialNo));
  const fitted = installReturns.filter((r) => hit(r.challanNo, r.orderNo, r.productName, r.productCode, r.serialNo));

  const job = (href: string, no: string) => <Link href={href} className="font-mono text-brand hover:underline">{no}</Link>;
  const empty = (text: string) => <p className="px-3 py-3 text-sm text-muted-foreground">{text}</p>;
  const row = 'grid gap-1.5 border-b border-border px-3 py-2.5 text-sm last:border-0';

  return (
    <div className="grid gap-4">
      <AutoRefresh />
      <PageHeader badge="PC" title="Parts counter" subtitle="Technicians' parts for a job - from asked for, to handed over, to coming back" />
      {msg && <Card className={`p-3 text-sm ${msg.ok ? 'border-success/40 text-success' : 'border-danger/40 text-danger'}`}><span role="status">{msg.text}</span></Card>}
      {!canIssue && <Card className="p-3 text-sm text-muted-foreground">You can see the counter; issuing and receiving need stock rights (Roles &gt; Stock: Edit).</Card>}

      <Card className="grid gap-1 p-3 text-sm">
        <p>
          <strong>{autoGdn ? 'Approving a challan creates its GDN automatically' : 'The automatic GDN is off'}</strong>
          {autoGdn
            ? ' - stock and cost move at once, and it goes straight to "Issued". Only serial items (pick which piece) and parts short in stock wait in "To issue".'
            : ' - every approved challan waits in "To issue" until you issue it.'}
          {' '}<Link href="/settings/field-jobs" className="text-brand hover:underline">Settings › Field jobs</Link>
        </p>
        <p className="text-xs text-muted-foreground">
          Unused parts add back to stock only when you receive them here. A replaced old unit opens a Replacements case when received.
        </p>
      </Card>

      <label className="block">
        <span className="sr-only">Search the counter</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Challan, GDN, job no, customer, part…"
          className="h-9 w-full max-w-md rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-brand"
        />
      </label>

      <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        <SectionCard title={`1. Waiting for approval (${waiting.length})`} icon="clock" bodyClassName="p-0">
          {waiting.length === 0 ? empty('None. With "No approval needed" (Settings › Approval Rules) challans skip this step.') : waiting.map((c) => (
            <div key={c.id} className={row}>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-mono font-semibold">{c.challanNo}</span>{job(c.jobHref, c.complaintNo)}</p>
              <p className="text-xs text-muted-foreground">{c.createdByName ?? '-'} · {when(c.createdAt)}</p>
              <p>{c.lines.map((l) => `${l.productName} × ${l.qty}`).join(', ')}</p>
              {/* Serials the office reserved when raising (22 Oct 2026). */}
              <SerialLinks units={c.lines.flatMap((l) => l.units ?? [])} />
              <p className="text-xs"><Link href={c.jobHref} className="text-brand hover:underline">Approve or reject on the job</Link></p>
            </div>
          ))}
        </SectionCard>

        <SectionCard title={`2. To issue (${toIssue.length})`} icon="truck" bodyClassName="p-0">
          {toIssue.length === 0 ? empty('Nothing waiting. Approved challans that need you - serials to pick, or stock that was short - appear here.') : toIssue.map((c) => {
            const serial = c.lines.some((l) => l.serial);
            return (
              <div key={c.id} data-row-id={c.id} className={row}>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono font-semibold">{c.challanNo}</span>{job(c.jobHref, c.complaintNo)}<Badge tone="neutral">{c.type}</Badge>
                </p>
                <p className="text-xs"><CustomerLink id={c.customerId}>{c.customerName}</CustomerLink> · <span className="text-muted-foreground">{c.createdByName ?? '-'} · {when(c.createdAt)}</span></p>
                <p>{c.lines.map((l) => `${l.productName} (${l.productCode}) × ${l.qty}`).join(' · ')}</p>
                <SerialLinks units={c.lines.flatMap((l) => l.units ?? [])} />
                {c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}
                <p className="flex flex-wrap gap-1.5">
                  {serial && <Badge tone="info">Pick the serials</Badge>}
                  {(c.short ?? []).length > 0 && <Badge tone="danger">Stock short: {(c.short ?? []).join(', ')}</Badge>}
                  {!serial && !(c.short ?? []).length && !autoGdn && <Badge tone="neutral">Automatic GDN is off</Badge>}
                </p>
                {canIssue && <div><IssueParts challanId={c.id} hasSerial={serial} onDone={(m) => setMsg({ ok: true, text: m })} /></div>}
              </div>
            );
          })}
        </SectionCard>

        <SectionCard title={`3. Issued - hand over (${issued.length})`} icon="check-circle" bodyClassName="p-0">
          {issued.length === 0 ? empty('None in the last 7 days.') : issued.map((c) => (
            <div key={c.id} data-row-id={c.id} className={row}>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-mono font-semibold text-brand">{c.gdnNos[0] ?? c.challanNo}</span>{job(c.jobHref, c.complaintNo)}</p>
              <p className="text-xs text-muted-foreground">{c.customerName} · {when(c.createdAt)}</p>
              <p>{c.lines.map((l) => `${l.productName}: ${l.qtyIssued} issued${l.qtyReturned ? `, ${l.qtyReturned} returned, ${l.qtyIssued - l.qtyReturned} used` : ''}`).join('; ')}</p>
              {c.lines.some((l) => (l.units ?? []).length) && (
                <SerialLinks units={c.lines.flatMap((l) => l.units ?? [])} />
              )}
              {canIssue && c.gdnNos[0] && <div><GdnFix challanId={c.id} gdnNo={c.gdnNos[0]} lines={c.lines} /></div>}
            </div>
          ))}
        </SectionCard>

        <SectionCard title={`4. Coming back (${back.length + fitted.length + broken.length})`} icon="refresh" bodyClassName="p-0">
          {back.length + fitted.length + broken.length === 0 ? empty('Nothing on its way back.') : (
            <>
              {back.map((r) => (
                <div key={r.lineId} className={row}>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1"><Badge tone="info">Unused</Badge>{job(r.jobHref, r.complaintNo)}</p>
                  <p><strong>{r.productName} × {r.qty}</strong> · <span className="font-mono">{r.gdnNo ?? r.challanNo}</span></p>
                  {canIssue && <div><ReceiveBack lineId={r.lineId} qty={r.qty} serial={r.serial} units={r.units} onDone={(m) => setMsg({ ok: true, text: m })} /></div>}
                </div>
              ))}
              {fitted.map((r) => (
                <div key={r.itemId} className={row}>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1"><Badge tone="info">Unused - installation</Badge>{job(`/services/installations/${r.challanId}`, r.challanNo)}</p>
                  <p><strong>{r.productName} × {r.qty}</strong>{r.serialNo ? <> · <SerialLink serialNo={r.serialNo} /></> : null}{r.orderNo ? <span className="text-muted-foreground"> · back against {r.orderNo}</span> : null}</p>
                  {canIssue && <div><ReceiveInstallBack challanId={r.challanId} itemId={r.itemId} qty={r.qty} onDone={(m) => setMsg({ ok: true, text: m })} /></div>}
                </div>
              ))}
              {broken.map((f) => (
                <div key={f.id} className={row}>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1"><Badge tone="warning">{f.description.startsWith('Old unit') ? 'Old unit' : 'Faulty'}</Badge>{job(`/services/complaints/${f.complaintId}`, f.complaintNo)}</p>
                  <p>{f.description}{f.productName ? ` (${f.productName})` : ''}{f.serialNo ? <> · <SerialLink serialNo={f.serialNo} /></> : null}</p>
                  <p className="text-xs text-muted-foreground">{when(f.loggedAt)}</p>
                  {canIssue && <ReceiveWithSerial busy={pending} onReceive={(serial) => run(() => receiveFaultyPartAction(f.id, serial), (r) => r.caseNo ? `Received. Replacements case ${r.caseNo} opened - send it to the supplier or scrap it from Services > Replacements.` : 'Received at the store.')} />}
                </div>
              ))}
            </>
          )}
        </SectionCard>
      </div>
      <p className="text-xs text-muted-foreground">Old repair challans from the earlier app stay in Repair challans (history).</p>
    </div>
  );
}
