'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Badge, Card, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { APPROVER_KINDS, type ApproverKind, type Rule, type RuleLevel } from '@/lib/approval-rules';
import { DEFAULT_RENEWAL_TEMPLATE } from '@/lib/renewal-cycle';
import { ALARM_TONES, ALARM_TONE_LABEL, type AlarmTone } from '@/lib/alarm-tones';
import type { RuleRow } from '@/server/approval-rules-admin';
import type { BusinessNotificationSettings, PushStyle } from '@/server/notify';
import { applyPresetAction, resetRuleAction, saveDefaultsAction, saveRuleAction } from './actions';

/**
 * Settings > Approval Rules & Notifications (27 Sep 2026).
 *
 * Approval rules: per kind of request - does it need approval, from what
 * amount, who approves level by level, who skips it, and when to remind and
 * escalate. Nothing saved = the setup from before (shown on each row).
 * Notifications: which kinds go by phone / email by default, the renewal
 * reminder days, the WhatsApp message and the owner's morning summary.
 */
type Choice = { id: string; name?: string; fullName?: string };
const rupees = (p: number | null) => (p === null ? '' : `₹${(p / 100).toLocaleString('en-IN')}`);

function describe(rule: Rule, roles: Choice[], users: Choice[]): string {
  if (!rule.needsApproval) return 'No approval needed';
  const who = (l: RuleLevel) => (l.approverKind === 'role' ? roles.find((r) => r.id === l.roleId)?.name ?? 'a role'
    : l.approverKind === 'user' ? users.find((u) => u.id === l.userId)?.fullName ?? 'a person'
      : APPROVER_KINDS.find((k) => k.key === l.approverKind)?.label ?? '');
  const chain = [...rule.levels].sort((a, b) => a.level - b.level).map((l) => `${who(l)}${l.minAmountPaise ? ` (from ${rupees(l.minAmountPaise)})` : ''}`).join(' → ');
  const skip = rule.skipRoleIds.length + rule.skipUserIds.length;
  return [
    rule.thresholdPaise ? `from ${rupees(rule.thresholdPaise)}` : null,
    rule.maxDiscountPct != null ? `discount over ${rule.maxDiscountPct}%` : null,
    rule.minMarginPct != null ? `margin under ${rule.minMarginPct}%` : null,
    chain, skip ? `${skip} skip` : null,
  ].filter(Boolean).join(' · ');
}

export function ApprovalRulesClient({ rows, roles, users, defaults, storeName, scopeIsAll }: {
  rows: RuleRow[]; roles: Choice[]; users: Choice[]; defaults: BusinessNotificationSettings | null; storeName: string; scopeIsAll: boolean;
}) {
  const [tab, setTab] = useState<'rules' | 'notifications'>('rules');
  const [editing, setEditing] = useState<RuleRow | null>(null);
  const [preset, setPreset] = useState<'strict' | 'balanced' | 'relaxed' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, after?: () => void) => {
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (r.error) setMsg({ tone: 'err', text: r.error });
      else { setMsg({ tone: 'ok', text: ok }); after?.(); }
    });
  };
  const groups = [...new Set(rows.map((r) => r.group))];

  return (
    <div>
      <PageHeader badge="AR" title="Approval Rules & Notifications" subtitle={scopeIsAll ? 'What needs approval, and who is told' : `What needs approval, and who is told · ${storeName}`} />
      {scopeIsAll && (
        <Card className="mb-3 border-warning/40 bg-warning/5 p-3 text-sm">
          <strong>All Company</strong> - each branch keeps its own rules. Select a single store to see and change them.
        </Card>
      )}
      {msg && (
        <Card className={`mb-3 p-3 text-sm ${msg.tone === 'err' ? 'border-danger/40 bg-danger/5 text-danger' : 'border-success/40 bg-success/5 text-success'}`}>
          <span role={msg.tone === 'err' ? 'alert' : 'status'}>{msg.text}</span>
        </Card>
      )}

      {!scopeIsAll && (
        <>
          <nav aria-label="Section" className="mb-4 flex gap-1 rounded-lg border border-border bg-card p-1">
            {([['rules', 'Approval rules'], ['notifications', 'Notifications & reminders']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}
                className={`rounded px-4 py-1.5 text-sm ${tab === k ? 'bg-brand/10 font-semibold text-brand' : 'hover:bg-muted'}`}>{l}</button>
            ))}
          </nav>

          {tab === 'rules' && (
            <div className="grid gap-4">
              <Card className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <Icon name="sparkles" className="h-4 w-4 text-brand" />
                <span className="flex-1">Start from a preset, then adjust any row. Skip lists you already set are kept.</span>
                <Button size="sm" onClick={() => setPreset('strict')}>Strict</Button>
                <Button size="sm" variant="primary" onClick={() => setPreset('balanced')}>Balanced</Button>
                <Button size="sm" onClick={() => setPreset('relaxed')}>Relaxed</Button>
              </Card>
              {groups.map((g) => (
                <SectionCard key={g} title={g} icon="check-circle" bodyClassName="p-0">
                  <ul>
                    {rows.filter((r) => r.group === g).map((r) => (
                      <li key={r.type} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 last:border-0">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{r.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {r.rule ? describe(r.rule, roles, users) : <><Badge tone="neutral">Current setup</Badge> {r.current}</>}
                          </p>
                        </div>
                        <Button size="sm" icon="pencil" onClick={() => setEditing(r)}>{r.rule ? 'Edit' : 'Set rule'}</Button>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              ))}
            </div>
          )}

          {tab === 'notifications' && defaults && (
            <NotificationDefaults defaults={defaults} busy={pending}
              save={(patch) => run(() => saveDefaultsAction(patch), 'Saved.')} />
          )}
        </>
      )}

      {editing && (
        <RuleDialog row={editing} roles={roles} users={users} busy={pending} onClose={() => setEditing(null)}
          onSave={(rule) => run(() => saveRuleAction({ ...rule, type: editing.type }), `${editing.label}: rule saved.`, () => { setEditing(null); location.reload(); })}
          onReset={() => run(() => resetRuleAction(editing.type), `${editing.label}: back to the current setup.`, () => { setEditing(null); location.reload(); })} />
      )}
      {preset && (
        <ConfirmDialog
          title={`Apply the ${preset} preset to every request type?`}
          message={preset === 'strict' ? 'Everything waits for the owner.' : preset === 'balanced' ? "People's requests go to their manager; money from ₹25,000 needs approval, and from ₹1 lakh the owner too." : 'Only money from ₹1 lakh needs the owner; people requests go to their manager; service slips need no approval.'}
          confirmLabel="Apply"
          busy={pending}
          onConfirm={() => run(() => applyPresetAction(preset), 'Preset applied.', () => { setPreset(null); location.reload(); })}
          onClose={() => setPreset(null)}
        />
      )}
    </div>
  );
}

function RuleDialog({ row, roles, users, busy, onClose, onSave, onReset }: {
  row: RuleRow; roles: Choice[]; users: Choice[]; busy: boolean; onClose: () => void; onSave: (r: Rule) => void; onReset: () => void;
}) {
  const start: Rule = row.rule ?? {
    needsApproval: true, thresholdPaise: null, skipRoleIds: [], skipUserIds: [], nudgeHours: 24, escalateHours: 48, escalateTo: 'owner',
    levels: [{ level: 1, approverKind: row.group === 'People' ? 'manager' : 'owner', roleId: null, userId: null, minAmountPaise: null }],
  };
  const [r, setR] = useState<Rule>(start);
  const set = <K extends keyof Rule>(k: K, v: Rule[K]) => setR((x) => ({ ...x, [k]: v }));
  const setLevel = (i: number, patch: Partial<RuleLevel>) => set('levels', r.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const money = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 100));

  return (
    <Modal title={`Approval rule - ${row.label}`} subtitle={row.rule ? undefined : `Now: ${row.current}`} icon="check-circle" size="lg" onClose={onClose}
      footer={<>
        {row.rule && <Button onClick={onReset} disabled={busy}>Back to current setup</Button>}
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => onSave({ ...r, levels: r.levels.map((l, i) => ({ ...l, level: i + 1 })) })}>Save rule</Button>
      </>}>
      <div className="grid gap-4 text-sm">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" checked={r.needsApproval} onChange={(e) => set('needsApproval', e.target.checked)} />
          Needs approval
        </label>

        {r.needsApproval && (
          <>
            {row.hasAmount && (
              <Field label="Needs approval from" htmlFor="rule-threshold" hint="Below this it is approved automatically. Leave empty for every amount.">
                <div className="flex items-center gap-1.5"><span>₹</span>
                  <input id="rule-threshold" type="number" min={0} value={r.thresholdPaise === null ? '' : r.thresholdPaise / 100}
                    onChange={(e) => set('thresholdPaise', money(e.target.value))} className="field-input max-w-[12rem]" />
                </div>
              </Field>
            )}

            {/* 5 Oct 2026: a deep discount or a thin margin can need a sign-off
                however small the amount. Any one condition is enough. */}
            {row.hasPricing && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Also when the discount is above" htmlFor="rule-disc" hint="Item + order discount, as % of the subtotal. Leave empty to ignore.">
                  <div className="flex items-center gap-1.5">
                    <input id="rule-disc" type="number" min={0} max={100} step="0.5" value={r.maxDiscountPct ?? ''}
                      onChange={(e) => set('maxDiscountPct', e.target.value === '' ? null : Number(e.target.value))} className="field-input max-w-[8rem]" /><span>%</span>
                  </div>
                </Field>
                <Field label="Also when the margin is below" htmlFor="rule-margin" hint="After goods cost, freight and incentive. Ignored when the cost is not known.">
                  <div className="flex items-center gap-1.5">
                    <input id="rule-margin" type="number" min={-100} max={100} step="0.5" value={r.minMarginPct ?? ''}
                      onChange={(e) => set('minMarginPct', e.target.value === '' ? null : Number(e.target.value))} className="field-input max-w-[8rem]" /><span>%</span>
                  </div>
                </Field>
              </div>
            )}

            <fieldset className="grid gap-2">
              <legend className="mb-1 font-medium">Who approves, in order</legend>
              {r.levels.map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                  <span className="w-14 text-xs font-semibold text-muted-foreground">Level {i + 1}</span>
                  <select aria-label={`Level ${i + 1} approver`} value={l.approverKind} onChange={(e) => setLevel(i, { approverKind: e.target.value as ApproverKind })} className="field-input h-9 max-w-[14rem]">
                    {APPROVER_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                  {l.approverKind === 'role' && (
                    <select aria-label="Role" value={l.roleId ?? ''} onChange={(e) => setLevel(i, { roleId: e.target.value || null })} className="field-input h-9 max-w-[12rem]">
                      <option value="">Choose role…</option>
                      {roles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  )}
                  {l.approverKind === 'user' && (
                    <select aria-label="Person" value={l.userId ?? ''} onChange={(e) => setLevel(i, { userId: e.target.value || null })} className="field-input h-9 max-w-[12rem]">
                      <option value="">Choose person…</option>
                      {users.map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}
                    </select>
                  )}
                  {row.hasAmount && i > 0 && (
                    <label className="flex items-center gap-1 text-xs">only from ₹
                      <input type="number" min={0} aria-label={`Level ${i + 1} from amount`} value={l.minAmountPaise === null ? '' : l.minAmountPaise / 100}
                        onChange={(e) => setLevel(i, { minAmountPaise: money(e.target.value) })} className="field-input h-9 w-28" />
                    </label>
                  )}
                  {r.levels.length > 1 && (
                    <button type="button" aria-label={`Remove level ${i + 1}`} onClick={() => set('levels', r.levels.filter((_, j) => j !== i))} className="ms-auto text-muted-foreground hover:text-danger">
                      <Icon name="x" className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => set('levels', [...r.levels, { level: r.levels.length + 1, approverKind: 'owner', roleId: null, userId: null, minAmountPaise: null }])}
                className="self-start text-xs font-medium text-brand hover:underline">+ Add a level</button>
              <p className="text-xs text-muted-foreground">Nobody ever approves their own request - it goes to the next person or the owner.</p>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="mb-1 font-medium">Skip approval for</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {roles.map((x) => (
                  <label key={x.id} className="flex items-center gap-1.5"><input type="checkbox" checked={r.skipRoleIds.includes(x.id)} onChange={() => set('skipRoleIds', toggle(r.skipRoleIds, x.id))} />{x.name} <span className="text-xs text-muted-foreground">(role)</span></label>
                ))}
              </div>
              <div className="thin-scroll flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {users.map((x) => (
                  <label key={x.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={r.skipUserIds.includes(x.id)} onChange={() => set('skipUserIds', toggle(r.skipUserIds, x.id))} />{x.fullName}</label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-end gap-3">
              <Field label="Remind the approver after" htmlFor="rule-nudge">
                <div className="flex items-center gap-1"><input id="rule-nudge" type="number" min={1} value={r.nudgeHours} onChange={(e) => set('nudgeHours', Number(e.target.value))} className="field-input w-20" /> hours</div>
              </Field>
              <Field label="Escalate after" htmlFor="rule-esc">
                <div className="flex items-center gap-1"><input id="rule-esc" type="number" min={1} value={r.escalateHours} onChange={(e) => set('escalateHours', Number(e.target.value))} className="field-input w-20" /> hours</div>
              </Field>
              <Field label="Escalate to" htmlFor="rule-esc-to">
                <select id="rule-esc-to" value={r.escalateTo} onChange={(e) => set('escalateTo', e.target.value as Rule['escalateTo'])} className="field-input">
                  <option value="owner">Owner / admins</option>
                  <option value="next_level">The next level</option>
                </select>
              </Field>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

const KINDS: [keyof BusinessNotificationSettings['channels'], string][] = [
  ['approval_waiting', 'Approvals waiting'], ['approval_decided', 'Decisions on requests'], ['escalation', 'Escalations'],
  ['renewal', 'Renewals & due dates'], ['reminder', 'Personal reminders'], ['system', 'Owner morning summary'],
  ['shop_request', 'Online shop requests'],
];

function NotificationDefaults({ defaults, save, busy }: {
  defaults: BusinessNotificationSettings; busy: boolean;
  save: (patch: Partial<Pick<BusinessNotificationSettings, 'channels' | 'renewalOffsets' | 'whatsappTemplate' | 'dailySummary' | 'alertsWhenSignedOut' | 'alarmTone'>>) => void;
}) {
  const [channels, setChannels] = useState(defaults.channels);
  const [offsets, setOffsets] = useState(defaults.renewalOffsets.join(', '));
  const [template, setTemplate] = useState(defaults.whatsappTemplate ?? DEFAULT_RENEWAL_TEMPLATE);
  const [summary, setSummary] = useState(defaults.dailySummary);
  const [loggedOut, setLoggedOut] = useState(defaults.alertsWhenSignedOut);
  const [tone, setTone] = useState<AlarmTone>(defaults.alarmTone ?? 'bell');
  const flip = (k: keyof typeof channels, ch: 'push' | 'email') => setChannels((c) => ({ ...c, [k]: { ...(c[k] ?? { push: false, email: false }), [ch]: !(c[k]?.[ch]) } }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Who is told, and how" icon="alert-circle">
        <p className="mb-2 text-xs text-muted-foreground">
          The bell always shows everything. These are the business defaults for phone notifications and email; each person can turn their own off.
          Urgent rings like an alarm on the lock screen (Vcare 1.0.13 or later); Quiet arrives without sound.
          Email needs the email service set up.
        </p>
        <table className="w-full text-xs">
          <thead><tr className="text-muted-foreground"><th className="py-1 text-start font-medium">Kind</th><th className="font-medium">Phone</th><th className="font-medium">How on the phone</th><th className="font-medium">Email</th></tr></thead>
          <tbody>
            {KINDS.map(([k, label]) => (
              <tr key={k} className="border-t border-border">
                <td className="py-1.5">{label}</td>
                <td className="text-center"><input type="checkbox" aria-label={`${label} on phone`} checked={!!channels[k]?.push} onChange={() => flip(k, 'push')} /></td>
                <td className="text-center">
                  {/* 5 Oct 2026: per activity, how loud the phone is about it. */}
                  <select aria-label={`${label} - how on the phone`} disabled={!channels[k]?.push} value={channels[k]?.style ?? 'normal'}
                    onChange={(e) => setChannels((c) => ({ ...c, [k]: { ...(c[k] ?? { push: true, email: false }), style: e.target.value as PushStyle } }))}
                    className="h-7 rounded border border-border bg-card px-1 text-xs disabled:opacity-50">
                    <option value="quiet">Quiet</option>
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent (lock screen, loud)</option>
                  </select>
                </td>
                <td className="text-center"><input type="checkbox" aria-label={`${label} by email`} checked={!!channels[k]?.email} onChange={() => flip(k, 'email')} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={summary} onChange={(e) => setSummary(e.target.checked)} />
          Morning summary for the owner at 8 AM
        </label>
        {/*
          F-05, 10 Oct 2026. Asked in the words of the decision, not the
          mechanism: nobody should have to understand push notifications to
          answer it. Whichever way it is set, NO business detail ever reaches
          a phone with no session - see server/notify sendPush. The only
          question is whether such a phone rings at all.
        */}
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input
            type="checkbox" className="mt-0.5" checked={loggedOut}
            onChange={(e) => setLoggedOut(e.target.checked)}
          />
          <span>
            Ring an urgent alert even when the person has signed out of the app
            <span className="block text-xs text-muted-foreground">
              The alert says only that something urgent is waiting and to sign in - never the
              customer, the amount or the document. Switch this off for phones that get handed
              around, and the person sees it when they next sign in.
            </span>
          </span>
        </label>
        {/* G-40, decision 13 (13 Oct 2026): reminders ring like an alarm clock on Vcare 1.0.19+. */}
        <Field label="Reminder alarm sound" htmlFor="alarm-tone" hint="What a reminder rings with on the phone, full screen, until it is tapped. Each person can pick their own on the phone.">
          <select id="alarm-tone" value={tone} onChange={(e) => setTone(e.target.value as AlarmTone)} className="field-input">
            {ALARM_TONES.map((t) => <option key={t} value={t}>{ALARM_TONE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Button className="mt-3" variant="primary" size="sm" loading={busy}
          onClick={() => save({ channels, dailySummary: summary, alertsWhenSignedOut: loggedOut, alarmTone: tone })}>
          Save
        </Button>
      </SectionCard>

      <SectionCard title="Renewal reminders" icon="clock">
        <Field label="Remind this many days before the due date" htmlFor="ren-offsets" hint="Comma separated. 0 = on the day. A single policy can have its own days.">
          <input id="ren-offsets" value={offsets} onChange={(e) => setOffsets(e.target.value)} className="field-input" placeholder="15, 7, 0" />
        </Field>
        <Field label="WhatsApp message to the client" htmlFor="ren-template"
          hint="Placeholders: {client} {policy} {number} {due_date} {amount} {business} {days_left}">
          <textarea id="ren-template" rows={5} value={template} onChange={(e) => setTemplate(e.target.value)} className="field-input" />
        </Field>
        <Button className="mt-3" variant="primary" size="sm" loading={busy}
          onClick={() => save({ renewalOffsets: offsets.split(/[,\s]+/).filter(Boolean).map(Number), whatsappTemplate: template.trim() === DEFAULT_RENEWAL_TEMPLATE ? null : template })}>
          Save
        </Button>
      </SectionCard>
    </div>
  );
}
