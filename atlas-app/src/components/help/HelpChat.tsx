'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { helpLibraryAction } from '@/app/actions/help';
import { search, CONFIDENT, type HelpArticle } from '@/lib/help/search';

/**
 * MADAD - the help chat (30 Oct 2026). Ask in Hinglish or English, get the
 * written guide: numbered steps with the real button names, the page to
 * open, what to do when it goes wrong. Two modes: "Sab ke liye" for everyone
 * now, "Admin" later. Never bigger than 400 × 620 on a desktop, a sheet on a
 * phone; long answers scroll inside it and fold after four steps.
 */

type Msg =
  | { from: 'me'; text: string }
  | { from: 'bot'; kind: 'answer'; id: string }
  | { from: 'bot'; kind: 'choices'; ids: string[]; text: string };

const KEY = 'madad-chat-v1';
const FOLD = 4;
const AREAS = ['Enquiry', 'Quotation', 'Complaint', 'Challan', 'Installation', 'Payment', 'Customer', 'AMC', 'Stock', 'Problem'];
const POPULAR = ['challan-raise', 'complaint-new', 'payment-record', 'enquiry-quotation'];

/** "[Raise challan]" in a step reads as the button it names. */
function Text({ s }: { s: string }) {
  return (
    <>
      {s.split(/(\[[^\]]+\])/g).map((part, i) => (part.startsWith('[') && part.endsWith(']')
        ? <span key={i} className="mx-0.5 inline-flex items-center whitespace-nowrap rounded-full bg-card px-2 py-px align-baseline text-[0.8em] font-semibold text-foreground ring-1 ring-inset ring-border">{part.slice(1, -1)}</span>
        : <span key={i}>{part}</span>))}
    </>
  );
}

export function HelpChat({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'all' | 'admin'>('all');
  const [lib, setLib] = useState<HelpArticle[] | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);
  const [loading, start] = useTransition();
  const path = usePathname() ?? '/';
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // The conversation survives moving between pages in this tab, not more.
  useEffect(() => { try { const s = sessionStorage.getItem(KEY); if (s) setMsgs(JSON.parse(s)); } catch { /* private mode */ } }, []);
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch { /* full or blocked */ } }, [msgs]);
  useEffect(() => {
    if (!open) return;
    if (!lib) start(async () => setLib((await helpLibraryAction()).articles));
    const t = setTimeout(() => input.current?.focus(), 50);
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (zoom) setZoom(null); else setOpen(false);
    };
    window.addEventListener('keydown', esc);
    return () => { clearTimeout(t); window.removeEventListener('keydown', esc); };
  }, [open, lib, zoom]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, open]);

  const byId = useMemo(() => new Map((lib ?? []).map((a) => [a.id, a])), [lib]);
  // What people ask on this page, before they ask.
  const here = useMemo(() => {
    const list = lib ?? [];
    const onPage = list.filter((a) => a.pages?.some((p) => path === p || path.startsWith(`${p}/`)));
    return (onPage.length ? onPage : POPULAR.map((id) => byId.get(id)).filter((a): a is HelpArticle => !!a)).slice(0, 4);
  }, [lib, path, byId]);

  const ask = (q: string) => {
    const question = q.trim();
    if (!question || !lib) return;
    setText('');
    if (input.current) input.current.style.height = 'auto';
    const hits = search(question, lib, 3);
    const reply: Msg = hits[0] && hits[0].score >= CONFIDENT
      ? { from: 'bot', kind: 'answer', id: hits[0].article.id }
      : { from: 'bot', kind: 'choices', ids: hits.map((h) => h.article.id), text: hits.length ? 'Pakka samajh nahi aaya. Inmein se koi?' : 'Iska jawab mere paas nahi hai.' };
    setMsgs((m) => [...m, { from: 'me', text: question }, reply]);
  };
  const show = (id: string, label?: string) => setMsgs((m) => [...m, ...(label ? [{ from: 'me', text: label } as Msg] : []), { from: 'bot', kind: 'answer', id }]);
  const area = (a: string) => {
    const ids = (lib ?? []).filter((x) => x.area === a).map((x) => x.id);
    setMsgs((m) => [...m, { from: 'me', text: a }, { from: 'bot', kind: 'choices', ids, text: `${a} - kya karna hai?` }]);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="madad"
        className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-foreground ring-1 ring-inset ring-border transition hover:bg-muted active:scale-[0.98]">
        <Icon name="help-circle" className="h-4 w-4" />
        <span className="hidden xl:inline">Madad</span>
        <span className="sr-only xl:hidden">Madad - help</span>
      </button>

      {open && (
        <section id="madad" role="dialog" aria-label="Madad - help" aria-modal="false"
          className="fixed inset-x-0 bottom-0 z-[150] flex h-[85dvh] flex-col overflow-hidden rounded-t-2xl bg-background shadow-overlay animate-slide-up sm:inset-x-auto sm:bottom-4 sm:right-4 sm:h-[min(620px,calc(100dvh-6rem))] sm:w-[400px] sm:rounded-2xl">
          {/* ---- head ---- */}
          <header className="flex items-center gap-2 bg-card px-4 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/10 text-on-tint-brand"><Icon name="help-circle" className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-title font-semibold leading-tight">Madad</h2>
              <p className="truncate text-xs text-muted-foreground">Kuch bhi poochiye - step by step jawab</p>
            </div>
            {msgs.length > 0 && (
              <button type="button" onClick={() => setMsgs([])} className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="Nayi baat shuru karo" title="Nayi baat">
                <Icon name="refresh" className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label="Band karo">
              <Icon name="x" className="h-4 w-4" />
            </button>
          </header>
          <div role="tablist" aria-label="Mode" className="flex gap-1 bg-card px-4 pb-3">
            {([['all', 'Sab ke liye'], ['admin', 'Admin']] as const).filter(([k]) => k === 'all' || isAdmin).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                className={`h-8 rounded-full px-3 text-xs font-semibold transition ${mode === k ? 'bg-foreground text-background' : 'bg-muted text-foreground hover:bg-border'}`}>{l}</button>
            ))}
          </div>

          {/* ---- conversation ---- */}
          <div className="thin-scroll flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {mode === 'admin' ? (
              <p className="rounded-2xl bg-card p-4 text-sm">Admin mode jaldi aa raha hai: settings, roles, users aur reports ke sawaal. Tab tak <button type="button" className="font-semibold text-brand hover:underline" onClick={() => setMode('all')}>Sab ke liye</button> mein poochiye.</p>
            ) : !lib ? (
              <p className="text-sm text-muted-foreground">{loading ? 'Khul raha hai…' : ''}</p>
            ) : (
              <div className="space-y-3">
                <div className="rounded-2xl bg-card p-4">
                  <p className="text-sm">Namaste! Kaam ka sawaal likhiye - jaise <em>&ldquo;challan kaise raise kare&rdquo;</em> - ya neeche se chuniye.</p>
                  <p className="mt-3 text-xs text-muted-foreground">Is page pe aksar poocha jaata hai</p>
                  <div className="mt-1.5 grid gap-1.5">
                    {here.map((a) => (
                      <button key={a.id} type="button" onClick={() => show(a.id, a.q)} className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2 text-start text-sm transition hover:bg-muted active:scale-[0.99]">
                        {a.q}<Icon name="chevron-right" className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {AREAS.filter((x) => lib.some((a) => a.area === x)).map((x) => (
                      <button key={x} type="button" onClick={() => area(x)} className="h-8 rounded-full bg-muted px-3 text-xs font-medium transition hover:bg-border">{x}</button>
                    ))}
                  </div>
                </div>

                {msgs.map((m, i) => (m.from === 'me'
                  ? <p key={i} className="ms-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-background">{m.text}</p>
                  : m.kind === 'answer'
                    ? (byId.get(m.id) ? <Answer key={i} a={byId.get(m.id)!} byId={byId} onAsk={show} onZoom={setZoom} onOpen={() => { if (window.innerWidth < 640) setOpen(false); }} /> : null)
                    : (
                      <div key={i} className="rounded-2xl bg-card p-4">
                        <p className="text-sm">{m.text}</p>
                        <div className="mt-2 grid gap-1.5">
                          {m.ids.map((id) => byId.get(id) && (
                            <button key={id} type="button" onClick={() => show(id, byId.get(id)!.q)} className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2 text-start text-sm transition hover:bg-muted">
                              {byId.get(id)!.q}<Icon name="chevron-right" className="h-4 w-4 shrink-0 text-muted-foreground" />
                            </button>
                          ))}
                        </div>
                        <p className="mt-3 text-xs text-muted-foreground">Nahi mila? <Link href="/helpdesk" className="font-medium text-brand hover:underline">Helpdesk pe ticket</Link> banaiye - team jawab degi.</p>
                      </div>
                    )))}
                <div ref={end} />
              </div>
            )}
          </div>

          {/* ---- ask ---- */}
          {mode === 'all' && (
            <form className="flex items-end gap-2 bg-card px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
              <label htmlFor="madad-q" className="sr-only">Aapka sawaal</label>
              <textarea id="madad-q" ref={input} rows={1} value={text} disabled={!lib}
                onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 96)}px`; }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text); } }}
                placeholder="Sawaal ya error yahan likhiye…"
                className="max-h-24 min-h-[40px] flex-1 resize-none rounded-2xl bg-muted/70 px-3.5 py-2.5 text-sm placeholder:text-muted-foreground focus:bg-background focus:outline-none focus:ring-2 focus:ring-brand" />
              <button type="submit" disabled={!text.trim() || !lib} aria-label="Poochho"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-brand-fg transition hover:bg-brand-hover active:scale-95 disabled:opacity-40">
                <Icon name="send" className="h-4 w-4" />
              </button>
            </form>
          )}

          {zoom && (
            <div className="absolute inset-0 z-10 flex flex-col bg-foreground/90 p-3" role="dialog" aria-label="Screenshot">
              <button type="button" onClick={() => setZoom(null)} className="ms-auto grid h-9 w-9 place-items-center rounded-full bg-background/20 text-background" aria-label="Band karo"><Icon name="x" className="h-4 w-4" /></button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={zoom} alt="Screen ka hissa - jo dabana hai woh ghera hua hai" className="m-auto max-h-full max-w-full rounded-lg object-contain" />
            </div>
          )}
        </section>
      )}
    </>
  );
}

function Answer({ a, byId, onAsk, onZoom, onOpen }: {
  a: HelpArticle; byId: Map<string, HelpArticle>;
  onAsk: (id: string, label: string) => void; onZoom: (src: string) => void; onOpen: () => void;
}) {
  const [all, setAll] = useState(a.steps.length <= FOLD + 1);
  const [vote, setVote] = useState<null | 'yes' | 'no'>(null);
  const steps = all ? a.steps : a.steps.slice(0, FOLD);
  return (
    <article className="rounded-2xl bg-card p-4">
      <h3 className="text-sm font-semibold">{a.q}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{a.steps.length} steps{a.who ? ` · ${a.who}` : ''}</p>
      <p className="mt-2 text-sm"><Text s={a.short} /></p>
      <ol className="mt-3 space-y-2.5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2.5 text-sm">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/10 text-xs font-bold text-on-tint-brand tabular-nums" aria-hidden>{i + 1}</span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="leading-relaxed"><Text s={s.do} /></p>
              {s.href && <Link href={s.href} onClick={onOpen} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">Page kholo<Icon name="arrow-up-right" className="h-3 w-3" /></Link>}
              {s.shot && (
                <button type="button" onClick={() => onZoom(`/help/${s.shot}.jpg`)} className="mt-2 block w-full overflow-hidden rounded-xl ring-1 ring-inset ring-border transition hover:ring-brand" aria-label="Screenshot bada karo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/help/${s.shot}.jpg`} alt="" loading="lazy" className="block max-h-32 w-full object-cover object-top" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!all && <button type="button" onClick={() => setAll(true)} className="mt-2 text-xs font-semibold text-brand hover:underline">Baaki {a.steps.length - FOLD} steps dikhao</button>}

      {a.problems && a.problems.length > 0 && (
        <details className="mt-3 rounded-xl bg-muted/60 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-xs font-semibold">Kaam nahi bana?</summary>
          <dl className="mt-2 space-y-2">
            {a.problems.map((p, i) => (
              <div key={i}>
                <dt className="text-xs text-muted-foreground"><Text s={p.if} /></dt>
                <dd className="mt-0.5"><Text s={p.then} /></dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {a.open && <Link href={a.open.href} onClick={onOpen} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-brand px-3 text-xs font-semibold text-brand-fg transition hover:bg-brand-hover">{a.open.label}<Icon name="arrow-right" className="h-3.5 w-3.5" /></Link>}
        {vote === null ? (
          <span className="ms-auto flex items-center gap-1 text-xs text-muted-foreground">
            Kaam aaya?
            <button type="button" onClick={() => setVote('yes')} className="rounded-full px-2 py-1 font-medium text-foreground hover:bg-muted">Haan</button>
            <button type="button" onClick={() => setVote('no')} className="rounded-full px-2 py-1 font-medium text-foreground hover:bg-muted">Nahi</button>
          </span>
        ) : (
          <span className="ms-auto text-xs text-muted-foreground">
            {vote === 'yes' ? 'Badhiya!' : <>Maaf kijiye. <Link href="/helpdesk" className="font-medium text-brand hover:underline">Helpdesk</Link> pe likhiye.</>}
          </span>
        )}
      </div>

      {a.related && a.related.some((r) => byId.has(r)) && (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">Iske baad</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {a.related.filter((r) => byId.has(r)).map((r) => (
              <button key={r} type="button" onClick={() => onAsk(r, byId.get(r)!.q)} className="rounded-full bg-muted px-3 py-1.5 text-start text-xs font-medium transition hover:bg-border">{byId.get(r)!.q}</button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
