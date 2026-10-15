'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { CUSTOMER_STEPS, customerStep } from '@/lib/job-flow';
import { whatsappLink } from '@/lib/revenue';
import { safeDocNo } from '@/lib/wa-message';

/**
 * The customer's view of a job (workflow slice 5) - the same on the portal
 * and on the no-login link: where it is, who is coming and when, and the one
 * or two things they can do now (confirm, approve an estimate, ask for
 * another time, rate, reopen). Never shows challans, costs or internal notes.
 *
 * 11 Oct 2026 (ops-pages demo tab 8): redesigned phone-first - a brand hero
 * with a progress ring that fills, the technician as a person (Call,
 * WhatsApp, a live pulse only while they are on the way or on site), "what
 * happens next" in one sentence with the one thing to do as a big button,
 * the product with its warranty, and a timeline that draws in. The data and
 * every action are exactly what they were; only the presentation changed.
 * Motion lives in globals.css under prefers-reduced-motion: no-preference.
 */
export interface CustomerJobVM {
  id: string; complaintNo: string; productName: string | null; description: string; status: string; statusLabel: string;
  siteLocation: string | null; createdAt: string;
  technician: { name: string; phone: string | null } | null;
  /** When the technician checked in on site - "working on it since". Optional: an older server sends none. */
  onSiteSince?: string | null;
  /** The unit's warranty end, when known. Optional. */
  warrantyUntil?: string | null;
  visits: { id: string; scheduledAt: string; status: string }[];
  timeline: { id: string; body: string | null; statusTo: string | null; createdAt: string }[];
  estimate: { lines: { description: string; qty: number; unitPaise: number }[]; totalPaise: number; note: string | null } | null;
  otp?: string | null;
  rating: { stars: number; techStars?: number | null; comment: string | null } | null;
  reopenUntil: string | null;
  /** Each item and where it is (repair flow stage 8). Optional: an older server sends none. */
  items?: { name: string; serialNo: string | null; where: string; tone: 'open' | 'wait' | 'done'; doc: string | null }[];
  actions: string[];
}
type Act = (op: string, body: Record<string, unknown>) => Promise<{ error?: string; ok?: boolean }>;

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * The same instant without the clock time - `portal.job.timestamps` off.
 *
 * Some businesses will not show a customer "arrived 14:42, left 15:10", because a
 * twenty-eight minute visit invites an argument about a call-out charge. The day
 * is still shown: hiding that as well would leave a timeline nobody can follow.
 */
const whenDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
const monthYear = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', year: 'numeric' });
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
const card = 'rounded-lg bg-card p-4 shadow-raised';
const micro = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground';
const R = 54;
const CIRC = 2 * Math.PI * R;

export function CustomerJobPanel({
  job, act, businessName, reportHref, showTimestamps = true, extra,
}: {
  job: CustomerJobVM;
  act: Act;
  businessName?: string;
  reportHref?: string;
  /**
   * `portal.job.timestamps` (wired 3 Oct 2026). Declared in the config registry
   * since F1a and read by nothing until now - it was on the PENDING_WIRING
   * burn-down. Defaults true, which is every element's own default and the
   * behaviour this panel has always had.
   */
  showTimestamps?: boolean;
  /** Shown after the product card - the portal puts the job photos here. */
  extra?: ReactNode;
}) {
  // One place decides, so a new time on this panel inherits the setting instead
  // of needing somebody to remember it.
  const at = (iso: string) => (showTimestamps ? when(iso) : whenDay(iso));
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [asking, setAsking] = useState<null | 'not_resolved' | 'decline_estimate' | 'ask_slot' | 'reopen'>(null);
  const [text, setText] = useState('');
  const [stars, setStars] = useState(0);
  const [techStars, setTechStars] = useState(0);
  const [comment, setComment] = useState('');
  const has = (a: string) => job.actions.includes(a);
  const step = customerStep(job.status);
  const cancelled = job.status === 'cancelled';
  const nextVisit = job.visits.filter((v) => v.status === 'scheduled').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
  const tech = job.technician;
  const live = job.status === 'on_the_way' || job.status === 'on_site' || job.status === 'in_progress';
  const progress = cancelled ? 0 : (step + 1) / CUSTOMER_STEPS.length;

  const run = (op: string, body: Record<string, unknown>, okText: string) => start(async () => {
    setMsg(null);
    const r = await act(op, body);
    if (r.error) { setMsg({ ok: false, text: r.error }); return; }
    setMsg({ ok: true, text: okText }); setAsking(null); setText('');
    router.refresh();
  });

  const ask = (op: NonNullable<typeof asking>, label: string, placeholder: string, button: string, okText: string) => asking === op && (
    <div className="grid gap-2">
      <label className="text-sm font-medium" htmlFor={`cj-${op}`}>{label}</label>
      <textarea id={`cj-${op}`} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder}
        className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
      <div className="flex gap-2">
        <Button variant="primary" loading={pending} disabled={!text.trim()}
          onClick={() => run(op, op === 'ask_slot' ? { preferred: text } : op === 'decline_estimate' ? { note: text } : { reason: text }, okText)}>{button}</Button>
        <Button onClick={() => { setAsking(null); setText(''); }}>Back</Button>
      </div>
    </div>
  );

  const who = tech?.name ?? 'Your technician';
  const nextLine = cancelled
    ? 'This complaint was cancelled. Raise a new one if you still need help.'
    : [
      'We have your complaint and are picking a technician.',
      nextVisit ? `${who} visits on ${at(nextVisit.scheduledAt)}.` : `${who} will call you to fix a time.`,
      nextVisit ? `${who} visits on ${at(nextVisit.scheduledAt)}.` : 'We are booking a visit for you.',
      has('approve_estimate') ? 'Please look at the estimate below - the work goes ahead once you approve.' : 'Once it is fixed, we will ask you to confirm here.',
      'Is it working now? Tell us below.',
      'All done - thank you!',
    ][step];

  const bigBtn = 'btn-lift rounded-full py-2.5 text-sm font-semibold disabled:opacity-60';

  return (
    <div className="mx-auto max-w-xl overflow-hidden rounded-xl bg-background">
      {/* ---- hero: the step in plain words, with a ring that fills ---------------- */}
      <div className="cj-hero px-5 pb-16 pt-6 text-white">
        <div className="flex items-center justify-between gap-3 text-xs opacity-90">
          <span className="truncate">{businessName ?? ''}</span>
          {job.siteLocation && <span className="truncate" data-no-translate>{job.siteLocation}</span>}
        </div>
        <div className="mt-5 flex items-center gap-5" key={job.status}>
          <svg width="112" height="112" viewBox="0 0 128 128" className="shrink-0 -rotate-90" aria-hidden="true">
            <circle cx="64" cy="64" r={R} fill="none" stroke="rgb(255 255 255 / .2)" strokeWidth="10" />
            <circle className="cj-ring" cx="64" cy="64" r={R} fill="none" stroke="white" strokeWidth="10" strokeLinecap="round"
              strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - progress)} style={{ ['--len' as string]: CIRC }} />
          </svg>
          <div className="cj-rise min-w-0">
            <p className="font-mono text-xs uppercase tracking-wider opacity-80" data-no-translate>{job.complaintNo}</p>
            <h1 className="text-2xl font-bold leading-tight">{job.statusLabel}</h1>
            {!cancelled && <p className="mt-1 text-sm opacity-90">Step {step + 1} of {CUSTOMER_STEPS.length}</p>}
          </div>
        </div>
      </div>

      <div className="cj-stagger -mt-10 grid gap-3 px-3 pb-6 sm:px-4" key={`b-${job.status}`}>
        {msg && <p role="status" className={`rounded-lg px-3 py-2 text-sm shadow-raised ${msg.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>{msg.text}</p>}

        {/* ---- the technician, as a person ------------------------------------- */}
        {(tech || nextVisit) && (
          <div className={card}>
            {tech && (
              <div className="flex items-center gap-3">
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand/10 text-lg font-bold text-on-tint-brand ${live ? 'cj-pulse' : ''}`} data-no-translate>
                  {initials(tech.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold" data-no-translate>{tech.name}</p>
                  <p className="text-xs text-muted-foreground">your technician</p>
                </div>
                {tech.phone && (
                  <>
                    <a href={`tel:${tech.phone}`} aria-label={`Call ${tech.name}`} className="btn-lift flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-on-tint-brand">
                      <Icon name="phone" className="h-4 w-4" />
                    </a>
                    <a href={whatsappLink(tech.phone, `Hello, about my complaint ${safeDocNo(job.complaintNo)}`)} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${tech.name}`}
                      className="btn-lift flex h-10 w-10 items-center justify-center rounded-full bg-wa/10 text-wa">
                      <Icon name="whatsapp" className="h-4 w-4" />
                    </a>
                  </>
                )}
              </div>
            )}
            {tech && live && (
              <p className="mt-3 flex items-center gap-2 rounded-sm bg-brand/5 px-3 py-2 text-sm text-on-tint-brand">
                <span className="cj-pulse h-2 w-2 shrink-0 rounded-full bg-brand" />
                {job.status === 'on_the_way'
                  ? 'On the way to you now'
                  : job.onSiteSince && showTimestamps ? `Working on it at your site since ${clock(job.onSiteSince)}` : 'Working on it at your site now'}
              </p>
            )}
            {nextVisit && (
              <p className={`flex items-center gap-2 text-sm ${tech ? 'mt-3' : ''}`}>
                <Icon name="calendar" className="h-4 w-4 text-brand" />Visit: <strong>{at(nextVisit.scheduledAt)}</strong>
              </p>
            )}
          </div>
        )}

        {/* ---- what happens next, and the one thing to do ---------------------- */}
        <div className={card}>
          <p className={micro}>What happens next</p>
          <p className="mt-1 text-sm">{nextLine}</p>

          {has('approve_estimate') && job.estimate && (
            <div className="mt-3 grid gap-2">
              <table className="w-full text-sm">
                <tbody>
                  {job.estimate.lines.map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="py-1">{l.description}{l.qty > 1 ? ` × ${l.qty}` : ''}</td>
                      <td className="py-1 text-end tabular-nums">{rupees(l.qty * l.unitPaise)}</td>
                    </tr>
                  ))}
                  {/* The total includes GST (28 Sep 2026) - show it, so the bill matches. */}
                  {job.estimate.totalPaise > job.estimate.lines.reduce((s, l) => s + l.qty * l.unitPaise, 0) && (
                    <tr><td className="pt-1 text-muted-foreground">GST</td><td className="pt-1 text-end tabular-nums text-muted-foreground">{rupees(job.estimate.totalPaise - job.estimate.lines.reduce((s, l) => s + l.qty * l.unitPaise, 0))}</td></tr>
                  )}
                  <tr><td className="pt-2 font-semibold">Total</td><td className="pt-2 text-end font-semibold tabular-nums">{rupees(job.estimate.totalPaise)}</td></tr>
                </tbody>
              </table>
              {job.estimate.note && <p className="text-sm text-muted-foreground">{job.estimate.note}</p>}
              {!asking && (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={pending} onClick={() => run('approve_estimate', {}, 'Approved - the work will go ahead.')} className={`${bigBtn} bg-success text-white`}>Approve</button>
                  <button type="button" disabled={pending} onClick={() => setAsking('decline_estimate')} className={`${bigBtn} bg-muted`}>Decline</button>
                </div>
              )}
              {ask('decline_estimate', 'Why are you declining?', 'Too costly / I will think about it…', 'Decline estimate', 'Declined - the technician will wrap up without that work.')}
            </div>
          )}

          {has('confirm') && (
            <div className="mt-3 grid gap-2">
              {job.otp && (
                <div className="rounded-lg bg-brand/10 p-3 text-center">
                  <p className="text-sm">If it is working, give your technician this code:</p>
                  <p className="font-mono text-3xl font-bold tracking-[0.3em] text-brand">{job.otp}</p>
                  <p className="text-xs text-muted-foreground">Valid for 30 minutes. Only share it once you are happy with the work.</p>
                </div>
              )}
              {!asking && (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={pending} onClick={() => run('confirm', {}, 'Thank you - please rate the work below.')} className={`${bigBtn} bg-success text-white`}>Yes, it works</button>
                  <button type="button" disabled={pending} onClick={() => setAsking('not_resolved')} className={`${bigBtn} bg-muted`}>Not yet</button>
                </div>
              )}
              {ask('not_resolved', 'What is still wrong?', 'The light still flickers after 10 minutes…', 'Send', 'Sent - the technician will come back to it.')}
            </div>
          )}
        </div>

        {/* ---- where each item is - once something has left the site (stage 8) */}
        {job.items && job.items.some((i) => i.tone !== 'open') && (
          <div className={card}>
            <p className={`${micro} mb-2`}>Your items</p>
            <ul className="grid gap-2">
              {job.items.map((i, n) => (
                <li key={n} className="flex items-start gap-2 text-sm">
                  <Icon name={i.tone === 'done' ? 'check-circle' : i.tone === 'wait' ? 'clock' : 'box'} className={`mt-0.5 h-4 w-4 shrink-0 ${i.tone === 'done' ? 'text-success' : i.tone === 'wait' ? 'text-warning' : 'text-muted-foreground'}`} />
                  <span className="min-w-0">
                    <span className="font-medium" data-no-translate>{i.name}</span>
                    {i.serialNo && <span className="ms-1.5 font-mono text-xs text-muted-foreground" data-no-translate>{i.serialNo}</span>}
                    <span className="block text-muted-foreground">{i.where}</span>
                    {i.doc && <span className="block font-mono text-xs text-muted-foreground" data-no-translate>{i.doc}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- the product --------------------------------------------------- */}
        <div className={card}>
          <p className={micro}>Your {job.productName ? 'product' : 'complaint'}</p>
          <div className="mt-1 flex items-center gap-3">
            <span className="cj-float flex h-11 w-11 shrink-0 items-center justify-center rounded-sm bg-muted"><Icon name="box" className="h-5 w-5 text-muted-foreground" /></span>
            <div className="min-w-0 text-sm">
              {job.productName && <p className="font-semibold" data-no-translate>{job.productName}</p>}
              <p className={job.productName ? 'text-xs text-muted-foreground' : ''}>{job.description}</p>
              {job.warrantyUntil && (new Date(job.warrantyUntil).getTime() > Date.now()
                ? <p className="text-xs text-success">Under warranty till {monthYear(job.warrantyUntil)}</p>
                : <p className="text-xs text-muted-foreground">Warranty ended {monthYear(job.warrantyUntil)}</p>)}
            </div>
          </div>
        </div>

        {extra}

        {/* ---- rate the visit ------------------------------------------------ */}
        {has('rate') && (
          <div className={`${card} cj-pop grid gap-3 text-center`}>
            <p className="text-sm font-semibold">How was the visit?</p>
            <StarRow label="The work" value={stars} onChange={setStars} />
            {tech && <StarRow label={`Your technician, ${tech.name}`} value={techStars} onChange={setTechStars} />}
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything to add? (optional)" aria-label="Comment"
              className="rounded-lg border border-border bg-background px-3 py-2 text-start text-sm" />
            <div><Button variant="primary" loading={pending} disabled={!stars} onClick={() => run('rate', { stars, techStars: techStars || null, comment }, 'Thank you for the rating.')}>Send rating</Button></div>
          </div>
        )}
        {job.rating && (
          <p className="text-center text-sm text-muted-foreground">
            You rated the work <span className="text-warning">{'★'.repeat(job.rating.stars)}</span>{job.rating.techStars ? <> and the technician <span className="text-warning">{'★'.repeat(job.rating.techStars)}</span></> : ''} - thank you.
          </p>
        )}
        {reportHref && ['resolved', 'closed'].includes(job.status) && (
          <p className="text-center text-sm"><a href={reportHref} className="font-medium text-brand hover:underline">Service report</a> <span className="text-muted-foreground">(print or save as PDF)</span></p>
        )}

        {/* ---- timeline that draws in ---------------------------------------- */}
        {job.timeline.length > 0 && (
          <div className={card}>
            <p className={`${micro} mb-2`}>Timeline</p>
            <ol className="cj-stagger space-y-3 border-s-2 border-border ps-4">
              {job.timeline.slice(0, 30).map((t) => (
                <li key={t.id} className="relative">
                  <span className="absolute -start-[23px] top-1 h-3 w-3 rounded-full border-2 border-card bg-brand" />
                  <p className="text-sm">{t.body ?? (t.statusTo ? `Now: ${t.statusTo.replace(/_/g, ' ')}` : '')}</p>
                  <p className="text-xs text-muted-foreground">{at(t.createdAt)}</p>
                </li>
              ))}
            </ol>
          </div>
        )}

        {(has('ask_slot') || has('reopen')) && !asking && (
          <div className="grid gap-2">
            {has('ask_slot') && <button type="button" onClick={() => setAsking('ask_slot')} className={`${bigBtn} border border-border bg-card`}>Ask for another visit time</button>}
            {has('reopen') && <button type="button" onClick={() => setAsking('reopen')} className={`${bigBtn} border border-border bg-card`}>The problem came back</button>}
          </div>
        )}
        {(asking === 'ask_slot' || asking === 'reopen') && (
          <div className={card}>
            {ask('ask_slot', 'Which day and time suit you?', 'Saturday after 4 pm…', 'Send request', 'Sent - we will confirm the new time.')}
            {ask('reopen', 'What went wrong again?', 'It stopped working again on…', 'Reopen job', 'Reopened - the technician has been told.')}
          </div>
        )}
      </div>
    </div>
  );
}

/** One row of 1-5 stars (the work, the technician). */
function StarRow({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div className="grid justify-items-center gap-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => onChange(n)}
            className={`text-3xl leading-none transition hover:scale-125 ${n <= value ? 'text-warning' : 'text-muted-foreground/40'}`}>★</button>
        ))}
      </div>
    </div>
  );
}
