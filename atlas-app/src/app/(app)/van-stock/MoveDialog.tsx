'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Field } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import type { MovableItem } from '@/server/van-stock';
import { issueToVanAction, returnFromVanAction, vanMovablesAction } from './actions';

/**
 * Load a van, or hand stock back from it (4 Oct 2026).
 *
 * Both had working server code since Stage D and no button anywhere, so no van
 * could ever hold anything. One dialog for both directions, because they are
 * the same act - stock moving between the branch shelf and a named person -
 * and a storeman should not have to learn two screens for it.
 *
 * Loading searches the branch (type, or scan with a USB scanner: it types the
 * code and presses Enter). Handing back lists everything on board at once,
 * with "Hand back everything" for the end of a shift. Serial products are
 * picked by number; the server refuses a count without the numbers.
 */
interface Line { item: MovableItem; qty: number; unitIds: string[] }

export function MoveDialog({ vanId, vanName, direction, onClose, onDone }: {
  vanId: string;
  vanName: string;
  direction: 'load' | 'return';
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const from = direction === 'load' ? 'branch' : 'van';
  const [q, setQ] = useState('');
  const [found, setFound] = useState<MovableItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Hand back: everything on board, straight away.
  useEffect(() => {
    if (direction !== 'return') return;
    void vanMovablesAction({ vanId, from, q: null, code: null }).then((r) => {
      if ('error' in r) setError(r.error); else setFound(r.items);
    });
  }, [direction, vanId, from]);

  // Load: search the branch as they type.
  useEffect(() => {
    if (direction !== 'load') return;
    const s = q.trim();
    if (s.length < 2) { setFound([]); return; }
    const h = setTimeout(() => {
      setSearching(true);
      void vanMovablesAction({ vanId, from, q: s, code: null }).then((r) => {
        setSearching(false);
        if ('error' in r) setError(r.error); else setFound(r.items);
      });
    }, 250);
    return () => clearTimeout(h);
  }, [q, direction, vanId, from]);

  const add = (item: MovableItem, unitId: string | null = null) => {
    setLines((ls) => {
      const at = ls.findIndex((l) => l.item.productId === item.productId);
      if (at >= 0) {
        const l = ls[at];
        if (unitId && l.unitIds.includes(unitId)) return ls;
        const unitIds = unitId ? [...l.unitIds, unitId] : l.unitIds;
        const qty = Math.min(item.available, unitId ? Math.max(l.qty, unitIds.length) : l.qty + 1);
        return ls.map((x, i) => (i === at ? { ...x, qty, unitIds } : x));
      }
      return [...ls, { item, qty: 1, unitIds: unitId ? [unitId] : [] }];
    });
  };

  /** Enter in the search box: treat it as a scanned code first. */
  const scan = async () => {
    const code = q.trim();
    if (code.length < 2) return;
    const r = await vanMovablesAction({ vanId, from, q: null, code });
    if ('error' in r) { setError(r.error); return; }
    if (r.items.length === 1) {
      add(r.items[0], r.matchedUnitId);
      setQ('');
      setFound([]);
    } else if (r.items.length === 0) {
      setError(`Nothing ${direction === 'load' ? 'at the branch' : 'on the van'} matches ${code}.`);
    } else {
      setFound(r.items);
    }
  };

  const everything = () => setLines(found.map((item) => ({ item, qty: item.available, unitIds: item.units.map((u) => u.id) })));

  const setQty = (productId: string, qty: number) =>
    setLines((ls) => ls.map((l) => (l.item.productId === productId
      ? { ...l, qty: Math.max(1, Math.min(l.item.available, qty || 1)) }
      : l)));

  const toggleUnit = (productId: string, unitId: string) =>
    setLines((ls) => ls.map((l) => {
      if (l.item.productId !== productId) return l;
      const on = l.unitIds.includes(unitId);
      const unitIds = on ? l.unitIds.filter((u) => u !== unitId) : [...l.unitIds, unitId];
      return { ...l, unitIds, qty: Math.max(l.qty, unitIds.length) };
    }));

  const firstN = (productId: string) =>
    setLines((ls) => ls.map((l) => (l.item.productId === productId
      ? { ...l, unitIds: l.item.units.slice(0, l.qty).map((u) => u.id) }
      : l)));

  const submit = () => {
    setError(null);
    start(async () => {
      const input = {
        vanId,
        note: note.trim() || null,
        lines: lines.map((l) => ({ productId: l.item.productId, qty: l.qty, stockUnitIds: l.unitIds.length ? l.unitIds : undefined })),
      };
      const r = direction === 'load' ? await issueToVanAction(input) : await returnFromVanAction(input);
      if (r.error) { setError(r.error); return; }
      onDone(r.message ?? 'Done.');
    });
  };

  const total = lines.reduce((n, l) => n + l.qty, 0);
  const verb = direction === 'load' ? 'Load' : 'Hand back';

  return (
    <Modal
      title={direction === 'load' ? `Load ${vanName}` : `Hand back from ${vanName}`}
      subtitle={direction === 'load'
        ? 'From the branch shelf onto the van. Stock on hand does not change - it has only moved.'
        : 'From the van back onto the branch shelf.'}
      icon="truck"
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="me-auto text-sm text-muted-foreground">
            {lines.length} {lines.length === 1 ? 'line' : 'lines'} · {total} {total === 1 ? 'item' : 'items'}
          </span>
          <Button variant="outline" icon="x" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="check" loading={pending} disabled={lines.length === 0} onClick={submit}>
            {verb} {total > 0 ? total : ''}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* ---- pick ---- */}
        <div className="grid content-start gap-3">
          {direction === 'load' ? (
            <Field label="Find or scan" hint="Type a name or code, or scan a barcode or serial number and press Enter.">
              <div className="relative">
                <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void scan(); } }}
                  className="field-input ps-9"
                  placeholder="Camera, DVR-8CH, a serial number…"
                />
              </div>
            </Field>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="eyebrow">On the van</p>
              {found.length > 0 && <Button size="sm" variant="outline" icon="check" onClick={everything}>Hand back everything</Button>}
            </div>
          )}

          <div className="thin-scroll max-h-[22rem] overflow-y-auto rounded border border-border">
            {found.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {direction === 'return'
                  ? 'Nothing is on this van.'
                  : searching ? 'Looking…' : q.trim().length < 2 ? 'Start typing to find stock at the branch.' : 'Nothing at the branch matches.'}
              </p>
            ) : found.map((i) => {
              const inLines = lines.find((l) => l.item.productId === i.productId);
              return (
                <button
                  key={i.productId}
                  type="button"
                  onClick={() => add(i)}
                  className="flex w-full items-center gap-3 border-b border-border/70 px-3 py-2.5 text-start transition last:border-b-0 hover:bg-brand/[0.04]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{i.productName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[i.productCode, i.trackingMode === 'serial' ? 'by serial number' : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <Badge tone="info">{i.available}{i.unit ? ` ${i.unit}` : ''} {direction === 'load' ? 'at branch' : 'on van'}</Badge>
                  <Icon name={inLines ? 'check' : 'plus'} className={`h-4 w-4 ${inLines ? 'text-success' : 'text-brand'}`} />
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- going ---- */}
        <div className="grid content-start gap-3">
          <p className="eyebrow">{direction === 'load' ? 'Going onto the van' : 'Coming back'}</p>
          {lines.length === 0 && (
            <p className="rounded border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
              Pick from the list, or scan.
            </p>
          )}
          {lines.map((l) => {
            const serial = l.item.trackingMode === 'serial' && l.item.units.length > 0;
            const needed = Math.min(l.qty, l.item.units.length);
            return (
              <div key={l.item.productId} className="rounded border border-border bg-card p-3 shadow-card">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{l.item.productName}</p>
                    <p className="text-xs text-muted-foreground">{l.item.available} {direction === 'load' ? 'at the branch' : 'on the van'}</p>
                  </div>
                  <input
                    type="number" min={1} max={l.item.available} value={l.qty}
                    aria-label={`How many ${l.item.productName}`}
                    onChange={(e) => setQty(l.item.productId, Number(e.target.value))}
                    className="field-input w-20 text-center tabular-nums"
                  />
                  <button
                    type="button" aria-label={`Remove ${l.item.productName}`}
                    onClick={() => setLines((ls) => ls.filter((x) => x.item.productId !== l.item.productId))}
                    className="grid h-ctl w-9 place-items-center rounded-sm text-muted-foreground hover:bg-danger/10 hover:text-danger"
                  >
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                </div>
                {serial && (
                  <div className="mt-2.5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className={`text-xs font-semibold ${l.unitIds.length === needed ? 'text-success' : 'text-warning'}`}>
                        {l.unitIds.length} of {needed} numbers picked
                      </span>
                      {l.unitIds.length !== needed && (
                        <button type="button" onClick={() => firstN(l.item.productId)} className="text-xs font-bold text-brand hover:underline">
                          Pick the oldest {needed}
                        </button>
                      )}
                    </div>
                    <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                      {l.item.units.map((u) => {
                        const on = l.unitIds.includes(u.id);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleUnit(l.item.productId, u.id)}
                            className={`rounded-full border px-2.5 py-0.5 font-mono text-xs transition ${
                              on ? 'border-brand bg-brand text-brand-fg' : 'border-border bg-background hover:border-brand/40'
                            }`}
                          >
                            {u.serialNo ?? 'no number'}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <Field label="Note (optional)">
            <input value={note} onChange={(e) => setNote(e.target.value)} className="field-input" placeholder={direction === 'load' ? 'e.g. for the Gupta site job' : 'e.g. end of shift'} />
          </Field>
          {error && (
            <p role="alert" className="rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-on-tint-danger">{error}</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
