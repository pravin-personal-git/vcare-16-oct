'use client';
import { newestFirst, oldestFirst } from '@/lib/card-list';
import { ListFilter } from '@/components/ui/ListFilter';

import { useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Badge, Card, EmptyState, PageHeader, SectionCard } from '@/components/ui/Layout';
import type { SessionRow, PairedDeviceRow } from '@/server/administration';
import { endAllForUser, endSession, revokePairedDeviceAction } from './actions';

interface DeviceVM extends Omit<PairedDeviceRow, 'pairedAt' | 'lastSyncedAt'> {
  pairedAt: string;
  lastSyncedAt: string | null;
}

/**
 * Live sessions, and the ability to end one.
 *
 * This screen is the reason sessions are rows in Postgres rather than claims in
 * a JWT. You cannot revoke a stateless token - the best you can do is wait for
 * it to expire, which with "remember me" is thirty days. The spec asked for
 * remote sign-out, so the session had to be server-side, and this is the screen
 * that pays for that decision.
 */

interface Props {
  sessions: SessionRow[];
  devices: DeviceVM[];
  canEdit: boolean;
}

/** Chrome 128 on Windows → "Chrome · Windows". Best-effort; UA strings lie. */
function readAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';

  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Chrome\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari'
          : /Firefox\//.test(ua) ? 'Firefox'
            : 'Browser';

  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad/.test(ua) ? 'iOS'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux'
            : '';

  return os ? `${browser} · ${os}` : browser;
}

function ago(d: Date): string {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function SessionsClient({ sessions, devices, canEdit }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    | { kind: 'one'; row: SessionRow }
    | { kind: 'all'; row: SessionRow }
    | { kind: 'device'; row: DeviceVM }
    | null
  >(null);

  const run = (fn: () => Promise<{ error?: string; message?: string }>) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else { setNotice(res.message ?? null); setConfirm(null); }
    });
  };

  const byUser = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) counts.set(s.userId, (counts.get(s.userId) ?? 0) + 1);
    return counts;
  }, [sessions]);

  return (
    <div>
      <PageHeader
        badge="DM"
        title="Device Management"
        subtitle={`${sessions.length} open session${sessions.length === 1 ? '' : 's'} · ${devices.length} paired phone${devices.length === 1 ? '' : 's'}, across the organisation`}
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}
      {notice && (
        <Card className="mb-3 border-success/40 bg-success/5 p-3">
          <p className="flex items-start gap-2 text-sm">
            <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>{notice}</span>
          </p>
        </Card>
      )}

      <SectionCard title="Open sessions" icon="lock" bodyClassName="p-0">
        {sessions.length === 0 ? (
          <EmptyState icon="lock" title="No open sessions" hint="Nobody is signed in right now." />
        ) : (
          /* F1b / D17. This screen is opened when somebody is worried - "who is
             signed in as that account", "which IP is that" - so searching the
             user, the device and the IP is the whole point of it. */
          <ListFilter
            rows={sessions}
            // Date filter and sort, newest first (9 Oct 2026).
            dates={[{ key: 'in', label: 'Signed in', of: (r) => r.loginAt }, { key: 'active', label: 'Last active', of: (r) => r.lastActiveAt }]}
            sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.loginAt) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.loginAt) }]}
            noun="sessions"
            placeholder="User, username, device, IP address…"
            searchOn={(s) => [s.userName, s.username, s.ipAddress, readAgent(s.userAgent)]}
          >
            {(shown) => (shown.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every open session." />
            ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">User</th>
                  <th className="px-4 py-2 font-semibold">Device</th>
                  <th className="px-4 py-2 font-semibold">IP</th>
                  <th className="px-4 py-2 font-semibold">Signed in</th>
                  <th className="px-4 py-2 font-semibold">Last active</th>
                  <th className="w-28 px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <div className="font-medium">
                        {s.userName}
                        {s.isCurrent && (
                          <Badge tone="brand" className="ms-1.5">this device</Badge>
                        )}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">{s.username}</div>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground" title={s.userAgent ?? undefined}>
                      {readAgent(s.userAgent)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {s.ipAddress ?? '-'}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {new Date(s.loginAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
                        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{ago(s.lastActiveAt)}</td>
                    <td className="px-4 py-2">
                      {canEdit && !s.isCurrent && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" onClick={() => setConfirm({ kind: 'one', row: s })}>
                            End
                          </Button>
                          {(byUser.get(s.userId) ?? 0) > 1 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title={`End all ${byUser.get(s.userId)} sessions for ${s.userName}`}
                              onClick={() => setConfirm({ kind: 'all', row: s })}
                            >
                              All
                            </Button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            ))}
          </ListFilter>
        )}

        <div className="border-t border-border bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
          <p className="mb-1">
            Ending a session takes effect on that device&rsquo;s <strong>next request</strong> - the
            cookie is not deleted remotely, the session row is marked revoked and every request
            checks it.
          </p>
          <p>
            <strong className="text-foreground">Last active</strong> is written at most once every
            five minutes, so a session that looks idle by four minutes may not be. It was a database
            write on every page view before that, which is not worth the precision.
          </p>
        </div>
      </SectionCard>

      <div className="mt-4">
        <SectionCard title="Paired phones" icon="phone" bodyClassName="p-0">
          {devices.length === 0 ? (
            <EmptyState icon="phone" title="No phones paired" hint="Phones are paired under Settings → Phones, per branch." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-micro uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-semibold">User</th>
                    <th className="px-4 py-2 font-semibold">Device</th>
                    <th className="px-4 py-2 font-semibold">Branch</th>
                    <th className="px-4 py-2 font-semibold">Paired</th>
                    <th className="px-4 py-2 font-semibold">Last synced</th>
                    <th className="w-20 px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr key={d.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-medium">{d.userName}</td>
                      <td className="px-4 py-2 text-muted-foreground" title={d.appVersion ? `App ${d.appVersion}` : undefined}>
                        {d.deviceLabel ?? d.deviceModel ?? 'Unlabelled phone'}
                        {d.androidVersion && <span className="text-xs"> · Android {d.androidVersion}</span>}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{d.storeName}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(d.pairedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {d.lastSyncedAt ? ago(new Date(d.lastSyncedAt)) : 'never'}
                      </td>
                      <td className="px-4 py-2">
                        {canEdit && (
                          <div className="flex justify-end">
                            <Button size="sm" onClick={() => setConfirm({ kind: 'device', row: d })}>
                              Revoke
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-border bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
            Revoking a phone stops it syncing calls or attendance immediately. Calls it already
            reported are kept - a revoked handset does not erase the record of work that happened.
          </div>
        </SectionCard>
      </div>

      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === 'one' ? `End this session for ${confirm.row.userName}?`
              : confirm.kind === 'all' ? `End every session for ${confirm.row.userName}?`
                : `Revoke this phone for ${confirm.row.userName}?`
          }
          message={
            confirm.kind === 'one'
              ? 'That device is signed out on its next request. They can sign in again immediately - this does not deactivate the account.'
              : confirm.kind === 'all'
                ? `All ${byUser.get(confirm.row.userId)} of their open sessions end. They can sign in again immediately.`
                : 'It can no longer sync calls or attendance. Calls already reported are kept. Re-pairing needs a new code from Settings → Phones.'
          }
          confirmLabel={confirm.kind === 'device' ? 'Revoke' : 'End'}
          tone="danger"
          busy={pending}
          onConfirm={() => run(() => {
            if (confirm.kind === 'one') return endSession(confirm.row.id);
            if (confirm.kind === 'all') return endAllForUser(confirm.row.userId);
            return revokePairedDeviceAction(confirm.row.id);
          })}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
