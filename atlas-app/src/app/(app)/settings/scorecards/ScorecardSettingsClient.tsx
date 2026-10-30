'use client';

import { useState, useTransition } from 'react';
import { PageHeader, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import {
  FIELD_PILLARS, OFFICE_PILLARS, PILLAR_LABEL, RULE_KEYS, RULE_LABEL,
  type RuleKind, type ScorecardSettings, type TemplateChoice,
} from '@/lib/scorecard/settings';
import { saveScorecardSettingsAction } from './actions';

const LIMITS: [keyof ScorecardSettings['limits'], string, string][] = [
  ['draftMinutes', 'Draft window', 'minutes the creator may fix their own entry before it counts'],
  ['usefulRemarkWords', 'Useful remark', 'words at least'],
  ['gapMinutes', 'Location gap', 'minutes with no location before it counts'],
  ['visitLateMinutes', 'Late for a visit', 'minutes after the booked time'],
  ['unassignedMinutes', 'Assign within', 'working minutes'],
  ['approvalHours', 'Approve within', 'hours'],
  ['reopenDays', 'Reopened within', 'days of closing'],
  ['callbackHours', 'Call back within', 'hours'],
  ['overrideFarM', 'Far-off site', 'metres from the pin'],
  ['recreateHours', 'Cancel and remake within', 'hours'],
  ['duplicateDays', 'Duplicate job within', 'days'],
  ['minEvents', 'Enough data', 'events before a number is ranked'],
  ['contributedCredit', 'Helped-close credit', 'of a closed job (0 to 1)'],
];

const box = 'h-9 w-24 rounded-lg border border-border bg-card px-2 text-sm tabular-nums';

export function ScorecardSettingsClient({ initial, roles, canEdit, needsBranch }: {
  initial: ScorecardSettings;
  roles: { id: string; name: string; guess: TemplateChoice }[];
  canEdit: boolean;
  needsBranch: boolean;
}) {
  const [s, setS] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const num = (v: string) => (v === '' ? 0 : Number(v));
  const save = () => start(async () => {
    const r = await saveScorecardSettingsAction(s);
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: 'Saved. Scorecards use it from now on.' });
  });

  return (
    <div className="grid gap-4">
      <PageHeader title="Scorecards" subtitle="How technicians and office staff are scored on their employee page" />
      {needsBranch && <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">Pick a branch in the top bar to change its scorecards. Showing the defaults.</p>}

      <SectionCard title="Who is scored as what" icon="users">
        <p className="mb-3 text-xs text-muted-foreground">A person is scored against everyone on the same scorecard. Someone with a technician role and an office role is scored as a technician.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {roles.map((r) => (
            <label key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm" htmlFor={`role-${r.id}`}>
              <span className="truncate">{r.name}</span>
              <select id={`role-${r.id}`} disabled={!canEdit} value={s.roleTemplates[r.id] ?? r.guess}
                onChange={(e) => setS({ ...s, roleTemplates: { ...s.roleTemplates, [r.id]: e.target.value as TemplateChoice } })}
                className="h-8 rounded-lg border border-border bg-card px-2 text-sm">
                <option value="field">Technician scorecard</option>
                <option value="office">Office scorecard</option>
                <option value="none">Not scored</option>
              </select>
            </label>
          ))}
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {(['field', 'office'] as const).map((t) => (
          <SectionCard key={t} title={t === 'field' ? 'Technician weights' : 'Office weights'} icon="sliders">
            <div className="grid gap-2">
              {(t === 'field' ? FIELD_PILLARS : OFFICE_PILLARS).map((p) => (
                <label key={p} className="flex items-center justify-between text-sm" htmlFor={`w-${t}-${p}`}>
                  {PILLAR_LABEL[p]}
                  <input id={`w-${t}-${p}`} type="number" min={0} max={100} disabled={!canEdit} className={box}
                    value={(s.weights[t] as Record<string, number>)[p]}
                    onChange={(e) => setS({ ...s, weights: { ...s.weights, [t]: { ...s.weights[t], [p]: num(e.target.value) } } })} />
                </label>
              ))}
              <p className="text-xs text-muted-foreground">Weights are shares of the score; a pillar with no data is left out and the others grow.</p>
            </div>
          </SectionCard>
        ))}
      </div>

      <SectionCard title="Limits" icon="clock">
        <div className="grid gap-2 sm:grid-cols-2">
          {LIMITS.map(([k, label, unit]) => (
            <label key={k} className="flex items-center justify-between gap-2 text-sm" htmlFor={`lim-${k}`}>
              <span>{label} <span className="text-xs text-muted-foreground">· {unit}</span></span>
              <input id={`lim-${k}`} type="number" min={0} step={k === 'contributedCredit' ? 0.1 : 1} disabled={!canEdit} className={box}
                value={s.limits[k]} onChange={(e) => setS({ ...s, limits: { ...s.limits, [k]: num(e.target.value) } })} />
            </label>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Office hygiene rules" icon="shield-check">
        <p className="mb-3 text-xs text-muted-foreground">A mistake counts 2, an SOP miss 1, watch only 0. A miss lands on whoever entered the wrong value, never on the person who fixed it.</p>
        <div className="grid gap-2">
          {RULE_KEYS.map((k) => (
            <div key={k} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <label className="flex items-center gap-2" htmlFor={`rule-${k}`}>
                <input id={`rule-${k}`} type="checkbox" disabled={!canEdit} checked={s.rules[k].on}
                  onChange={(e) => setS({ ...s, rules: { ...s.rules, [k]: { ...s.rules[k], on: e.target.checked } } })} />
                {RULE_LABEL[k]}
              </label>
              <select aria-label={`${RULE_LABEL[k]} counts as`} disabled={!canEdit || !s.rules[k].on} value={s.rules[k].kind}
                onChange={(e) => setS({ ...s, rules: { ...s.rules, [k]: { ...s.rules[k], kind: e.target.value as RuleKind } } })}
                className="h-8 rounded-lg border border-border bg-card px-2 text-sm">
                <option value="mistake">Mistake</option><option value="sop">SOP miss</option><option value="watch">Watch only</option>
              </select>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Reward check" icon="check-circle">
        <div className="grid gap-2 sm:grid-cols-2">
          {([
            ['field', 'minScore', 'Technician: score at least'], ['field', 'maxLate', 'Technician: late per 20 days at most'], ['field', 'minRating', 'Technician: rating at least'],
            ['office', 'minScore', 'Office: score at least'], ['office', 'maxLate', 'Office: late per 20 days at most'], ['office', 'maxMistakes', 'Office: mistakes at most'],
          ] as const).map(([t, k, label]) => (
            <label key={`${t}-${k}`} className="flex items-center justify-between gap-2 text-sm" htmlFor={`rw-${t}-${k}`}>
              {label}
              <input id={`rw-${t}-${k}`} type="number" min={0} step={k === 'minRating' ? 0.1 : 1} disabled={!canEdit} className={box}
                value={(s.rewards[t] as Record<string, number>)[k]}
                onChange={(e) => setS({ ...s, rewards: { ...s.rewards, [t]: { ...s.rewards[t], [k]: num(e.target.value) } } })} />
            </label>
          ))}
        </div>
      </SectionCard>

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button variant="primary" loading={pending} onClick={save}>Save scorecards</Button>
          {msg && <span role="status" className={`text-sm ${msg.ok ? 'text-success' : 'text-danger'}`}>{msg.text}</span>}
        </div>
      )}
    </div>
  );
}
