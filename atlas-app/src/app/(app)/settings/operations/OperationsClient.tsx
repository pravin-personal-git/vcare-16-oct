'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { Badge } from '@/components/ui/Layout';
import { OP_DOCUMENTS, OP_GROUPS, type OpDocument } from '@/lib/operations-catalogue';
import { ROLE_MODULES, type ModuleLevel, type RoleModule } from '@/lib/role-modules';
import { initials } from '@/lib/revenue';
import type { PersonAccess } from '@/server/user-access';
import { saveAccessAction } from './actions';

/**
 * Operations & approvals (30 Oct 2026). Each person's access as plain
 * switches - saved. Approvals for every action on every document - shown,
 * saved in the next step (plan step B).
 */

type Person = PersonAccess;
const OWNER_LOCKED = ['settings', 'users'];
type Approver = 'owner' | 'manager' | 'role';
type Access = { view: boolean; edit: boolean; approve: boolean };

const APPROVER: Record<Approver, string> = { owner: 'Owner', manager: 'Uska manager', role: 'Senior Manager' };

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-30 ${on ? 'bg-brand' : 'bg-border'}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-card shadow-raised transition-transform duration-200 ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

const fromLevel = (l: ModuleLevel): Access => ({ view: l !== 'none', edit: l === 'edit' || l === 'approve', approve: l === 'approve' });
const same = (a: Access, b: Access) => a.view === b.view && a.edit === b.edit && a.approve === b.approve;

export function OperationsClient({ rules, people, meId }: { rules: Record<string, boolean>; people: Person[]; meId: string }) {
  const [tab, setTab] = useState<'approvals' | 'access'>('approvals');
  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h1 font-bold">Operations &amp; approvals</h1>
          <p className="mt-1 text-sm text-muted-foreground">Ek jagah se: kis kaam pe approval chahiye, aur kaun kya dekh, badal ya approve kar sakta hai.</p>
        </div>
        <div role="tablist" aria-label="Section" className="flex gap-1 rounded-full bg-card p-1">
          {([['approvals', 'Approvals', 'shield-check'], ['access', 'Kaun kya kar sakta hai', 'users']] as const).map(([k, l, ic]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ${tab === k ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted'}`}>
              <Icon name={ic} className="h-4 w-4" />{l}
            </button>
          ))}
        </div>
      </header>
      {tab === 'approvals' && (
        <p className="flex items-center gap-2 rounded-xl bg-warning/10 px-4 py-2.5 text-sm text-on-tint-warning">
          <Icon name="info" className="h-4 w-4 shrink-0" />Approvals ke switch abhi save nahi hote - yeh agla kadam hai. &ldquo;Kaun kya kar sakta hai&rdquo; save hota hai.
        </p>
      )}
      {tab === 'approvals' ? <Approvals rules={rules} /> : <AccessPanel people={people} meId={meId} />}
    </div>
  );
}

// ================================================================ approvals
function Approvals({ rules }: { rules: Record<string, boolean> }) {
  const all = OP_DOCUMENTS.flatMap((d) => d.actions.map((a) => ({ d, a, id: `${d.key}.${a.key}` })));
  // What the business asked for: everything waits for a yes, the owner says it.
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(all.map((x) => [x.id, true])));
  const [who, setWho] = useState<Record<string, Approver>>({});
  const [def, setDef] = useState<Approver>('owner');
  const today = (type?: string) => (!type ? 'new' : rules[type] === true ? 'on' : rules[type] === false ? 'off' : 'unset');
  const count = {
    total: all.length,
    on: all.filter((x) => on[x.id]).length,
    liveToday: all.filter((x) => today(x.a.type) === 'on').length,
    toBuild: all.filter((x) => !x.a.type).length,
  };
  const setAll = (v: boolean) => setOn(Object.fromEntries(all.map((x) => [x.id, v])));

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-4">
        {[
          ['Kul kaam', count.total, 'har document ka har kaam'],
          ['Approval on', count.on, 'is page pe'],
          ['Aaj sach mein lagta hai', count.liveToday, 'Vcare ke saved niyam'],
          ['Naya banana padega', count.toBuild, 'engine abhi rok nahi sakta'],
        ].map(([l, n, s]) => (
          <div key={l as string} className="rounded-2xl bg-card px-5 py-4">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="mt-1 font-num text-num tabular-nums">{n}</p>
            <p className="text-xs text-muted-foreground">{s}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-2xl bg-card px-5 py-3.5">
        <span className="text-sm font-semibold">Sab ek saath:</span>
        <button type="button" onClick={() => setAll(true)} className="h-8 rounded-full bg-foreground px-3 text-xs font-semibold text-background transition active:scale-[0.98]">Sab pe approval</button>
        <button type="button" onClick={() => setAll(false)} className="h-8 rounded-full bg-muted px-3 text-xs font-semibold transition hover:bg-border">Sab band</button>
        <span className="ms-auto flex flex-wrap items-center gap-2 text-sm">
          Approve karega
          <span className="flex gap-1 rounded-full bg-muted p-1">
            {(Object.keys(APPROVER) as Approver[]).map((a) => (
              <button key={a} type="button" aria-pressed={def === a} onClick={() => setDef(a)}
                className={`h-7 rounded-full px-3 text-xs font-medium transition ${def === a ? 'bg-card shadow-raised' : 'hover:bg-border'}`}>{APPROVER[a]}</button>
            ))}
          </span>
        </span>
      </section>

      {OP_GROUPS.map((g) => (
        <section key={g} aria-label={g} className="space-y-2">
          <h2 className="px-1 text-title font-semibold">{g}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {OP_DOCUMENTS.filter((d) => d.group === g).map((d) => (
              <DocCard key={d.key} d={d} on={on} setOn={setOn} who={who} setWho={setWho} def={def} today={today} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const TODAY: Record<string, { label: string; tone: 'success' | 'neutral' | 'warning' | 'danger' }> = {
  on: { label: 'Aaj: approval lagta hai', tone: 'success' },
  off: { label: 'Aaj: niyam se band', tone: 'warning' },
  unset: { label: 'Aaj: bina approval', tone: 'neutral' },
  new: { label: 'Naya banana hoga', tone: 'danger' },
};

function DocCard({ d, on, setOn, who, setWho, def, today }: {
  d: OpDocument; on: Record<string, boolean>; setOn: (f: (x: Record<string, boolean>) => Record<string, boolean>) => void;
  who: Record<string, Approver>; setWho: (f: (x: Record<string, Approver>) => Record<string, Approver>) => void;
  def: Approver; today: (t?: string) => string;
}) {
  const ids = d.actions.map((a) => `${d.key}.${a.key}`);
  const allOn = ids.every((id) => on[id]);
  return (
    <article className="rounded-2xl bg-card">
      <header className="flex items-center gap-3 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{d.label} <span className="font-normal text-muted-foreground">· {d.sample}</span></h3>
          <p className="text-xs text-muted-foreground">{ids.filter((id) => on[id]).length} / {ids.length} kaam pe approval</p>
        </div>
        <Switch on={allOn} label={`${d.label}: saare kaam`} onChange={(v) => setOn((x) => ({ ...x, ...Object.fromEntries(ids.map((id) => [id, v])) }))} />
      </header>
      <ul className="mt-2 pb-2">
        {d.actions.map((a) => {
          const id = `${d.key}.${a.key}`;
          const t = TODAY[today(a.type)];
          return (
            <li key={id} className="flex items-center gap-3 px-5 py-2 transition-colors hover:bg-muted/40">
              <div className="min-w-0 flex-1">
                <p className="text-sm">{a.label}</p>
                <Badge tone={t.tone}>{t.label}</Badge>
              </div>
              {on[id] && (
                <label className="sr-only" htmlFor={`who-${id}`}>Approve kaun karega</label>
              )}
              {on[id] && (
                <select id={`who-${id}`} value={who[id] ?? def} onChange={(e) => setWho((x) => ({ ...x, [id]: e.target.value as Approver }))}
                  className="h-8 rounded-full bg-muted px-2.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  {(Object.keys(APPROVER) as Approver[]).map((k) => <option key={k} value={k}>{APPROVER[k]}</option>)}
                </select>
              )}
              <Switch on={!!on[id]} label={`${d.label}: ${a.label} - approval`} onChange={(v) => setOn((x) => ({ ...x, [id]: v }))} />
            </li>
          );
        })}
      </ul>
    </article>
  );
}

// =================================================================== access
const GROUPS = [...new Set(ROLE_MODULES.map((m) => m.group))];

function AccessPanel({ people, meId }: { people: Person[]; meId: string }) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Saved state: the person's own level where there is one, else their roles'.
  const base = useMemo(() => Object.fromEntries(people.map((p) => [p.id, Object.fromEntries(ROLE_MODULES.map((m) => [m.key, fromLevel(p.own[m.key] ?? p.role[m.key])]))])), [people]) as Record<string, Record<string, Access>>;
  const roleOf = (p: Person, key: string) => fromLevel(p.role[key]);
  const [cur, setCur] = useState(base);
  const locked = (p: Person, m: RoleModule) => p.id === meId || (p.isOwner && OWNER_LOCKED.includes(m.key));
  const save = () => startSave(async () => {
    const changes = people.flatMap((p) => ROLE_MODULES.filter((m) => !same(cur[p.id][m.key], base[p.id][m.key])).map((m) => ({ userId: p.id, moduleKey: m.key, level: levelOf(cur[p.id][m.key]) as ModuleLevel })));
    const r = await saveAccessAction(changes);
    if ('error' in r) { setMsg({ ok: false, text: r.error }); return; }
    setMsg({ ok: true, text: `${r.saved} badlav save ho gaye. Agli baar page kholne pe unhe naya access milega.` });
    router.refresh();
  });
  const [pick, setPick] = useState(people[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [grid, setGrid] = useState(false);
  const person = people.find((p) => p.id === pick);
  const changed = people.reduce((n, p) => n + ROLE_MODULES.filter((m) => !same(cur[p.id][m.key], base[p.id][m.key])).length, 0);
  const tally = (id: string) => Object.values(cur[id] ?? {}).reduce((t, a) => ({ view: t.view + +a.view, edit: t.edit + +a.edit, approve: t.approve + +a.approve }), { view: 0, edit: 0, approve: 0 });
  const set = (pid: string, m: RoleModule, k: keyof Access, v: boolean) => setCur((c) => {
    const a = { ...c[pid][m.key], [k]: v };
    // Badalna needs dekhna; approve needs badalna. Turning one off takes the higher ones with it.
    if (k === 'view' && !v) { a.edit = false; a.approve = false; }
    if (k === 'edit') { if (v) a.view = true; else a.approve = false; }
    if (k === 'approve' && v) { a.view = true; a.edit = true; }
    return { ...c, [pid]: { ...c[pid], [m.key]: a } };
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setGrid(false)} aria-pressed={!grid} className={`h-8 rounded-full px-3 text-xs font-semibold transition ${!grid ? 'bg-foreground text-background' : 'bg-card hover:bg-muted'}`}>Ek aadmi</button>
        <button type="button" onClick={() => setGrid(true)} aria-pressed={grid} className={`h-8 rounded-full px-3 text-xs font-semibold transition ${grid ? 'bg-foreground text-background' : 'bg-card hover:bg-muted'}`}>Sab ek nazar mein</button>
        {changed > 0 && (
          <span className="ms-auto flex items-center gap-2 text-sm">
            <span className="tabular-nums">{changed} badlav</span>
            <button type="button" onClick={() => setCur(base)} className="h-8 rounded-full bg-muted px-3 text-xs font-semibold hover:bg-border">Wapas jaisa tha</button>
            <button type="button" onClick={save} disabled={saving} className="h-8 rounded-full bg-brand px-4 text-xs font-semibold text-brand-fg transition hover:bg-brand-hover disabled:opacity-50">{saving ? 'Save ho raha hai…' : 'Save'}</button>
          </span>
        )}
      </div>

      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-xl px-4 py-2.5 text-sm ${msg.ok ? 'bg-success/10 text-on-tint-success' : 'bg-danger/10 text-on-tint-danger'}`}>{msg.text}</p>}
      {grid ? <Matrix people={people} cur={cur} base={base} onOpen={(id) => { setPick(id); setGrid(false); }} /> : (
        <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
          <aside className="rounded-2xl bg-card p-3" aria-label="Log">
            <label htmlFor="ops-q" className="sr-only">Naam dhoondho</label>
            <input id="ops-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Naam dhoondho…"
              className="h-10 w-full rounded-full bg-muted/70 px-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand" />
            <ul className="thin-scroll mt-2 max-h-[240px] space-y-0.5 xl:max-h-[560px] overflow-y-auto">
              {people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map((p) => {
                const t = tally(p.id);
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => setPick(p.id)} aria-current={pick === p.id}
                      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start transition ${pick === p.id ? 'bg-brand/10' : 'hover:bg-muted'}`}>
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold">{initials(p.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{p.roles.join(', ')}</span>
                      </span>
                      <span className="text-end text-[11px] leading-tight text-muted-foreground tabular-nums">{t.view} dekhe<br />{t.edit} badle</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {person && (
            <section className="space-y-3" aria-label={person.name}>
              <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-card px-5 py-4">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-brand/10 text-sm font-bold text-on-tint-brand">{initials(person.name)}</span>
                <div className="min-w-[14rem] flex-1">
                  <h2 className="text-lg font-semibold">{person.name}</h2>
                  <p className="text-xs text-muted-foreground">{person.id === meId
                    ? 'Yeh aap hain - apni access khud nahi badal sakte, kisi aur owner se karwaiye.'
                    : <>Role: {person.roles.join(', ')}{person.isOwner ? ' (owner - Settings aur Users role se hi)' : ''} · role se jo milta hai woh pehle se on hai; jo yahan badlega woh sirf {person.name.split(' ')[0]} ke liye hoga</>}</p>
                </div>
                {(() => { const t = tally(person.id); return (
                  <div className="flex gap-4 text-center">
                    {[['Dekh sakta', t.view], ['Badal sakta', t.edit], ['Approve', t.approve]].map(([l, n]) => (
                      <div key={l as string}><p className="font-num text-xl font-semibold tabular-nums">{n}</p><p className="text-xs text-muted-foreground">{l}</p></div>
                    ))}
                  </div>
                ); })()}
              </div>
              {GROUPS.map((g) => (
                <div key={g} className="rounded-2xl bg-card">
                  <div className="grid grid-cols-[1fr_64px_64px_64px] items-center gap-2 px-5 pb-1 pt-4">
                    <h3 className="text-title font-semibold">{g}</h3>
                    {['Dekhe', 'Badle', 'Approve'].map((h) => <span key={h} className="text-center text-xs text-muted-foreground">{h}</span>)}
                  </div>
                  <ul className="pb-2">
                    {ROLE_MODULES.filter((m) => m.group === g).map((m) => {
                      const a = cur[person.id][m.key];
                      const pending = !same(a, base[person.id][m.key]);
                      const mine = !same(a, roleOf(person, m.key));
                      const lock = locked(person, m);
                      return (
                        <li key={m.key} className={`grid grid-cols-[1fr_64px_64px_64px] items-center gap-2 px-5 py-2 transition-colors ${pending ? 'bg-warning/10' : mine ? 'bg-brand/5' : 'hover:bg-muted/40'}`}>
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{m.label}{mine && <Badge tone="brand">sirf is aadmi ke liye</Badge>}{pending && <Badge tone="warning">save baaki</Badge>}</p>
                            <p className="truncate text-xs text-muted-foreground">{m.hint}</p>
                          </div>
                          <span className="flex justify-center"><Switch on={a.view} disabled={lock || m.view.length === 0} label={`${m.label}: dekhe`} onChange={(v) => set(person.id, m, 'view', v)} /></span>
                          <span className="flex justify-center"><Switch on={a.edit} disabled={lock || m.edit.length === 0} label={`${m.label}: badle`} onChange={(v) => set(person.id, m, 'edit', v)} /></span>
                          <span className="flex justify-center">{(m.approve?.length ?? 0) > 0
                            ? <Switch on={a.approve} disabled={lock} label={`${m.label}: approve`} onChange={(v) => set(person.id, m, 'approve', v)} />
                            : <span className="text-xs text-muted-foreground" aria-label="Approve nahi hota">-</span>}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

const DOT: Record<string, string> = { none: 'bg-transparent ring-1 ring-inset ring-border', view: 'bg-brand/30', edit: 'bg-brand', approve: 'bg-foreground' };
const levelOf = (a: Access) => (a.approve ? 'approve' : a.edit ? 'edit' : a.view ? 'view' : 'none');

function Matrix({ people, cur, base, onOpen }: { people: Person[]; cur: Record<string, Record<string, Access>>; base: Record<string, Record<string, Access>>; onOpen: (id: string) => void }) {
  return (
    <section className="rounded-2xl bg-card p-4" aria-label="Sabka access">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {[['none', 'Kuch nahi'], ['view', 'Dekh sakta'], ['edit', 'Badal sakta'], ['approve', 'Approve bhi']].map(([k, l]) => (
          <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-3.5 w-3.5 rounded-full ${DOT[k]}`} />{l}</span>
        ))}
        <span className="ms-auto">Naam pe click karke us aadmi ke switch kholiye</span>
      </div>
      <div className="thin-scroll overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card pb-2 pe-3 text-start text-xs font-medium text-muted-foreground">Kaam</th>
              {people.map((p) => (
                <th key={p.id} className="px-1 pb-2">
                  <button type="button" onClick={() => onOpen(p.id)} title={`${p.name} - ${p.roles.join(', ')}`}
                    className="grid h-8 w-8 place-items-center rounded-full bg-muted text-[11px] font-bold transition hover:bg-brand/15">{initials(p.name)}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_MODULES.map((m) => (
              <tr key={m.key} className="group">
                <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-card py-1.5 pe-3 text-start text-sm font-normal group-hover:bg-muted/40">{m.label}</th>
                {people.map((p) => {
                  const lv = levelOf(cur[p.id][m.key]);
                  const mine = !same(cur[p.id][m.key], base[p.id][m.key]);
                  return (
                    <td key={p.id} className="px-1 py-1.5 text-center group-hover:bg-muted/40">
                      <span title={`${p.name}: ${m.label} - ${lv}`} className={`mx-auto block h-4 w-4 rounded-full ${DOT[lv]} ${mine ? 'outline outline-2 outline-offset-2 outline-warning' : ''}`} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
