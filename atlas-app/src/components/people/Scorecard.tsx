'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PERIODS, type PeriodKey } from '@/lib/scorecard/period';
import type { ScorecardView } from '@/server/scorecard';
import { addScoreNoteAction, clearMissAction } from '@/app/(app)/hrm/employees/[id]/actions';

/**
 * THE SCORECARD (31 Oct 2026): the employee page's main block. Score and rank,
 * the pillars against the team, every metric with where it comes from, the
 * jobs and edits behind the numbers, distance per day, the reward check and
 * the history. Spec: "Vcare Scorecard: Technician and Office Tracking Spec".
 */

type View = ScorecardView;
type Metric = View['metrics'][number];

const fmt = (m: { value: number | null; unit: Metric['unit'] }) => {
  if (m.value === null) return '-';
  switch (m.unit) {
    case 'min': return m.value >= 120 ? `${Math.round(m.value / 6) / 10} h` : `${Math.round(m.value)} min`;
    case 'hours': return `${m.value} h`;
    case 'pct': return `${Math.round(m.value)}%`;
    case 'stars': return `${m.value} ★`;
    case 'rate': return `${m.value} / 100`;
    default: return String(m.value);
  }
};
const tone = (s: number | null) => (s === null ? 'bg-border' : s >= 70 ? 'bg-success' : s >= 40 ? 'bg-warning' : 'bg-danger');
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });

export function Scorecard({ view: v, canManage, basePath }: { view: View; canManage: boolean; basePath: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState<{ ruleKey: string; refId: string; text: string } | null>(null);
  const [noting, setNoting] = useState<'reward' | 'note' | null>(null);
  const [openPillar, setOpenPillar] = useState<string | null>(null);
  const delta = v.overall !== null && v.previous !== null ? v.overall - v.previous : null;
  const misses = v.evidence.filter((e) => e.ruleKey);
  const facts = v.evidence.filter((e) => !e.ruleKey);
  const maxKm = Math.max(1, ...(v.distance ?? []).map((d) => d.km ?? 0));

  const act = (fn: () => Promise<{ error?: string }>, done: () => void) => start(async () => {
    setError(null);
    const r = await fn();
    if (r.error) { setError(r.error); return; }
    done();
    router.refresh();
  });

  return (
    <div className="grid gap-4">
      {/* Score band */}
      <section className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
        <div className="grid h-20 w-20 place-items-center rounded-full" style={{ background: `conic-gradient(hsl(var(--brand)) ${(v.overall ?? 0) * 3.6}deg, hsl(var(--surface)) 0)` }}>
          <div className="grid h-16 w-16 place-items-center rounded-full bg-card text-2xl font-bold tabular-nums">{v.overall ?? '-'}</div>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{v.template === 'field' ? 'Technician scorecard' : 'Office scorecard'} · {v.period.label}</p>
          <p className="text-lg font-semibold">
            {v.rank ? `#${v.rank} of ${v.peers.filter((p) => p.rank).length} ${v.template === 'field' ? 'technicians' : 'office staff'}` : v.overall === null ? 'Not enough data for a score yet' : 'Not ranked'}
          </p>
          <p className="text-sm text-muted-foreground">
            {delta === null ? 'No score for the period before.' : <span className={delta >= 0 ? 'text-success' : 'text-danger'}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} vs the period before</span>}
          </p>
        </div>
        <nav aria-label="Period" className="flex flex-wrap gap-1.5">
          {(Object.keys(PERIODS) as PeriodKey[]).map((k) => (
            <Link key={k} href={`${basePath}?period=${k}`} scroll={false}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${k === v.period.key ? 'border-brand bg-brand text-brand-fg' : 'border-border hover:border-brand'}`}>
              {PERIODS[k]}
            </Link>
          ))}
        </nav>
      </section>
      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>}

      {/* Pillars and their metrics */}
      <SectionCard title="How the score is made" icon="bar-chart">
        <p className="mb-3 text-xs text-muted-foreground">Each number is ranked against the team for the same period; the bar is this person, the tick is the team&apos;s middle. Tap a pillar for its numbers and where they come from.</p>
        <div className="grid gap-2">
          {v.pillars.map((p) => {
            const open = openPillar === p.key;
            const rows = v.metrics.filter((m) => m.pillar === p.key);
            return (
              <div key={p.key} className="rounded-lg border border-border">
                <button type="button" onClick={() => setOpenPillar(open ? null : p.key)} aria-expanded={open}
                  className="grid w-full grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left">
                  <span className="text-sm font-semibold">{p.label} <span className="font-normal text-muted-foreground">· {p.weight}%</span></span>
                  <span className="relative h-2 rounded-full bg-muted">
                    <span className={`absolute inset-y-0 left-0 rounded-full ${tone(p.score)}`} style={{ width: `${p.score ?? 0}%` }} />
                    {p.median !== null && <span className="absolute -top-1 h-4 w-0.5 bg-foreground/60" style={{ left: `${p.median}%` }} title={`Team middle ${p.median}`} />}
                  </span>
                  <span className="w-20 text-right text-sm font-semibold tabular-nums">{p.score ?? <span className="text-xs font-normal text-muted-foreground">Not enough data</span>}</span>
                </button>
                {open && (
                  <div className="overflow-x-auto border-t border-border">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 font-semibold">Metric</th><th className="px-3 py-2 text-right font-semibold">This person</th>
                        <th className="px-3 py-2 text-right font-semibold">Team middle</th><th className="px-3 py-2 text-right font-semibold">Score</th>
                      </tr></thead>
                      <tbody>{rows.map((m) => (
                        <tr key={m.key} className="border-t border-border align-top">
                          <td className="px-3 py-2"><p className="font-medium">{m.label}</p><p className="text-xs text-muted-foreground">{m.hint}</p><p className="font-mono text-[11px] text-muted-foreground">{m.source}{m.n > 0 && m.n < 99 ? ` · ${m.n} counted` : ''}</p></td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(m)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt({ value: m.median, unit: m.unit })}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{m.score ?? <span className="text-xs text-muted-foreground">{m.value === null ? 'No data' : 'Too few'}</span>}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {v.template === 'office' && <p className="mt-3 text-xs text-muted-foreground">Fixed other people&apos;s entries this period: <b className="text-foreground">{v.fixes}</b> (counted in this person&apos;s favour, never against them).</p>}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Misses that count, each clearable by a manager */}
        <SectionCard title={`Needs a word (${misses.length})`} icon="alert-triangle">
          {misses.length === 0 ? <p className="text-sm text-muted-foreground">Nothing counted against this person in the period.</p> : (
            <ul className="grid max-h-80 gap-2 overflow-y-auto pr-1 text-sm">
              {misses.map((e) => (
                <li key={`${e.ruleKey}-${e.refId}`} className="flex items-start justify-between gap-2 rounded-lg border border-border px-3 py-2">
                  <span className="min-w-0">
                    <span className={`mr-1.5 inline-block rounded-full px-1.5 text-[11px] font-semibold ${e.weight >= 2 ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}>{e.weight >= 2 ? 'Mistake' : 'Miss'}</span>
                    {e.text}
                    <span className="block text-xs text-muted-foreground"><Link href={e.href} className="text-brand hover:underline">{e.refNo}</Link> · {day(e.at)}</span>
                  </span>
                  {canManage && <button type="button" className="shrink-0 text-xs font-medium text-brand hover:underline" onClick={() => setClearing({ ruleKey: e.ruleKey!, refId: e.refId, text: e.text })}>Not a mistake</button>}
                </li>
              ))}
            </ul>
          )}
          {v.cleared.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{v.cleared.length} cleared by a manager · latest: &quot;{v.cleared[0]!.reason}&quot; by {v.cleared[0]!.by}</p>}
        </SectionCard>

        {/* Distance per day (field) or the work behind the numbers */}
        {v.distance ? (
          <SectionCard title="Distance on the road · last 14 days" icon="map-pin">
            <div className="flex h-36 items-end gap-1" role="img" aria-label="Kilometres per day">
              {v.distance.map((d) => (
                <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${day(d.day)}: ${d.km ?? 0} km`}>
                  <span className="text-[10px] tabular-nums text-muted-foreground">{d.km ? Math.round(d.km) : ''}</span>
                  <span className={`w-full rounded-sm ${d.km ? 'bg-brand' : 'bg-danger/60'}`} style={{ height: `${d.km ? Math.max(4, (d.km / maxKm) * 100) : 2}px` }} />
                  <span className="text-[10px] text-muted-foreground">{d.day.slice(8)}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Total {Math.round(v.distance.reduce((a, d) => a + (d.km ?? 0), 0))} km. Red = 0 on that day (off, or the phone stopped sending). Only readings accurate to 50 m count, so this is a floor. The day&apos;s trail is in <Link href="/attendance/shifts" className="text-brand hover:underline">Shift log</Link>.</p>
          </SectionCard>
        ) : (
          <SectionCard title={`Work behind the numbers (${facts.length})`} icon="file-text">
            {facts.length === 0 ? <p className="text-sm text-muted-foreground">No jobs or documents in the period.</p> : (
              <ul className="grid max-h-80 gap-1.5 overflow-y-auto pr-1 text-sm">
                {facts.map((e) => <li key={`${e.metric}-${e.refId}`} className="flex justify-between gap-2"><Link href={e.href} className="truncate text-brand hover:underline">{e.refNo}</Link><span className="shrink-0 text-xs text-muted-foreground">{e.text} · {day(e.at)}</span></li>)}
              </ul>
            )}
          </SectionCard>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Reward check" icon="sparkles" action={canManage ? <Button size="sm" variant="primary" onClick={() => setNoting('reward')}>Give a reward</Button> : undefined}>
          <ul className="grid gap-2 text-sm">
            {v.rewards.map((r) => (
              <li key={r.label} className="flex items-center gap-2">
                <span className={`w-4 font-bold ${r.ok === null ? 'text-muted-foreground' : r.ok ? 'text-success' : 'text-danger'}`}>{r.ok === null ? '–' : r.ok ? '✓' : '✕'}</span>
                <span className="flex-1">{r.label}</span><span className="font-semibold tabular-nums">{r.value}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Rules are set in <Link href="/settings/scorecards" className="text-brand hover:underline">Settings › Scorecards</Link>.</p>
        </SectionCard>

        <SectionCard title={v.template === 'field' ? 'Among technicians' : 'Among office staff'} icon="users">
          <ol className="grid gap-1 text-sm">
            {v.peers.slice(0, 12).map((p) => (
              <li key={p.id} className={`flex justify-between gap-2 rounded px-2 py-1 ${p.id === v.person.id ? 'bg-brand/10 font-semibold' : ''}`}>
                <Link href={`/hrm/employees/${p.id}?period=${v.period.key}`} className="truncate hover:underline">{p.rank ? `${p.rank}. ` : ''}{p.name}</Link>
                <span className="tabular-nums">{p.overall ?? '-'}</span>
              </li>
            ))}
          </ol>
        </SectionCard>

        <SectionCard title="History" icon="clock" action={canManage ? <Button size="sm" onClick={() => setNoting('note')}>Add a note</Button> : undefined}>
          {v.notes.length === 0 ? <p className="text-sm text-muted-foreground">No rewards or notes yet.</p> : (
            <ul className="grid gap-2 text-sm">
              {v.notes.map((n, i) => (
                <li key={i} className="border-b border-border pb-2 last:border-0">
                  <span className="text-xs text-muted-foreground">{day(n.at)} · {n.by} · {n.kind === 'reward' ? 'Reward' : 'Note'}{n.amountPaise ? ` · ₹${(n.amountPaise / 100).toLocaleString('en-IN')}` : ''}</span>
                  <p>{n.body}</p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Not measured yet" icon="info">
        <ul className="grid gap-1 text-sm text-muted-foreground">{v.notMeasured.map((t) => <li key={t}>• {t}</li>)}</ul>
      </SectionCard>

      {clearing && <ClearDialog busy={pending} text={clearing.text} onClose={() => setClearing(null)}
        onSave={(reason) => act(() => clearMissAction(v.person.id, clearing.ruleKey, clearing.refId, reason), () => setClearing(null))} />}
      {noting && <NoteDialog kind={noting} busy={pending} onClose={() => setNoting(null)}
        onSave={(body, amount) => act(() => addScoreNoteAction(v.person.id, noting, body, amount), () => setNoting(null))} />}
    </div>
  );
}

function ClearDialog({ text, busy, onClose, onSave }: { text: string; busy: boolean; onClose: () => void; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Not a mistake" subtitle={text} icon="check-circle" size="md" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!reason.trim()} onClick={() => onSave(reason)}>Clear it</Button></>}>
      <label className="grid gap-1 text-sm" htmlFor="clear-reason">Why (kept with your name)
        <textarea id="clear-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className="field-input" placeholder="Customer asked for the change" />
      </label>
    </Modal>
  );
}

function NoteDialog({ kind, busy, onClose, onSave }: { kind: 'reward' | 'note'; busy: boolean; onClose: () => void; onSave: (body: string, amount: number | null) => void }) {
  const [body, setBody] = useState('');
  const [amount, setAmount] = useState('');
  return (
    <Modal title={kind === 'reward' ? 'Give a reward' : 'Add a note'} subtitle={kind === 'reward' ? 'Recorded on the scorecard. Pay it through Payroll as usual.' : 'Private to managers who can see this scorecard.'} icon={kind === 'reward' ? 'sparkles' : 'pencil'} size="md" onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!body.trim()} onClick={() => onSave(body, amount ? Number(amount) : null)}>Save</Button></>}>
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm" htmlFor="note-body">{kind === 'reward' ? 'What it is for' : 'Note'}
          <textarea id="note-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} className="field-input" />
        </label>
        {kind === 'reward' && (
          <label className="grid gap-1 text-sm" htmlFor="note-amount">Amount (₹, optional)
            <input id="note-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="field-input w-40" />
          </label>
        )}
      </div>
    </Modal>
  );
}
