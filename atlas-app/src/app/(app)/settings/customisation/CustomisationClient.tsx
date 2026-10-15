'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { FALLBACK_LABEL, SURFACE_LABEL, type Fallback, type Surface } from '@/lib/config-registry';
import type { ConfigView, ElementRow, StepRow } from '@/server/config';
import { saveCustomisationAction } from './actions';

/**
 * Settings › Customisation - every element and flow step this business may
 * switch off or rename (F1a, D15 and D16).
 *
 * WHY THE FLOW STEPS ARE A SEPARATE TAB AND NOT JUST MORE SWITCHES.
 *
 * An element switched off hides information. A flow step switched off moves
 * work to somebody else - so it cannot be a bare checkbox: it has to ask where
 * the work goes. Putting the two in one list would invite a client to treat
 * "the technician raises a challan" like "hide prices", and the difference is
 * the one that strands jobs.
 */

type Draft = Record<string, boolean | string>;
type FlowDraft = Record<string, { on: boolean; fallback: Fallback }>;
type LabelDraft = Record<string, { en?: string; hi?: string }>;

export function CustomisationClient({
  view, storeName, canEdit,
}: { view: ConfigView | null; storeName: string; canEdit: boolean }) {
  const [tab, setTab] = useState<Surface | 'flow'>('web');

  /**
   * Seeded once from what is saved, so an untouched switch stays "inherited"
   * rather than being written back as an explicit default.
   *
   * Lazy `useState` initialisers, NOT an effect and not `useMemo`. `view` is a
   * server prop that cannot change without a fresh navigation, and setting
   * state from inside `useMemo` runs during render - which is how the first
   * version of this screen got stuck on "Loading…".
   */
  const [values, setValues] = useState<Draft>(() => {
    const v: Draft = {};
    for (const s of view?.surfaces ?? []) {
      for (const sc of s.screens) {
        for (const e of sc.elements) if (!e.inherited) v[e.key] = e.value as boolean | string;
      }
    }
    return v;
  });
  const [flow, setFlow] = useState<FlowDraft>(() => {
    const f: FlowDraft = {};
    for (const st of view?.steps ?? []) if (!st.inherited) f[st.key] = { on: st.on, fallback: st.fallback };
    return f;
  });
  const [labels, setLabels] = useState<LabelDraft>(() => {
    const l: LabelDraft = {};
    for (const s of view?.surfaces ?? []) {
      for (const sc of s.screens) {
        for (const e of sc.elements) if (e.customLabel) l[e.key] = { en: e.customLabel };
      }
    }
    return l;
  });
  const [search, setSearch] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  if (!view) {
    return (
      <div>
        <PageHeader badge="CU" title="Customisation" subtitle="What your people and your customers see" />
        <Card className="p-4 text-sm">
          Pick a branch in the top bar - these settings belong to one branch.
        </Card>
      </div>
    );
  }

  const off = !canEdit;
  const valueOf = (e: ElementRow) => (values[e.key] === undefined ? e.value : values[e.key]);
  const stepOf = (s: StepRow) => flow[s.key] ?? { on: s.on, fallback: s.fallback };

  const setValue = (key: string, v: boolean | string) => {
    setValues((p) => ({ ...p, [key]: v })); setMsg(null);
  };
  const setStep = (key: string, patch: Partial<{ on: boolean; fallback: Fallback }>) => {
    // Start from the step's own saved value, not a guess. Until 6 Oct this
    // started from "skip", so unticking a step that cannot be skipped
    // ("Technician raises a parts challan") stored skip while the dropdown
    // showed its first option - and the save was refused for a choice the
    // screen said was already made.
    const row = view.steps.find((x) => x.key === key);
    setFlow((p) => {
      const next = { ...(p[key] ?? { on: row?.on ?? true, fallback: row?.fallback ?? ('skip' as Fallback) }), ...patch };
      if (row && row.options.length > 0 && !row.options.includes(next.fallback)) next.fallback = row.options[0]!;
      return { ...p, [key]: next };
    });
    setMsg(null);
  };
  const setLabel = (key: string, en: string) => {
    setLabels((p) => {
      const next = { ...p };
      if (en.trim()) next[key] = { ...next[key], en: en.trim() };
      else delete next[key];
      return next;
    });
    setMsg(null);
  };

  const save = () => start(async () => {
    const r = await saveCustomisationAction({ values, flow, labels });
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved.' });
  });

  const q = search.trim().toLowerCase();
  const matches = (e: ElementRow) =>
    !q || e.label.toLowerCase().includes(q) || e.hint.toLowerCase().includes(q) || e.key.toLowerCase().includes(q);

  const tabs: { key: Surface | 'flow'; label: string; count: number }[] = [
    ...view.surfaces.map((s) => ({
      key: s.surface,
      label: SURFACE_LABEL[s.surface],
      count: s.screens.reduce((n, sc) => n + sc.elements.length, 0),
    })),
    { key: 'flow' as const, label: 'Who does what', count: view.steps.length },
  ];

  const stepsOff = view.steps.filter((s) => !stepOf(s).on).length;

  return (
    <div className="grid gap-4">
      <PageHeader
        badge="CU" title="Customisation"
        subtitle={`What your people and your customers see - ${storeName}`}
        actions={canEdit
          ? <Button variant="primary" icon="check" loading={pending} onClick={save}>Save</Button>
          : undefined}
      />

      {msg && (
        <Card className={`p-3 text-sm ${msg.ok ? 'border-success/40 text-success' : 'border-danger/40 text-danger'}`}>
          <span role="status">{msg.text}</span>
        </Card>
      )}

      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {tabs.map((t) => (
              <button
                key={t.key} type="button" onClick={() => setTab(t.key)}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  tab === t.key ? 'bg-brand text-white' : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label} <span className="opacity-70">{t.count}</span>
              </button>
            ))}
          </div>
          {tab !== 'flow' && (
            <div className="ms-auto min-w-[220px] flex-1">
              <input
                type="search" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search these settings…" aria-label="Search settings"
                className="field-input h-9"
              />
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {view.customisedCount === 0
            ? 'Nothing customised yet - everything is on its standard setting.'
            : `${view.customisedCount} setting${view.customisedCount === 1 ? '' : 's'} changed from standard.`}
          {stepsOff > 0 && ` ${stepsOff} step${stepsOff === 1 ? '' : 's'} handed over or skipped.`}
        </p>
      </Card>

      {tab !== 'flow' && view.surfaces.filter((s) => s.surface === tab).map((s) => (
        <div key={s.surface} className="grid gap-4">
          {s.screens.map((sc) => {
            const shown = sc.elements.filter(matches);
            if (!shown.length) return null;
            return (
              <SectionCard key={sc.screen} title={sc.screen} icon="sliders">
                <div className="grid gap-3">
                  {shown.map((e) => (
                    <div key={e.key} className="grid gap-1.5 border-b border-border pb-3 last:border-0 last:pb-0">
                      <label className="flex items-start gap-2 text-sm">
                        {e.kind === 'bool' ? (
                          <input
                            type="checkbox" className="mt-0.5"
                            disabled={off || !e.available}
                            checked={valueOf(e) === true}
                            onChange={(ev) => setValue(e.key, ev.target.checked)}
                          />
                        ) : null}
                        <span>
                          <strong>{labels[e.key]?.en || e.label}</strong>
                          {!e.available && (
                            <span className="ms-2 text-xs text-muted-foreground">
                              (no role here has the permission for this)
                            </span>
                          )}
                          {e.inherited && values[e.key] === undefined && (
                            <span className="ms-2 text-xs text-muted-foreground">standard</span>
                          )}
                          <span className="block text-xs text-muted-foreground">{e.hint}</span>
                        </span>
                      </label>

                      {e.kind === 'choice' && (
                        <select
                          aria-label={e.label} disabled={off || !e.available}
                          value={String(valueOf(e))}
                          onChange={(ev) => setValue(e.key, ev.target.value)}
                          className="field-input max-w-xs"
                        >
                          {(e.choices ?? []).map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      )}

                      <Field label="Call it something else (optional)" htmlFor={`lbl-${e.key}`}>
                        <input
                          id={`lbl-${e.key}`} type="text" disabled={off}
                          value={labels[e.key]?.en ?? ''}
                          onChange={(ev) => setLabel(e.key, ev.target.value)}
                          placeholder={e.label}
                          className="field-input max-w-sm"
                        />
                      </Field>
                    </div>
                  ))}
                </div>
              </SectionCard>
            );
          })}
        </div>
      ))}

      {tab === 'flow' && (
        <SectionCard title="Who does what on a job" icon="settings">
          <p className="mb-3 text-xs text-muted-foreground">
            Switching a step off never makes the work disappear - it either moves to somebody
            else or is genuinely skipped. That is why each one asks. A step that must happen for
            a job to finish cannot be switched off at all.
          </p>
          <div className="grid gap-3">
            {view.steps.map((s) => {
              const cur = stepOf(s);
              return (
                <div key={s.key} className="grid gap-1.5 border-b border-border pb-3 last:border-0 last:pb-0">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox" className="mt-0.5"
                      disabled={off || !s.switchable}
                      checked={cur.on}
                      onChange={(ev) => setStep(s.key, { on: ev.target.checked })}
                    />
                    <span>
                      <strong>{s.label}</strong>
                      <span className="ms-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {s.actor}
                      </span>
                      {!s.switchable && (
                        <span className="ms-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Icon name="lock" className="h-3 w-3" /> always on
                        </span>
                      )}
                      <span className="block text-xs text-muted-foreground">{s.hint}</span>
                    </span>
                  </label>

                  {!cur.on && s.switchable && (
                    <div className="ms-6 grid gap-1.5">
                      <Field label="Then what happens?" htmlFor={`fb-${s.key}`}>
                        <select
                          id={`fb-${s.key}`} disabled={off}
                          value={cur.fallback}
                          onChange={(ev) => setStep(s.key, { fallback: ev.target.value as Fallback })}
                          className="field-input max-w-xs"
                        >
                          {s.options.map((f) => (
                            <option key={f} value={f}>{FALLBACK_LABEL[f]}</option>
                          ))}
                        </select>
                      </Field>
                      {cur.fallback === 'delegate' && s.delegateTo && (
                        <p className="text-xs text-muted-foreground">
                          A request goes to whoever has <strong>{s.delegateTo}</strong> in this branch.
                          They see it in their requests list.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
