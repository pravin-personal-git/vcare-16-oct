'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader } from '@/components/ui/Layout';
import { Modal } from '@/components/ui/Modal';
import { SerialLinks } from '@/components/document/SerialLink';
import { describeVariance } from '@/lib/van-reconcile';
import type { VanSummary } from '@/server/van-stock';
import type { vanShift } from '@/server/van-stock';
import {
  createVanAction, setVanHolderAction, writeOffShortfallAction,
} from './actions';
import { MoveDialog } from './MoveDialog';

/**
 * Van stock — Pravin's decisions 6 and 7.
 *
 * Stock handed to a technician has NOT left the business. It is in their van,
 * it still counts in stock on hand, and at the end of the shift it has to come
 * back or be accounted for.
 *
 * The screen is built around the end of the day rather than the start, because
 * that is the moment anybody looks. A storeman at half six with four vans
 * coming in wants one question answered per van — does it add up? — and the
 * detail only when the answer is no.
 *
 * A shortfall is SHOWN, never cleared automatically. One that disappears on its
 * own teaches everybody that shortfalls do not matter; one that sits here until
 * a named person closes it with a reason is the entire point of counting.
 */

type Shift = Awaited<ReturnType<typeof vanShift>> | null;

export function VanStockClient({
  vans, holders, selectedId, shift, canManage, scopeIsAll,
}: {
  vans: VanSummary[];
  holders: { id: string; fullName: string }[];
  selectedId: string | null;
  shift: Shift;
  canManage: boolean;
  scopeIsAll: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // What the write-off dialog is being pointed at: the computed shortfall, or
  // stock the ledger says is on board that the storeman cannot find.
  const [writingOff, setWritingOff] = useState<'variance' | 'onboard' | null>(null);
  const [moving, setMoving] = useState<'load' | 'return' | null>(null);

  const run = (fn: () => Promise<{ error?: string; message?: string }>) => {
    setError(null); setNote(null);
    start(async () => {
      const r = await fn();
      if (r.error) { setError(r.error); return; }
      if (r.message) setNote(r.message);
      router.refresh();
    });
  };

  const short = shift?.result.lines.filter((l) => l.state === 'short') ?? [];
  const over = shift?.result.lines.filter((l) => l.state === 'over') ?? [];
  const onBoard = shift?.result.lines.filter((l) => l.onVanQty > 0) ?? [];

  return (
    <div>
      <PageHeader
        badge="truck"
        title="Van stock"
        subtitle="What each technician is carrying. It has not left the business — it is with them."
        actions={
          <Button
            variant="primary" icon="plus"
            disabled={!canManage}
            title={scopeIsAll ? 'Select a single store first' : undefined}
            onClick={() => setAdding(true)}
          >
            Add a van
          </Button>
        }
      />

      {error && (
        <p className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-on-tint-danger">
          {error}
        </p>
      )}
      {note && (
        <p className="mb-3 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-on-tint-success">
          {note}
        </p>
      )}

      {vans.length === 0 ? (
        <EmptyState
          icon="truck"
          title="No vans yet"
          hint="A van is a place stock can sit while a technician is carrying it. Add one per technician who takes stock out, and the shelf count stops going wrong every morning."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* ---- the vans ------------------------------------------------ */}
          <Card className="h-fit overflow-hidden">
            {vans.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => router.push(`/van-stock?van=${v.id}`)}
                className={`flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-start transition last:border-b-0 hover:bg-muted/60 ${
                  v.id === selectedId ? 'bg-brand/[0.07]' : ''
                }`}
              >
                <Icon name="truck" className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{v.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {v.holderName ?? 'Nobody holds it'}
                  </p>
                </div>
                {v.lineCount > 0 && <Badge tone="info">{v.lineCount}</Badge>}
              </button>
            ))}
          </Card>

          {/* ---- the shift ------------------------------------------------ */}
          <div className="grid gap-4">
            {!shift ? (
              <Card className="p-6">
                <p className="text-sm text-muted-foreground">Pick a van.</p>
              </Card>
            ) : (
              <>
                <Card className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="me-auto">
                      <h2 className="text-base font-semibold">{shift.van.name}</h2>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{shift.van.code}</span>
                        {shift.van.holderName ? ` · held by ${shift.van.holderName}` : ' · nobody holds it'}
                      </p>
                    </div>
                    {shift.result.settled
                      ? <Badge tone="success">Balanced</Badge>
                      : <Badge tone="danger">{short.length + over.length} to explain</Badge>}
                  </div>

                  {canManage && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="primary" icon="upload" onClick={() => setMoving('load')}>
                        Load the van
                      </Button>
                      <Button
                        icon="download" disabled={onBoard.length === 0}
                        title={onBoard.length === 0 ? 'Nothing is on this van' : undefined}
                        onClick={() => setMoving('return')}
                      >
                        Hand back
                      </Button>
                    </div>
                  )}

                  {canManage && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="text-xs text-muted-foreground" htmlFor="holder">
                        Held by
                      </label>
                      <select
                        id="holder"
                        defaultValue={vans.find((v) => v.id === shift.van.id)?.holderId ?? ''}
                        disabled={pending}
                        onChange={(e) => run(() =>
                          setVanHolderAction(shift.van.id, e.target.value || null))}
                        className="field-input max-w-xs"
                      >
                        <option value="">Nobody</option>
                        {holders.map((h) => (
                          <option key={h.id} value={h.id}>{h.fullName}</option>
                        ))}
                      </select>
                      <span className="text-xs text-muted-foreground">
                        Can only change while the van is empty.
                      </span>
                    </div>
                  )}
                </Card>

                {/* ---- what does not add up ---------------------------------- */}
                {!shift.result.settled && (
                  <Card className="border-danger/40 p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Icon name="alert-triangle" className="h-4 w-4 text-danger" />
                      <h3 className="text-sm font-semibold">This van cannot account for everything</h3>
                      {canManage && short.length > 0 && (
                        <Button
                          variant="outline" icon="x-circle"
                          className="ms-auto"
                          onClick={() => setWritingOff('variance')}
                        >
                          Write the shortfall off
                        </Button>
                      )}
                    </div>
                    <ul className="grid gap-1 text-sm">
                      {[...short, ...over].map((l) => (
                        <li key={l.productId} className="text-muted-foreground">
                          <span className={l.state === 'short' ? 'text-danger' : 'text-warning'}>
                            ●
                          </span>{' '}
                          {describeVariance(l)}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">
                      It stays here until somebody resolves it. Nothing clears on its own.
                    </p>
                  </Card>
                )}

                {/* ---- the shift, line by line ------------------------------- */}
                <Card className="overflow-hidden">
                  <div className="border-b border-border px-4 py-2.5">
                    <h3 className="text-sm font-semibold">Today&rsquo;s shift</h3>
                    <p className="text-xs text-muted-foreground">
                      On the van at the start, loaded during the day, fitted on site, handed back.
                      What is left should be what it is holding.
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-micro uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-2 text-start font-semibold">Item</th>
                          <th className="px-3 py-2 text-end font-semibold">Started with</th>
                          <th className="px-3 py-2 text-end font-semibold">Loaded</th>
                          <th className="px-3 py-2 text-end font-semibold">Used on site</th>
                          <th className="px-3 py-2 text-end font-semibold">Handed back</th>
                          <th className="px-3 py-2 text-end font-semibold">On the van</th>
                          <th className="px-4 py-2 text-start font-semibold">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shift.result.lines.map((l) => (
                          <tr key={l.productId} className="border-b border-border/60 last:border-0">
                            <td className="px-4 py-2">
                              {l.productName}
                              {l.unit && (
                                <span className="ms-1 text-xs text-muted-foreground">({l.unit})</span>
                              )}
                              {(shift.unitsOnVan?.[l.productId] ?? []).length > 0 && (
                                <span className="mt-0.5 block"><SerialLinks units={shift.unitsOnVan?.[l.productId] ?? []} /></span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-end font-mono tabular-nums">{l.openingQty}</td>
                            <td className="px-3 py-2 text-end font-mono tabular-nums">{l.issuedQty}</td>
                            <td className="px-3 py-2 text-end font-mono tabular-nums">{l.usedQty}</td>
                            <td className="px-3 py-2 text-end font-mono tabular-nums">{l.returnedQty}</td>
                            <td className="px-3 py-2 text-end font-mono tabular-nums">{l.onVanQty}</td>
                            <td className="px-4 py-2">
                              {l.state === 'balanced' && <Badge tone="success">balanced</Badge>}
                              {l.state === 'short' && <Badge tone="danger">{Math.abs(l.varianceQty)} missing</Badge>}
                              {l.state === 'over' && <Badge tone="warning">{l.varianceQty} extra</Badge>}
                            </td>
                          </tr>
                        ))}
                        {shift.result.lines.length === 0 && (
                          <tr>
                            <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                              Nothing has moved on this van.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>

                {/*
                  WHY THIS IS NOT AUTOMATICALLY A SHORTFALL.
                
                  Pravin's rule is that what comes back should match what went
                  out. Taken literally, anything the ledger still shows on a van
                  at the end of a shift is missing — and that would raise a
                  shortfall every single evening, because a technician keeps
                  connectors and a part drum of cable on board overnight. A
                  system that cries wolf daily is one nobody reads.
                
                  So the software does not guess what is physically in a van. It
                  states what it believes, and the person who can actually look
                  says whether that is right. One button, and the difference
                  between "still on board" and "gone" stays a human judgement
                  instead of a rule that is wrong most nights.
                */}
                {onBoard.length > 0 && (
                  <Card className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon name="truck" className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold">Still on board</h3>
                      {canManage && (
                        <Button
                          variant="outline" icon="alert-triangle"
                          className="ms-auto"
                          onClick={() => setWritingOff('onboard')}
                        >
                          Not actually in the van
                        </Button>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      {onBoard.map((l) =>
                        `${l.onVanQty}${l.unit ? ` ${l.unit}` : ''} ${l.productName}`).join(' · ')}
                    </p>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Normal — a van is not emptied every night, and tomorrow this counts as what it
                      started with. Press the button only if you have looked and it is not there.
                    </p>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {moving && shift && (
        <MoveDialog
          vanId={shift.van.id}
          vanName={shift.van.name}
          direction={moving}
          onClose={() => setMoving(null)}
          onDone={(message) => { setMoving(null); setError(null); setNote(message); router.refresh(); }}
        />
      )}

      {adding && (
        <AddVan
          holders={holders}
          pending={pending}
          onClose={() => setAdding(false)}
          onSave={(input) => run(async () => {
            const r = await createVanAction(input);
            if (!r.error) setAdding(false);
            return r;
          })}
        />
      )}

      {writingOff && shift && (() => {
        const target = writingOff === 'variance'
          ? short.map((l) => ({ productId: l.productId, productName: l.productName, qty: Math.abs(l.varianceQty), unit: l.unit }))
          : onBoard.map((l) => ({ productId: l.productId, productName: l.productName, qty: l.onVanQty, unit: l.unit }));
        return (
          <WriteOff
            vanName={shift.van.name}
            lines={target}
            pending={pending}
            onClose={() => setWritingOff(null)}
            onSave={(reason) => run(async () => {
              const r = await writeOffShortfallAction({
                vanId: shift.van.id,
                lines: target.map((l) => ({ productId: l.productId, qty: l.qty })),
                reason,
              });
              if (!r.error) setWritingOff(null);
              return r;
            })}
          />
        );
      })()}
    </div>
  );
}

function AddVan({ holders, pending, onClose, onSave }: {
  holders: { id: string; fullName: string }[];
  pending: boolean;
  onClose: () => void;
  onSave: (input: { name: string; code: string; holderId: string | null }) => void;
}) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [holderId, setHolderId] = useState('');

  return (
    <Modal
      title="Add a van"
      subtitle="A place stock can sit while somebody is carrying it."
      icon="truck"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" icon="x" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" icon="plus" loading={pending}
            disabled={!name.trim() || !code.trim()}
            onClick={() => onSave({ name: name.trim(), code: code.trim(), holderId: holderId || null })}
          >
            Add it
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Name" hint="What people call it. &ldquo;Tikam&rsquo;s van&rdquo; is a fine name.">
          <input value={name} onChange={(e) => setName(e.target.value)} className="field-input" />
        </Field>
        <Field label="Short code" hint="Goes on the movement history. Keep it short — TKM, VAN-2.">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            className="field-input font-mono"
          />
        </Field>
        <Field label="Who holds it" hint="The person answerable for what is on board.">
          <select value={holderId} onChange={(e) => setHolderId(e.target.value)} className="field-input">
            <option value="">Nobody yet</option>
            {holders.map((h) => <option key={h.id} value={h.id}>{h.fullName}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

function WriteOff({ vanName, lines, pending, onClose, onSave }: {
  vanName: string;
  lines: { productId: string; productName: string; qty: number; unit: string | null }[];
  pending: boolean;
  onClose: () => void;
  onSave: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Modal
      title="Write off what is missing"
      subtitle={`${vanName}. This destroys stock, and your name stays on it.`}
      icon="alert-triangle"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" icon="x" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary" icon="x-circle" loading={pending}
            disabled={!reason.trim()}
            onClick={() => onSave(reason.trim())}
          >
            Write it off
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <ul className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs">
          {lines.map((l) => (
            <li key={l.productId}>
              {l.qty}{l.unit ? ` ${l.unit}` : ''} × {l.productName}
            </li>
          ))}
        </ul>

        <Field
          label="What happened to it?"
          hint="Required. A write-off with no reason is indistinguishable from stock quietly going missing."
        >
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Dropped on site, damaged in the van, used and not recorded…"
            className="field-input"
          />
        </Field>

        <p className="text-xs text-muted-foreground">
          The stock leaves the books and the movement stays in the history for good. If the items
          turn up later, record them as found on a stock check rather than undoing this.
        </p>
      </div>
    </Modal>
  );
}
