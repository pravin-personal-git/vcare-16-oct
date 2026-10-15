'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge, Card, Field, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { createDeviceAction, loadDeviceEventsAction, revokeDeviceAction } from './actions';

/**
 * Biometric/punch devices - the machines that post attendance over HTTP
 * instead of a phone or a browser.
 *
 * The token is shown exactly once, right after a device is created, the
 * same rule as everywhere else in this product a bearer token is issued.
 * There is no "forgot the token" recovery - only revoke and register again,
 * because the alternative is storing something that can be replayed.
 */

interface Device {
  id: string;
  label: string;
  deviceModel: string | null;
  defaultZoneId: string | null;
  defaultZoneLabel: string | null;
  timezoneOffsetMinutes: number;
  isActive: boolean;
  lastPunchAt: string | null;
  lastCalledAt: string | null;
  createdAt: string;
  eventCount: number;
  punchCount: number;
}

interface DeviceEvent {
  id: string;
  accepted: number;
  rejected: number;
  errorMessage: string | null;
  receivedAt: string;
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }) : '-';

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

const DEFAULT_MAPPING_HINT = `{
  "userCodeField": "userCode",
  "timestampField": "timestampMs",
  "directionField": "direction",
  "inValue": "in",
  "outValue": "out"
}`;

function staleness(lastCalledAt: string | null): { label: string; warn: boolean } {
  if (!lastCalledAt) return { label: 'Never reported', warn: true };
  const hours = (Date.now() - new Date(lastCalledAt).getTime()) / 3_600_000;
  if (hours < 25) return { label: 'Reporting', warn: false };
  if (hours < 72) return { label: `Lagging (${Math.round(hours)}h)`, warn: false };
  return { label: `Not reporting (${Math.round(hours / 24)}d)`, warn: true };
}

export function DevicesClient({
  devices, zones, canManage, scopeIsAll,
}: {
  devices: Device[];
  zones: { id: string; label: string }[];
  canManage: boolean;
  scopeIsAll: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<{ token: string } | null>(null);
  const [revoking, setRevoking] = useState<Device | null>(null);
  const [viewing, setViewing] = useState<Device | null>(null);
  const [events, setEvents] = useState<DeviceEvent[] | null>(null);

  const live = devices.filter((d) => d.isActive);
  const unhealthy = live.filter((d) => staleness(d.lastCalledAt).warn);

  const run = (fn: () => Promise<{ error?: string; message?: string }>) => {
    setError(null); setFlash(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else { setFlash(r.message ?? 'Done.'); router.refresh(); }
    });
  };

  const openEvents = (d: Device) => {
    setViewing(d);
    setEvents(null);
    start(async () => {
      const r = await loadDeviceEventsAction(d.id);
      if (r.error) setError(r.error);
      else setEvents(r.events ?? []);
    });
  };

  return (
    <div>
      <PageHeader
        badge="DV"
        title="Attendance Devices"
        subtitle={`${live.length} device${live.length === 1 ? '' : 's'} registered`
          + (unhealthy.length > 0 ? ` · ${unhealthy.length} not reporting` : '')}
        actions={
          <Button
            variant="primary" icon="plus" disabled={!canManage}
            title={scopeIsAll ? 'Select a single branch first' : undefined}
            onClick={() => { setIssued(null); setCreating(true); }}
          >
            Register a device
          </Button>
        }
      />

      {flash && (
        <Card className="mb-3 flex items-start gap-2.5 border-success/30 bg-success/[0.06] px-3 py-2.5">
          <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          <p className="flex-1 text-xs leading-relaxed">{flash}</p>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss">
            <Icon name="x" className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </Card>
      )}
      {error && (
        <Card className="mb-3 flex items-start gap-2.5 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="flex-1 text-xs leading-relaxed text-danger">{error}</p>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        </Card>
      )}

      {unhealthy.length > 0 && (
        <Card className="mb-4 flex items-start gap-2.5 border-danger/30 bg-danger/[0.06] px-3 py-2.5">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="text-xs leading-relaxed">
            <strong className="text-danger">
              {unhealthy.length} device{unhealthy.length === 1 ? '' : 's'} stopped reporting.
            </strong>{' '}
            Attendance from these machines is incomplete until they call in again. Check the
            machine&rsquo;s network connection and that its token has not been revoked.
          </p>
        </Card>
      )}

      <SectionCard title="Devices" icon="settings" bodyClassName="p-0">
        {devices.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No devices registered yet. Register one to let a biometric/punch machine post
            attendance directly.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-semibold">Device</th>
                  <th className="px-3 py-2 font-semibold">Default location</th>
                  <th className="px-3 py-2 font-semibold">Reporting</th>
                  <th className="px-3 py-2 text-right font-semibold">Punches</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const s = staleness(d.lastCalledAt);
                  return (
                    <tr key={d.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <span className="block font-medium">{d.label}</span>
                        {d.deviceModel && (
                          <span className="block text-xs text-muted-foreground">{d.deviceModel}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {d.defaultZoneLabel ?? <span className="italic">none</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`block text-xs ${s.warn ? 'font-medium text-danger' : 'text-muted-foreground'}`}>
                          {s.label}
                        </span>
                        <span className="block text-xs text-muted-foreground">{fmt(d.lastCalledAt)}</span>
                      </td>
                      {/* Punches delivered by any route - "Calls" counted only the old direct one (9 Oct 2026). */}
                      <td className="px-3 py-2 text-right tabular-nums">{d.punchCount + d.eventCount}</td>
                      <td className="px-3 py-2">
                        {d.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Revoked</Badge>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" icon="clock" onClick={() => openEvents(d)}>Events</Button>
                          {canManage && d.isActive && (
                            <Button size="sm" icon="x" loading={pending} onClick={() => setRevoking(d)}>
                              Revoke
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {creating && (
        <CreateDialog
          zones={zones}
          pending={pending}
          issued={issued}
          onClose={() => { setCreating(false); setIssued(null); router.refresh(); }}
          onCreate={(input) => {
            setError(null);
            start(async () => {
              const r = await createDeviceAction(input);
              if (r.error) { setError(r.error); setCreating(false); return; }
              if (r.token) setIssued({ token: r.token });
            });
          }}
        />
      )}

      {revoking && (
        <Modal
          open
          title={`Revoke "${revoking.label}"`}
          icon="x"
          tone="danger"
          size="sm"
          onClose={() => setRevoking(null)}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button onClick={() => setRevoking(null)}>Keep it</Button>
              <Button
                variant="danger" icon="x" loading={pending}
                onClick={() => { const id = revoking.id; setRevoking(null); run(() => revokeDeviceAction(id)); }}
              >
                Revoke
              </Button>
            </div>
          }
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            The device&rsquo;s token stops working immediately. Punches it has already sent are
            kept - they are a record of work that happened.
          </p>
        </Modal>
      )}

      {viewing && (
        <Modal open title={`Recent calls - ${viewing.label}`} icon="clock" size="md" onClose={() => setViewing(null)}>
          {events === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : events.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {viewing.lastCalledAt
                ? <>No direct calls. This device sends through the office connector - last delivery {new Date(viewing.lastCalledAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}, {viewing.punchCount} punch{viewing.punchCount === 1 ? '' : 'es'} in all. Its health is under &ldquo;Are the machines talking to us?&rdquo; below.</>
                : <>This device has not delivered anything yet. If it uses the office connector, its health is under &ldquo;Are the machines talking to us?&rdquo; below.</>}
            </p>
          ) : (
            <div className="grid gap-2">
              {events.map((e) => (
                <div key={e.id} className="rounded-lg border border-border px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{fmt(e.receivedAt)}</span>
                    <span>
                      <span className="text-success">{e.accepted} accepted</span>
                      {e.rejected > 0 && <span className="ml-2 text-danger">{e.rejected} rejected</span>}
                    </span>
                  </div>
                  {e.errorMessage && (
                    <p className="mt-1 text-xs text-muted-foreground">{e.errorMessage}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function CreateDialog({
  zones, pending, issued, onClose, onCreate,
}: {
  zones: { id: string; label: string }[];
  pending: boolean;
  issued: { token: string } | null;
  onClose: () => void;
  onCreate: (input: {
    label: string;
    deviceModel: string | null;
    defaultZoneId: string | null;
    timezoneOffsetMinutes: number;
    fieldMapping: Record<string, string> | null;
  }) => void;
}) {
  const [label, setLabel] = useState('');
  const [deviceModel, setDeviceModel] = useState('');
  const [defaultZoneId, setDefaultZoneId] = useState('');
  const [offset, setOffset] = useState('0');
  const [mappingText, setMappingText] = useState('');
  const [copied, setCopied] = useState(false);

  const submit = () => {
    let fieldMapping: Record<string, string> | null = null;
    if (mappingText.trim()) {
      try {
        fieldMapping = JSON.parse(mappingText);
      } catch {
        return; // left for the caller's own validation round-trip - a bad JSON blob just does nothing on click
      }
    }
    onCreate({
      label,
      deviceModel: deviceModel.trim() || null,
      defaultZoneId: defaultZoneId || null,
      timezoneOffsetMinutes: Number(offset) || 0,
      fieldMapping,
    });
  };

  return (
    <Modal
      open
      title="Register a device"
      subtitle={issued ? 'Copy this token now' : 'A biometric/punch machine that posts attendance'}
      icon="settings"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>{issued ? 'Done' : 'Cancel'}</Button>
          {!issued && (
            <Button variant="primary" icon="plus" disabled={!label.trim() || pending} loading={pending} onClick={submit}>
              Register
            </Button>
          )}
        </div>
      }
    >
      {issued ? (
        <div>
          {/*
            Rewritten 3 Oct 2026. This used to describe only the PUSH path - a
            bearer header and a URL - which is the rarer of the two and reads as
            instructions for a developer. For a BioTime or any other machine on
            the client's own network, the token goes into the connector agent's
            setup, and that is what somebody standing in an office needs to be
            told. The header is still documented, underneath, for the machines
            that post to Atlas themselves.
          */}
          <p className="mb-2 text-sm font-medium">
            Copy this now &mdash; it is never shown again.
          </p>
          <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
            If the machine is on the client&rsquo;s own network (BioTime and most
            punch machines are), paste this into the Atlas connector when it asks
            for the <strong>device token</strong>. That is all it is for.
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
            <code className="flex-1 break-all font-mono text-xs">{issued.token}</code>
            <button
              type="button"
              onClick={() => { navigator.clipboard.writeText(issued.token); setCopied(true); }}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Lost it? There is no way to look it up &mdash; revoke this device and register it
            again. A machine that sends an old token is refused, which is the point.
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              For a machine that posts to Atlas directly
            </summary>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Send it as an
              <code className="mx-1 rounded bg-muted px-1">Authorization: Bearer &lt;token&gt;</code>
              header to <code className="rounded bg-muted px-1">/api/attendance/devices/sync</code>.
            </p>
          </details>
        </div>
      ) : (
        <div className="grid gap-3">
          <Field label="Name" required htmlFor="dd-label">
            <input id="dd-label" value={label} placeholder="Main gate scanner"
              onChange={(e) => setLabel(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Model" hint="Optional. Just a label, so you can tell two machines apart" htmlFor="dd-model">
            <input id="dd-model" value={deviceModel} placeholder="ZKTeco K40"
              onChange={(e) => setDeviceModel(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Default location" hint="Used for the geofence check when the machine sends no coordinates" htmlFor="dd-zone">
            <select id="dd-zone" value={defaultZoneId} onChange={(e) => setDefaultZoneId(e.target.value)} className={inputClass}>
              <option value="">None</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
            </select>
          </Field>
          <Field label="Clock offset (minutes)" hint="Added to the machine's own timestamp to get real time" htmlFor="dd-offset">
            <input id="dd-offset" type="number" value={offset} onChange={(e) => setOffset(e.target.value)} className={inputClass} />
          </Field>
          {/*
            Folded away 3 Oct 2026. A box of JSON sitting open on a form reads as
            something you are expected to fill in, and it is the opposite: it
            applies only to a machine that posts its own raw payload straight to
            Atlas. Anything coming through the connector arrives already
            normalised and never consults this. Open, it made people think
            registering a device required understanding its payload format.
          */}
          <details className="rounded-lg border border-border bg-muted/20 p-2">
            <summary className="cursor-pointer text-xs font-medium">
              Advanced: field mapping
              <span className="ms-1 font-normal text-muted-foreground">
                &mdash; leave this alone unless the machine posts to Atlas itself
              </span>
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Only for a machine sending Atlas its own raw JSON, when the keys are not the
              ones below. A BioTime or any machine read by the Atlas connector is already
              translated before it gets here, so this is ignored.
            </p>
            <div className="mt-2">
              <Field label="Field mapping" hint="Blank means the shape shown below" htmlFor="dd-mapping">
                <textarea id="dd-mapping" value={mappingText} onChange={(e) => setMappingText(e.target.value)}
                  placeholder={DEFAULT_MAPPING_HINT} rows={6}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
              </Field>
            </div>
          </details>
        </div>
      )}
    </Modal>
  );
}
