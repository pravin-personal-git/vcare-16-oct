'use client';

import { useState } from 'react';
import { PageHeader, Card, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  BASIS_LABEL, EARNED_ON_HINT, EARNED_ON_LABEL, calculateIncentive,
  type IncentiveBasis, type IncentiveEarnedOn, type IncentiveRule, type Slab,
} from '@/lib/incentive-rules';
import { saveIncentiveRuleAction } from './actions';

/**
 * Choosing how this business pays a sales incentive (workstream H).
 *
 * THE PREVIEW IS THE POINT OF THIS SCREEN.
 *
 * An incentive scheme is argued about with a calculator. Somebody setting one
 * up needs to see what a real deal would pay BEFORE they commit to it -
 * especially for slabs, where "whole" and "marginal" produce very different
 * numbers from the same tiers. The preview runs the same pure function the
 * server uses, so what is shown here and what gets paid cannot disagree.
 */

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN')}`;

export function IncentiveSettingsClient({ initial, canEdit }: {
  initial: IncentiveRule;
  canEdit: boolean;
}) {
  const [rule, setRule] = useState<IncentiveRule>(initial);
  const [preview, setPreview] = useState('500000');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const set = (patch: Partial<IncentiveRule>) => setRule((r) => ({ ...r, ...patch }));

  const save = async () => {
    setBusy(true);
    const r = await saveIncentiveRuleAction(rule);
    setBusy(false);
    setNote(r.error ? { tone: 'bad', text: r.error } : { tone: 'ok', text: 'Saved.' });
  };

  /**
   * A worked example on a round deal. Cost is assumed at 60% so the margin
   * basis has something to show - stated on screen, because a preview whose
   * assumptions are hidden is just another number nobody trusts.
   */
  const previewValue = Math.max(0, Math.round(Number(preview) || 0)) * 100;
  const result = calculateIncentive(
    {
      valuePaise: previewValue,
      manualPaise: 0,
      lines: [{ lineTotalPaise: previewValue, costPaise: Math.round(previewValue * 0.6), percent: rule.percent ?? 0 }],
    },
    rule,
  );

  const slabs: Slab[] = rule.slabs ?? [];
  const setSlab = (i: number, patch: Partial<Slab>) => {
    const next = slabs.map((s, n) => (n === i ? { ...s, ...patch } : s));
    set({ slabs: next });
  };

  return (
    <>
      <PageHeader
        badge="INC"
        title="Sales incentive"
        subtitle="How a salesperson earns on a deal, and when it is owed"
      />

      {note && (
        <Card className={`mb-3 flex items-center gap-2.5 px-3 py-2.5 ${note.tone === 'bad' ? 'border-danger' : 'border-success'}`}>
          <Icon name={note.tone === 'bad' ? 'alert-circle' : 'check-circle'} className={`h-4 w-4 shrink-0 ${note.tone === 'bad' ? 'text-danger' : 'text-success'}`} />
          <p className="text-sm">{note.text}</p>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid gap-3">
          <SectionCard title="How it is worked out" icon="sliders">
            <div className="grid gap-2">
              {(Object.keys(BASIS_LABEL) as IncentiveBasis[]).map((b) => (
                <label key={b} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio" name="basis" className="mt-0.5"
                    disabled={!canEdit} checked={rule.basis === b}
                    onChange={() => set({ basis: b })}
                  />
                  <span><strong>{BASIS_LABEL[b]}</strong></span>
                </label>
              ))}
            </div>

            {rule.basis === 'flat' && (
              <label className="mt-3 block text-sm">
                <span className="mb-1 block font-medium">Amount per sale (₹)</span>
                <input
                  type="number" step="1" min="0" disabled={!canEdit}
                  value={(rule.flatPaise ?? 0) / 100}
                  onChange={(e) => set({ flatPaise: Math.round(Number(e.target.value) * 100) })}
                  className="h-9 w-40 rounded-md border border-border bg-background px-2 text-sm"
                />
                <span className="mt-1 block text-xs text-muted-foreground">
                  The same figure on every deal that qualifies, whatever it is worth. It fills itself
                  in on each quotation, so nobody has to remember the number.
                </span>
              </label>
            )}

            {(rule.basis === 'value' || rule.basis === 'margin') && (
              <label className="mt-3 block text-sm">
                <span className="mb-1 block font-medium">Percentage</span>
                <input
                  type="number" step="0.1" min="0" disabled={!canEdit}
                  value={rule.percent ?? 0}
                  onChange={(e) => set({ percent: Number(e.target.value) })}
                  className="h-9 w-40 rounded-md border border-border bg-background px-2 text-sm"
                />
                {rule.basis === 'margin' && (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Margin needs a cost on every product. Items with no cost recorded contribute
                    nothing &mdash; they are never treated as pure profit.
                  </span>
                )}
              </label>
            )}

            {rule.basis === 'slab' && (
              <div className="mt-3">
                <div className="mb-2 grid gap-2">
                  {(['marginal', 'whole'] as const).map((m) => (
                    <label key={m} className="flex items-start gap-2 text-sm">
                      <input
                        type="radio" name="slabMode" className="mt-0.5"
                        disabled={!canEdit} checked={(rule.slabMode ?? 'marginal') === m}
                        onChange={() => set({ slabMode: m })}
                      />
                      <span>
                        <strong>{m === 'marginal' ? 'Each portion at its own rate' : 'Whole value at the rate reached'}</strong>
                        <span className="block text-xs text-muted-foreground">
                          {m === 'marginal'
                            ? 'Like income tax. A ₹6,00,000 deal with 1% then 2% pays ₹7,000.'
                            : 'The entire deal earns the top rate it reaches. The same deal pays ₹12,000.'}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>

                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-start text-micro uppercase tracking-wide text-muted-foreground">
                      <th className="py-1 text-start font-medium">From (₹)</th>
                      <th className="py-1 text-start font-medium">Rate %</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {slabs.map((s, i) => (
                      <tr key={i}>
                        <td className="py-1 pe-2">
                          <input
                            type="number" min="0" disabled={!canEdit}
                            value={Math.round(s.fromPaise / 100)}
                            onChange={(e) => setSlab(i, { fromPaise: Math.round(Number(e.target.value) * 100) })}
                            className="h-8 w-32 rounded-md border border-border bg-background px-2"
                          />
                        </td>
                        <td className="py-1 pe-2">
                          <input
                            type="number" step="0.1" min="0" disabled={!canEdit}
                            value={s.percent}
                            onChange={(e) => setSlab(i, { percent: Number(e.target.value) })}
                            className="h-8 w-24 rounded-md border border-border bg-background px-2"
                          />
                        </td>
                        <td className="py-1">
                          {canEdit && (
                            <Button variant="ghost" icon="trash" onClick={() => set({ slabs: slabs.filter((_, n) => n !== i) })}>
                              Remove
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {canEdit && (
                  <Button
                    variant="outline" icon="plus"
                    onClick={() => set({ slabs: [...slabs, { fromPaise: 0, percent: 0 }] })}
                  >
                    Add a slab
                  </Button>
                )}
              </div>
            )}

            {rule.basis === 'per_item' && (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Each product or category carries its own rate. A line with no rate simply earns
                nothing &mdash; it is not an error.
              </p>
            )}
          </SectionCard>

          <SectionCard title="When it is owed" icon="clock">
            {/* This is the setting that decides whether the owner pays for
                deals that later fall through. Each option says so plainly. */}
            <div className="grid gap-2">
              {(Object.keys(EARNED_ON_LABEL) as IncentiveEarnedOn[]).map((t) => (
                <label key={t} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio" name="earnedOn" className="mt-0.5"
                    disabled={!canEdit} checked={rule.earnedOn === t}
                    onChange={() => set({ earnedOn: t })}
                  />
                  <span>
                    <strong>{EARNED_ON_LABEL[t]}</strong>
                    <span className="block text-xs text-muted-foreground">{EARNED_ON_HINT[t]}</span>
                  </span>
                </label>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Limits" icon="ban">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Most payable on one deal (₹, 0 = no limit)</span>
                <input
                  type="number" min="0" disabled={!canEdit}
                  value={Math.round((rule.capPaise ?? 0) / 100)}
                  onChange={(e) => set({ capPaise: Math.round(Number(e.target.value) * 100) })}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Smallest deal that earns (₹, 0 = all)</span>
                <input
                  type="number" min="0" disabled={!canEdit}
                  value={Math.round((rule.minimumDealPaise ?? 0) / 100)}
                  onChange={(e) => set({ minimumDealPaise: Math.round(Number(e.target.value) * 100) })}
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                />
              </label>
            </div>
          </SectionCard>

          {canEdit && (
            <div className="flex justify-end">
              <Button icon="check" loading={busy} onClick={() => void save()}>Save scheme</Button>
            </div>
          )}
        </div>

        <SectionCard title="What a deal would pay" icon="trending-up">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Deal value (₹, before tax)</span>
            <input
              type="number" min="0" value={preview}
              onChange={(e) => setPreview(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            />
          </label>

          <p className="mt-3 text-h2 font-semibold tabular-nums">{rupees(result.amountPaise)}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{result.workings}</p>

          {result.cappedFrom !== null && (
            <p className="mt-1 text-xs text-warning">
              Would have been {rupees(result.cappedFrom)} without the cap.
            </p>
          )}

          <p className="mt-3 border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
            The preview assumes cost is 60% of value, so the margin basis has something to show.
            Real deals use real costs. This runs the same calculation the server does, so what
            you see here is what gets paid.
          </p>
        </SectionCard>
      </div>
    </>
  );
}
