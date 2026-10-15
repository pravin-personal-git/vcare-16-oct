'use client';

import { useState, useTransition } from 'react';
import { Badge, Card, EmptyState, Field, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ListFilter } from '@/components/ui/ListFilter';
import { mapCodeAction, setDeviceVendorAction, unmapCodeAction } from './actions';
import { ConnectorPanel, type AgentVM } from './ConnectorPanel';

/**
 * Setting a machine up, and putting names to the numbers it sends (F2.5).
 *
 * TWO JOBS ON ONE SCREEN, ON PURPOSE.
 *
 * Choosing the adapter and mapping employee codes are the same task twenty
 * minutes apart: you point Atlas at the machine, punches start arriving, and
 * the ones that match nobody appear below. Splitting them across two pages
 * would mean an admin finishes setup, sees "0 punches", and has no idea the
 * queue exists.
 */

export interface VendorChoice { value: string; label: string; hint: string; transport: string }
export interface AdapterField { key: string; label: string; secret?: boolean; placeholder?: string }

export interface DeviceVendorVM {
  id: string;
  label: string;
  vendor: string | null;
  vendorLabel: string | null;
  transport: string | null;
  directionMode: string;
  config: Record<string, string>;
}

export interface HealthVM {
  deviceId: string;
  label: string;
  lastPunchAt: string | null;
  lastCalledAt: string | null;
  punchesToday: number;
  unappliedCount: number;
  clockSkewSeconds: number | null;
  silent: boolean;
  totalPunches: number;
  vendor: string | null;
  agent: AgentVM;
}

export interface QueueVM {
  codes: {
    employeeCode: string;
    punches: number;
    firstSeen: string;
    lastSeen: string;
    suggestions: { userId: string; fullName: string; userCode: string; why: string }[];
  }[];
  users: { id: string; fullName: string; userCode: string; claimed: boolean }[];
  mappedCount: number;
}

const when = (iso: string | null) =>
  (iso ? new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }) : 'never');

const DIRECTION_HELP: Record<string, string> = {
  first_last: 'First touch of the day is arrival, last is leaving. Right for almost everybody - most staff just touch and walk.',
  from_state: 'Trust the machine’s own IN / OUT. Only if your staff really do press the buttons.',
};

export function CaptureSetup({
  devices, choices, fieldsByVendor, health, queue, canManage,
}: {
  devices: DeviceVendorVM[];
  choices: VendorChoice[];
  fieldsByVendor: Record<string, AdapterField[]>;
  health: HealthVM[];
  queue: QueueVM;
  canManage: boolean;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) => {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Saved.' });
      if (!r.error) setEditing(null);
    });
  };

  return (
    <div className="grid gap-4">
      {msg && (
        <Card className={`p-3 text-sm ${msg.ok ? 'border-success/40 text-success' : 'border-danger/40 text-danger'}`}>
          <span role={msg.ok ? 'status' : 'alert'}>{msg.text}</span>
        </Card>
      )}

      <SectionCard title="Which machine is it?" icon="settings">
        <p className="mb-3 text-xs text-muted-foreground">
          Atlas talks to the <strong>software behind</strong> your attendance machine, never to the
          machine itself &mdash; so no fingerprint or face data ever reaches us. Pick whichever
          matches what your biometric company runs.
        </p>

        {devices.length === 0 ? (
          <EmptyState icon="phone" title="No machines registered yet" hint="Add one above, then come back to choose its type." />
        ) : (
          <div className="grid gap-3">
            {devices.map((d) => {
              const open = editing === d.id;
              const fields = fieldsByVendor[d.vendor ?? ''] ?? [];
              return (
                <div key={d.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{d.label}</span>
                    {d.vendorLabel
                      ? <Badge tone="info">{d.vendorLabel}</Badge>
                      : <Badge tone="warning">Type not chosen</Badge>}
                    {d.transport && <Badge tone="neutral">{d.transport}</Badge>}
                    {canManage && (
                      <Button size="sm" variant="outline" className="ms-auto"
                        onClick={() => setEditing(open ? null : d.id)}>
                        {open ? 'Close' : d.vendor ? 'Change' : 'Set up'}
                      </Button>
                    )}
                  </div>

                  {!open && d.vendor && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {DIRECTION_HELP[d.directionMode] ?? d.directionMode}
                    </p>
                  )}

                  {open && (
                    <VendorForm
                      device={d} choices={choices} fieldsByVendor={fieldsByVendor}
                      busy={pending}
                      onSave={(input) => run(() => setDeviceVendorAction(d.id, input))}
                    />
                  )}

                  {!open && d.vendor && fields.some((f) => f.secret) && (
                    <p className="mt-2 flex items-start gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                      <Icon name="lock" className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        The password for this machine is <strong>not stored in Atlas</strong>. It lives
                        in the connector on your office computer, and in your password manager.
                      </span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {health.length > 0 && (
        <SectionCard title="Are the machines talking to us?" icon="clock" bodyClassName="p-0">
          <div className="divide-y divide-border">
            {health.map((h) => (
              <div key={h.deviceId} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {h.label}
                    {h.silent && <Badge tone="danger">Nothing heard</Badge>}
                    {h.unappliedCount > 0 && <Badge tone="warning">{h.unappliedCount} waiting</Badge>}
                    {h.clockSkewSeconds !== null && Math.abs(h.clockSkewSeconds) > 300 && (
                      <Badge tone="warning">Clock {Math.round(h.clockSkewSeconds / 60)} min out</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {h.punchesToday} punch{h.punchesToday === 1 ? '' : 'es'} today · {h.totalPunches} in all
                    · last punches delivered {when(h.lastCalledAt)}
                  </p>
                  {/* Pull vendors run through the office connector (9 Oct 2026). */}
                  {h.vendor === 'zkteco_biotime' && (
                    <ConnectorPanel deviceId={h.deviceId} agent={h.agent} canManage={canManage} />
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            &ldquo;Nothing heard&rdquo; means the machine has not contacted Atlas for half a day. A
            machine that is calling in but having its punches refused is <em>not</em> the same thing,
            and is shown as waiting instead.
          </p>
        </SectionCard>
      )}

      <SectionCard
        title="Numbers we cannot put a name to"
        icon="users"
        bodyClassName="p-0"
        action={<span className="text-xs text-muted-foreground">{queue.mappedCount} already mapped</span>}
      >
        {queue.codes.length === 0 ? (
          <EmptyState
            icon="check-circle"
            title="Every punch has a name against it"
            hint="If a machine sends a number Atlas does not recognise, it appears here rather than being thrown away."
          />
        ) : (
          <>
            <p className="border-b border-border bg-warning/5 px-4 py-2 text-xs">
              These punches <strong>are saved</strong> &mdash; they are simply not counted for anybody
              yet. Put a name to a number and everything it has already sent is counted straight away.
            </p>
            <ListFilter
              rows={queue.codes}
              noun="codes"
              paramKey="unmapped"
              placeholder="Employee code&hellip;"
              searchOn={(c) => [c.employeeCode]}
            >
              {(shown) => (shown.length === 0 ? (
                <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every unmapped code." />
              ) : (
                <div className="divide-y divide-border">
                  {shown.map((c) => (
                    <CodeRow
                      key={c.employeeCode} code={c} users={queue.users} canManage={canManage} busy={pending}
                      onMap={(userId) => run(() => mapCodeAction(c.employeeCode, userId))}
                    />
                  ))}
                </div>
              ))}
            </ListFilter>
          </>
        )}
      </SectionCard>

      {queue.mappedCount > 0 && canManage && (
        <UnmapPanel busy={pending} onUnmap={(code) => run(() => unmapCodeAction(code))} />
      )}
    </div>
  );
}

function VendorForm({
  device, choices, fieldsByVendor, busy, onSave,
}: {
  device: DeviceVendorVM;
  choices: VendorChoice[];
  fieldsByVendor: Record<string, AdapterField[]>;
  busy: boolean;
  onSave: (input: { vendor: string; directionMode: 'from_state' | 'first_last'; config: Record<string, string> }) => void;
}) {
  const [vendor, setVendor] = useState(device.vendor ?? choices[0]?.value ?? '');
  const [mode, setMode] = useState<'from_state' | 'first_last'>(
    device.directionMode === 'from_state' ? 'from_state' : 'first_last',
  );
  const [config, setConfig] = useState<Record<string, string>>(device.config ?? {});

  const chosen = choices.find((c) => c.value === vendor);
  const fields = fieldsByVendor[vendor] ?? [];
  const open = fields.filter((f) => !f.secret);
  const secret = fields.filter((f) => f.secret);

  return (
    <div className="mt-3 grid gap-3 border-t border-border pt-3">
      <Field label="What runs your attendance machine?" htmlFor={`v-${device.id}`}>
        <select id={`v-${device.id}`} value={vendor} onChange={(e) => setVendor(e.target.value)} className="field-input">
          {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </Field>
      {chosen && <p className="-mt-1 text-xs text-muted-foreground">{chosen.hint}</p>}

      <Field label="How should we read arrival and leaving?" htmlFor={`m-${device.id}`}>
        <select id={`m-${device.id}`} value={mode} onChange={(e) => setMode(e.target.value as 'from_state' | 'first_last')} className="field-input">
          <option value="first_last">First touch in, last touch out (recommended)</option>
          <option value="from_state">Trust the machine&rsquo;s IN / OUT buttons</option>
        </select>
      </Field>
      <p className="-mt-1 text-xs text-muted-foreground">{DIRECTION_HELP[mode]}</p>

      {/*
        THESE ARE A NOTE, NOT A CONNECTION (3 Oct 2026).

        The address and username look exactly like the boxes you fill in to make
        something connect, and they are not: the machine sits on the client's
        private network, which Atlas - running on Vercel - cannot reach by
        design. The connector on their office PC is what actually talks to it,
        from its own config.json.

        So Atlas never uses these. They are here so somebody opening this screen
        in a year can see which machine was wired up without walking to the back
        office. Blank is fine, and `setDeviceVendor` drops empty values anyway.

        Said out loud because the first person to use this screen filled both in
        and asked what they were for.
      */}
      {open.length > 0 && (
        <p className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs leading-relaxed text-muted-foreground">
          The rest is <strong className="text-foreground">optional</strong> &mdash; a note for
          whoever reads this screen later. Atlas does not connect to the machine itself: it is on
          the office network, and the connector on that PC is what reads it. You can leave these
          blank and press Save.
        </p>
      )}

      {open.map((f) => (
        <Field
          key={f.key}
          label={`${f.label} (optional)`}
          htmlFor={`c-${device.id}-${f.key}`}
        >
          <input
            id={`c-${device.id}-${f.key}`} type="text" className="field-input"
            placeholder={f.placeholder}
            value={config[f.key] ?? ''}
            onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
          />
        </Field>
      ))}

      {secret.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
          <p className="flex items-start gap-2 text-xs">
            <Icon name="lock" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span>
              <strong>{secret.map((f) => f.label).join(' and ')}</strong>{' '}
              {secret.length === 1 ? 'is' : 'are'} <strong>not entered here</strong>. Put{' '}
              {secret.length === 1 ? 'it' : 'them'} into the Atlas connector on your office computer.
              Passwords for your other systems are never stored in Atlas &mdash; if it is not here,
              it cannot leak from here.
            </span>
          </p>
        </div>
      )}

      <div>
        <Button variant="primary" icon="check" loading={busy}
          onClick={() => onSave({ vendor, directionMode: mode, config })}>
          Save
        </Button>
      </div>
    </div>
  );
}

function CodeRow({
  code, users, canManage, busy, onMap,
}: {
  code: QueueVM['codes'][number];
  users: QueueVM['users'];
  canManage: boolean;
  busy: boolean;
  onMap: (userId: string) => void;
}) {
  const [picked, setPicked] = useState('');

  return (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono font-semibold">{code.employeeCode}</span>
          <Badge tone="warning">{code.punches} punch{code.punches === 1 ? '' : 'es'} waiting</Badge>
        </p>
        <p className="text-xs text-muted-foreground">
          {when(code.firstSeen)} &rarr; {when(code.lastSeen)}
        </p>

        {code.suggestions.length > 0 && canManage && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Looks like:</span>
            {code.suggestions.map((s) => (
              <button key={s.userId} type="button" disabled={busy} onClick={() => onMap(s.userId)}
                className="rounded-full border border-brand/40 bg-brand/5 px-2.5 py-1 text-xs text-on-tint-brand hover:bg-brand/10"
                title={s.why}>
                {s.fullName} ({s.userCode})
              </button>
            ))}
          </div>
        )}
      </div>

      {canManage && (
        <div className="flex shrink-0 items-center gap-2">
          <select aria-label={`Who is ${code.employeeCode}?`} value={picked}
            onChange={(e) => setPicked(e.target.value)} className="field-input h-9 max-w-[14rem]">
            <option value="">Choose a person&hellip;</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.userCode}){u.claimed ? ' — already has a code' : ''}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" disabled={!picked || busy} onClick={() => onMap(picked)}>
            Map
          </Button>
        </div>
      )}
    </div>
  );
}

function UnmapPanel({ busy, onUnmap }: { busy: boolean; onUnmap: (code: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <SectionCard title="Undo a mapping" icon="rotate-ccw">
      <p className="mb-2 text-xs text-muted-foreground">
        If a code was put against the wrong person, detach it here. <strong>The punches are
        kept</strong> &mdash; the machine really did record them &mdash; they simply stop counting
        for anybody until the code is mapped again.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Employee code" htmlFor="unmap-code">
          <input id="unmap-code" type="text" className="field-input max-w-[12rem]"
            value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 1001" />
        </Field>
        <Button variant="outline" disabled={!code.trim() || busy} onClick={() => { onUnmap(code.trim()); setCode(''); }}>
          Detach
        </Button>
      </div>
    </SectionCard>
  );
}
