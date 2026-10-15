'use client';
import { ListFilter } from '@/components/ui/ListFilter';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge, Card, EmptyState, Field, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { CAPTURE_MODES, type CaptureMode } from '@/lib/call-log';
import { DEVICE_STATUS_LABEL, type DeviceStatus } from '@/lib/device-trust';
import { changeCaptureMode, pairDevice, revoke } from './actions';

/**
 * The phones that report call logs, and what they are allowed to report.
 *
 * The screen is arranged around one question a manager has to be able to answer
 * at a glance: **is this phone still reporting?** Call counts elsewhere in the
 * product are only as true as the answer here, so staleness is the loudest
 * thing on the page - louder than the call totals themselves.
 */

interface Device {
  id: string;
  userId: string;
  userName: string;
  deviceLabel: string | null;
  deviceModel: string | null;
  androidVersion: string | null;
  appVersion: string | null;
  lastSyncedAt: string | null;
  lastCallAt: string | null;
  isActive: boolean;
  pairedAt: string;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  callCount: number;
  status: DeviceStatus;
  flags: DeviceFlag[];
  pairedByName: string | null;
  androidIdTail: string | null;
  lastIp: string | null;
  storeName: string;
  callHealth: { tone: 'ok' | 'warn' | 'bad'; text: string };
}

type DeviceFlag = 'location_off' | 'permissions_missing' | 'battery_restricted' | 'clock_changed' | 'fake_gps' | 'integrity';

const FLAG_LABEL: Record<DeviceFlag, string> = {
  location_off: 'Location off',
  permissions_missing: 'Permission missing',
  battery_restricted: 'Battery restricted',
  clock_changed: 'Clock changed',
  fake_gps: 'Fake GPS',
  integrity: 'Tampered phone',
};

const STATUS_TONE: Record<DeviceStatus, 'success' | 'info' | 'danger' | 'neutral'> = {
  active: 'success', never_reported: 'info', not_reporting: 'danger', app_removed: 'danger', revoked: 'neutral',
};

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }) : '-';

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function DevicesClient({
  devices, users, captureMode, canManage, scopeIsAll,
}: {
  devices: Device[];
  users: { id: string; name: string; username: string }[];
  captureMode: CaptureMode;
  canManage: boolean;
  scopeIsAll: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [revoking, setRevoking] = useState<Device | null>(null);

  const run = (fn: () => Promise<{ error?: string; message?: string }>) => {
    setError(null); setFlash(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else { setFlash(r.message ?? 'Done.'); router.refresh(); }
    });
  };

  const live = devices.filter((d) => d.isActive);
  const unhealthy = live.filter((d) => !d.pairingCode && (d.status === 'not_reporting' || d.status === 'app_removed'));
  const flagged = live.filter((d) => d.flags.length > 0);
  const waiting = live.filter((d) => d.pairingCode);

  return (
    <div>
      <PageHeader
        badge="PH"
        title="Phones"
        subtitle={`${live.length} phone${live.length === 1 ? '' : 's'} paired to Vcare`
          + (unhealthy.length > 0 ? ` · ${unhealthy.length} not reporting` : '')
          + (flagged.length > 0 ? ` · ${flagged.length} need attention` : '')}
        actions={
          <Button
            variant="primary" icon="plus" disabled={!canManage}
            title={scopeIsAll ? 'Select a single store first' : undefined}
            onClick={() => { setIssued(null); setPairing(true); }}
          >
            Pair a phone
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
              {unhealthy.length} phone{unhealthy.length === 1 ? '' : 's'} stopped reporting.
            </strong>{' '}
            Attendance, location and calls from {unhealthy.length === 1 ? 'it' : 'them'} are
            missing until {unhealthy.length === 1 ? 'it checks' : 'they check'} in again.
            &ldquo;App removed&rdquo; means Google reports Vcare is no longer installed;
            &ldquo;Not reporting&rdquo; is usually the phone&rsquo;s battery saver closing the app -
            ask the employee to open Vcare and finish the battery setup.
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Phones" icon="phone" className="lg:col-span-2" bodyClassName="p-0">
          {devices.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No phones paired yet. Pair one to start collecting call logs.
            </p>
          ) : (
            /* F1b / D17. The reason to open this screen is almost always "whose
               phone has stopped reporting", so the status chips carry their own
               counts and answer it before you read a row. */
            <ListFilter
              rows={devices}
              noun="phones"
              placeholder="Person, handset, status…"
              searchOn={(d) => [d.userName, d.deviceLabel, d.deviceModel, d.status]}
              chipOf={(d) => (d.status === 'active' ? 'ok' : 'attention')}
              chipLabel="Status"
              chips={[
                { value: 'attention', label: 'Needs attention', count: devices.filter((d) => d.status !== 'active').length },
                { value: 'ok', label: 'Reporting', count: devices.filter((d) => d.status === 'active').length },
              ]}
            >
              {(shown) => (shown.length === 0 ? (
                <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every paired phone." />
              ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Whose phone</th>
                    <th className="px-3 py-2 font-semibold">Handset</th>
                    <th className="px-3 py-2 font-semibold">Reporting</th>
                    <th className="px-3 py-2 font-semibold">Calls</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d) => {
                    const alarm = d.isActive && !d.pairingCode && (d.status === 'not_reporting' || d.status === 'app_removed');
                    return (
                      <tr key={d.id} className={`border-b border-border last:border-0 ${alarm ? 'bg-danger/[0.05]' : ''}`}>
                        <td className="px-3 py-2">
                          <span className="block font-medium">{d.userName}</span>
                          {d.deviceLabel && (
                            <span className="block text-xs text-muted-foreground">
                              {d.deviceLabel}
                            </span>
                          )}
                          {d.pairedByName && (
                            <span className="block text-xs text-muted-foreground">Paired by {d.pairedByName}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {d.deviceModel ?? <span className="italic">not yet paired</span>}
                          {d.androidVersion && <span className="block">Android {d.androidVersion}</span>}
                          {d.androidIdTail && <span className="block font-mono text-xs">ID …{d.androidIdTail}</span>}
                          <span className="block text-xs">Branch: {d.storeName}</span>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`block text-xs ${alarm ? 'font-medium text-danger' : 'text-muted-foreground'}`}>
                            {d.lastSyncedAt ? `Last check-in ${fmt(d.lastSyncedAt)}` : 'No check-in yet'}
                          </span>
                          {d.lastIp && <span className="block font-mono text-xs text-muted-foreground">{d.lastIp}</span>}
                        </td>
                        <td className="max-w-[18rem] px-3 py-2">
                          <span className="block font-semibold tabular-nums">{d.callCount}</span>
                          {!d.pairingCode && (
                            <span className={`block text-xs leading-snug ${d.callHealth.tone === 'bad' ? 'text-danger' : d.callHealth.tone === 'warn' ? 'text-warning' : 'text-muted-foreground'}`}>
                              {d.callHealth.text}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {!d.isActive ? (
                            <Badge tone="danger">Revoked</Badge>
                          ) : d.pairingCode ? (
                            <span className="flex flex-col gap-0.5">
                              <Badge tone="warning">Waiting for phone</Badge>
                              <code className="font-mono text-sm font-bold tracking-widest">
                                {d.pairingCode}
                              </code>
                            </span>
                          ) : (
                            <span className="flex flex-col items-start gap-1">
                              <Badge tone={STATUS_TONE[d.status]}>{DEVICE_STATUS_LABEL[d.status]}</Badge>
                              {d.flags.map((f) => (
                                <span key={f} className="rounded bg-warning/15 px-1.5 py-0.5 text-xs font-semibold text-on-tint-warning">
                                  {FLAG_LABEL[f]}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
              ))}
            </ListFilter>
          )}

          {canManage && live.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-border bg-muted/20 px-4 py-2.5">
              {live.map((d) => (
                <Button
                  key={d.id} size="sm" icon="x" loading={pending}
                  onClick={() => setRevoking(d)}
                >
                  Revoke {d.userName}
                </Button>
              ))}
            </div>
          )}
        </SectionCard>

        <div className="grid content-start gap-4">
          <SectionCard title="Which calls are collected" icon="filter">
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              Staff use personal phones, so calls to family sit in the same log as calls
              to customers. This decides what leaves the handset at all.
            </p>

            <div className="grid gap-2">
              {CAPTURE_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  disabled={!canManage || pending}
                  onClick={() => run(() => changeCaptureMode(m.value))}
                  className={`rounded-lg border px-3 py-2.5 text-start transition disabled:opacity-60 ${
                    captureMode === m.value
                      ? 'border-brand bg-brand/10'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {captureMode === m.value && (
                      <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-brand" />
                    )}
                    <span className="text-sm font-medium">{m.label}</span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {m.hint}
                  </span>
                </button>
              ))}
            </div>

            <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
              This applies from the next sync onwards. Changing it does not reach back:
              switching to CRM-only does not delete calls already collected, and switching
              to everything does not reveal calls the phones never sent.
            </p>
          </SectionCard>

          {waiting.length > 0 && (
            <SectionCard title="Waiting to be paired" icon="clock">
              {waiting.map((d) => (
                <div key={d.id} className="mb-2 last:mb-0">
                  <p className="text-sm font-medium">{d.userName}</p>
                  <code className="block font-mono text-lg font-bold tracking-[0.3em]">
                    {d.pairingCode}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    Expires {fmt(d.pairingExpiresAt)}
                  </p>
                </div>
              ))}
            </SectionCard>
          )}
        </div>
      </div>

      {pairing && (
        <PairDialog
          users={users}
          pending={pending}
          issued={issued}
          onClose={() => { setPairing(false); setIssued(null); router.refresh(); }}
          onPair={(userId, label) => {
            setError(null);
            start(async () => {
              const r = await pairDevice(userId, label);
              if (r.error) { setError(r.error); setPairing(false); return; }
              if (r.code && r.expiresAt) setIssued({ code: r.code, expiresAt: r.expiresAt });
            });
          }}
        />
      )}

      {revoking && (
        <Modal
          open
          title={`Revoke ${revoking.userName}’s phone`}
          icon="x"
          tone="danger"
          size="sm"
          onClose={() => setRevoking(null)}
          footer={
            <div className="flex w-full justify-end gap-2">
              <Button onClick={() => setRevoking(null)}>Keep it</Button>
              <Button
                variant="danger" icon="x" loading={pending}
                onClick={() => { const id = revoking.id; setRevoking(null); run(() => revoke(id)); }}
              >
                Revoke
              </Button>
            </div>
          }
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            The phone stops reporting on its next sync, and its token stops working
            immediately. The {revoking.callCount} call{revoking.callCount === 1 ? '' : 's'} it
            has already sent are kept - they are a record of work that happened, and
            deleting them because a handset changed would lose history nobody asked to lose.
          </p>
        </Modal>
      )}
    </div>
  );
}

function PairDialog({
  users, pending, issued, onClose, onPair,
}: {
  users: { id: string; name: string; username: string }[];
  pending: boolean;
  issued: { code: string; expiresAt: string } | null;
  onClose: () => void;
  onPair: (userId: string, label: string | null) => void;
}) {
  const [userId, setUserId] = useState('');
  const [label, setLabel] = useState('');

  return (
    <Modal
      open
      title="Pair a phone"
      subtitle={issued ? 'Type this code into the app' : 'Whose phone is this?'}
      icon="phone"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>{issued ? 'Done' : 'Cancel'}</Button>
          {!issued && (
            <Button
              variant="primary" icon="plus"
              disabled={!userId || pending} loading={pending}
              onClick={() => onPair(userId, label.trim() || null)}
            >
              Get a code
            </Button>
          )}
        </div>
      }
    >
      {issued ? (
        <div className="text-center">
          <code className="block py-4 font-mono text-4xl font-bold tracking-[0.4em]">
            {issued.code}
          </code>
          <p className="text-xs text-muted-foreground">
            Open Vcare on the phone, tap Business login → Pair this phone, and enter this code. It expires at{' '}
            {new Date(issued.expiresAt).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
              hour: '2-digit', minute: '2-digit',
            })}
            .
          </p>
          <p className="mt-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-start text-xs leading-relaxed text-muted-foreground">
            After pairing, walk the user through turning <strong>off</strong> battery
            optimisation for the app. On Xiaomi, Oppo, Vivo and Realme, Android will
            otherwise shut it down within a day and the calls quietly stop arriving.
            The app has a screen that shows how, per manufacturer.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            You choose who the phone belongs to here, from the web, where you know who
            is who. The phone only proves it holds the code - it never gets to claim
            an identity of its own.
          </p>
          <div className="grid gap-3">
            <Field label="Employee" required htmlFor="pd-user">
              <select
                id="pd-user" value={userId} className={inputClass}
                onChange={(e) => setUserId(e.target.value)}
              >
                <option value="">Choose…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} ({u.username})</option>
                ))}
              </select>
            </Field>
            <Field label="Label" hint="Optional - helps you tell two handsets apart" htmlFor="pd-label">
              <input
                id="pd-label" value={label} placeholder="Field phone"
                onChange={(e) => setLabel(e.target.value)} className={inputClass}
              />
            </Field>
          </div>
        </>
      )}
    </Modal>
  );
}
