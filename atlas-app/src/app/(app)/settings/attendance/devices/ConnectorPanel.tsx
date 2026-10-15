'use client';

import { useState, useTransition } from 'react';
import { Badge, Field } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { requestAgentTestAction, saveAgentSettingsAction } from './actions';

/**
 * THE OFFICE CONNECTOR, FROM HERE (9 Oct 2026).
 *
 * Everything that used to need somebody at the client's PC - `status.cmd`,
 * `fix-clock.cmd`, a photo of a log - is on this panel: is it running, which
 * version, what BioTime returned last time and the exact error if not, its
 * settings, and a Test-now that asks BioTime what it has. Vcare's first
 * install failed silently for days for want of exactly this.
 */

export interface AgentVM {
  settings: { clockOffsetMinutes: number; pollSeconds: number; overlapMinutes: number };
  version: string | null;
  seenAt: string | null;
  status: {
    at: string; ok: boolean; received: number; stored: number; applied: number;
    unmapped: number; error: string | null;
  } | null;
  test: {
    at: string; ok: boolean; vendorReachable: boolean; punchesLast7Days: number | null;
    newestPunchAt: string | null; terminals: { serial: string; alias: string | null; lastSeenAt: string | null }[];
    error: string | null;
  } | null;
  testRequestedAt: string | null;
  latestVersion: string | null;
}

const when = (iso: string | null) =>
  (iso ? new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }) : 'never');

/** Alive = checked in within three poll intervals (and at least 20 minutes). */
function liveness(a: AgentVM): { label: string; tone: 'success' | 'warning' | 'danger' } {
  if (!a.seenAt || !a.version) return { label: 'Old connector - cannot report', tone: 'warning' };
  const ageMs = Date.now() - new Date(a.seenAt).getTime();
  const allowed = Math.max(20 * 60_000, a.settings.pollSeconds * 3 * 1000);
  if (ageMs > allowed) return { label: 'Not running', tone: 'danger' };
  if (a.status && !a.status.ok) return { label: 'Running - BioTime problem', tone: 'danger' };
  if (a.status && a.status.received === 0) return { label: 'Running - BioTime gave nothing new', tone: 'warning' };
  return { label: 'Running', tone: 'success' };
}

export function ConnectorPanel({ deviceId, agent, canManage }: { deviceId: string; agent: AgentVM; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState(agent.settings);
  const live = liveness(agent);
  const outdated = agent.version && agent.latestVersion && agent.version !== agent.latestVersion;
  const dirty = form.clockOffsetMinutes !== agent.settings.clockOffsetMinutes
    || form.pollSeconds !== agent.settings.pollSeconds
    || form.overlapMinutes !== agent.settings.overlapMinutes;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) => {
    setMsg(null);
    start(async () => {
      const r = await fn();
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? 'Done.' });
    });
  };

  const num = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: Number(e.target.value) }));

  return (
    <div className="mt-2 grid gap-3 rounded-lg border border-border bg-muted/20 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Office connector</span>
        <Badge tone={live.tone}>{live.label}</Badge>
        {agent.version && <span className="text-muted-foreground">v{agent.version}</span>}
        {outdated && <Badge tone="info">Updating to v{agent.latestVersion} on its own</Badge>}
        <span className="text-muted-foreground">· last check-in {when(agent.seenAt)}</span>
      </div>

      {!agent.version && (
        <p className="text-muted-foreground">
          This PC is running the first connector, which cannot report here or update itself. Install
          the new field kit once (it keeps the existing login); after that everything is managed from
          this panel.
        </p>
      )}

      {agent.status && (
        <p>
          <span className="text-muted-foreground">Last poll {when(agent.status.at)}: </span>
          {agent.status.ok
            ? <>BioTime returned <strong>{agent.status.received}</strong> punch{agent.status.received === 1 ? '' : 'es'}
              {agent.status.received > 0 && <> - {agent.status.stored} new, {agent.status.applied} counted, {agent.status.unmapped} waiting for a name</>}.</>
            : <span className="text-danger">{agent.status.error ?? 'failed'}</span>}
        </p>
      )}

      {agent.test && (
        <div className="rounded border border-border bg-card p-2">
          <p className="font-medium">
            Test {when(agent.test.at)}: {agent.test.ok ? <span className="text-success">passed</span> : <span className="text-danger">failed</span>}
          </p>
          <p className="text-muted-foreground">
            BioTime {agent.test.vendorReachable ? 'reachable' : 'not reachable'}
            {agent.test.punchesLast7Days !== null && <> · {agent.test.punchesLast7Days} punches in the last 7 days</>}
            {agent.test.newestPunchAt && <> · newest {when(agent.test.newestPunchAt)}</>}
          </p>
          {agent.test.terminals.length > 0 && (
            <p className="text-muted-foreground">
              Terminals: {agent.test.terminals.map((t) => `${t.alias ?? t.serial} (seen ${when(t.lastSeenAt)})`).join(', ')}
            </p>
          )}
          {agent.test.error && <p className="text-danger">{agent.test.error}</p>}
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Clock offset (min)" hint="0 unless the reader's clock is wrong" htmlFor={`co-${deviceId}`}>
            <input id={`co-${deviceId}`} type="number" value={form.clockOffsetMinutes} onChange={num('clockOffsetMinutes')}
              className="h-8 w-24 rounded border border-border bg-card px-2" />
          </Field>
          <Field label="Check every (s)" htmlFor={`ps-${deviceId}`}>
            <input id={`ps-${deviceId}`} type="number" min={60} value={form.pollSeconds} onChange={num('pollSeconds')}
              className="h-8 w-24 rounded border border-border bg-card px-2" />
          </Field>
          <Field label="Re-read (min)" hint="2880 = 2 days" htmlFor={`ov-${deviceId}`}>
            <input id={`ov-${deviceId}`} type="number" min={0} value={form.overlapMinutes} onChange={num('overlapMinutes')}
              className="h-8 w-24 rounded border border-border bg-card px-2" />
          </Field>
          <Button size="sm" disabled={!dirty || pending} onClick={() => run(() => saveAgentSettingsAction(deviceId, form))}>
            Save settings
          </Button>
          <Button size="sm" variant="primary" disabled={pending || !!agent.testRequestedAt}
            onClick={() => run(() => requestAgentTestAction(deviceId))}>
            {agent.testRequestedAt ? `Test asked ${when(agent.testRequestedAt)}` : 'Test now'}
          </Button>
        </div>
      )}

      {msg && <p className={msg.ok ? 'text-success' : 'text-danger'} role="status">{msg.text}</p>}
    </div>
  );
}
