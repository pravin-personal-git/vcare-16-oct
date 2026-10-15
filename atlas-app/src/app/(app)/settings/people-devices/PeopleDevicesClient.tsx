'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageHeader, Badge, Card, EmptyState, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import { ListFilter } from '@/components/ui/ListFilter';
import { pairPhoneAction, revokeEverythingAction } from './actions';

/**
 * People and their devices, in one place (workstream I, 1 Oct 2026).
 *
 * Before this, one employee's access lived on six screens and four tables.
 * The question "what can this person sign in from, and how do I stop them"
 * had no single answer anywhere in Atlas.
 */

interface DeviceVM {
  id: string;
  kind: 'phone' | 'app_session' | 'browser' | 'push';
  label: string;
  detail: string | null;
  lastSeenAt: string | null;
  pending: boolean;
}

interface PersonVM {
  userId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  roleNames: string[];
  devices: DeviceVM[];
  phoneCount: number;
  browserCount: number;
  lastSeenAt: string | null;
}

const KIND: Record<DeviceVM['kind'], { label: string; icon: IconName }> = {
  phone: { label: 'Paired phone', icon: 'phone' },
  app_session: { label: 'App session', icon: 'log-out' },
  // No `as IconName` here. The cast that used to be on this line hid the fact
  // that `globe` did not exist, and the page died whenever somebody expanded a
  // person with a browser session. The icon exists now; the cast must not come
  // back, or the next typo does the same thing.
  browser: { label: 'Browser', icon: 'globe' },
  push: { label: 'Notifications', icon: 'mail' },
};

const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
};

export function PeopleDevicesClient({ people, canManage }: {
  people: PersonVM[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PersonVM | null>(null);
  const [pairing, setPairing] = useState<PersonVM | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const cutOff = async (person: PersonVM) => {
    setBusy(person.userId);
    setConfirming(null);
    const r = await revokeEverythingAction(person.userId);
    setBusy(null);
    setNote(r.error
      ? { tone: 'bad', text: r.error }
      : { tone: 'ok', text: `${person.fullName}: ${r.summary}` });
  };

  const pair = async (person: PersonVM) => {
    setBusy(person.userId);
    setCode(null);
    const r = await pairPhoneAction(person.userId, `${person.fullName}'s phone`);
    setBusy(null);
    if (r.error) { setPairing(null); setNote({ tone: 'bad', text: r.error }); return; }
    setCode({ code: r.code!, expiresAt: r.expiresAt! });
  };

  return (
    <>
      <PageHeader
        badge="PPL"
        title="People & devices"
        subtitle="Who can sign in, from what, and how to cut one off"
      />

      {/* Six screens used to hold a quarter of this answer each. Saying so
          here is how somebody arriving from an old bookmark knows to stop
          using it. */}
      <Card className="mb-3 flex items-start gap-2.5 border-border bg-muted/40 px-3 py-2.5">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="flex-1 text-xs leading-relaxed">
          Everything that can sign in as somebody, together: their paired phone, its app
          session, their browser sessions and their notification tokens. To change what a
          person is <em>allowed</em> to do, go to{' '}
          <Link href="/settings/users" className="text-brand hover:underline">User List</Link> or{' '}
          <Link href="/settings/roles" className="text-brand hover:underline">Roles</Link>.
        </p>
      </Card>

      {note && (
        <Card className={`mb-3 flex items-start gap-2.5 px-3 py-2.5 ${note.tone === 'bad' ? 'border-danger' : 'border-success'}`}>
          <Icon name={note.tone === 'bad' ? 'alert-circle' : 'check-circle'} className={`mt-0.5 h-4 w-4 shrink-0 ${note.tone === 'bad' ? 'text-danger' : 'text-success'}`} />
          <p className="flex-1 text-sm">{note.text}</p>
          <button type="button" onClick={() => setNote(null)} aria-label="Dismiss">
            <Icon name="x" className="h-4 w-4 text-muted-foreground" />
          </button>
        </Card>
      )}

      <SectionCard title="Everyone in this branch" icon="users" bodyClassName="p-0">
        {people.length === 0 ? (
          <EmptyState icon="users" title="Nobody here yet" hint="People appear once they have a role in this branch." />
        ) : (
          <ListFilter
            rows={people}
            noun="people"
            placeholder="Name, email, phone, role, device…"
            searchOn={(p) => [
              p.fullName, p.email, p.phone, ...p.roleNames,
              ...p.devices.map((d) => d.label),
            ]}
            chipLabel="Devices"
            chipOf={(p) => (p.phoneCount > 0 ? 'Has a phone' : p.devices.length > 0 ? 'Web only' : 'Nothing paired')}
            chips={['Has a phone', 'Web only', 'Nothing paired'].map((v) => ({
              value: v, label: v,
              count: people.filter((p) => (p.phoneCount > 0 ? 'Has a phone' : p.devices.length > 0 ? 'Web only' : 'Nothing paired') === v).length,
            }))}
          >
            {(shown) => (
              <ul className="divide-y divide-border">
                {shown.map((p) => {
                  const expanded = open === p.userId;
                  return (
                    <li key={p.userId} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setOpen(expanded ? null : p.userId)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-start"
                          aria-expanded={expanded}
                        >
                          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm font-semibold">{p.fullName}</span>
                          {!p.isActive && <Badge tone="danger">Inactive</Badge>}
                          <span className="truncate text-xs text-muted-foreground">
                            {p.roleNames.join(', ') || 'No role'}
                          </span>
                        </button>

                        <span className="text-xs text-muted-foreground">
                          {p.phoneCount > 0 ? `${p.phoneCount} phone` : 'no phone'}
                          {p.browserCount > 0 && ` · ${p.browserCount} browser`}
                          {' · seen '}{ago(p.lastSeenAt)}
                        </span>

                        {canManage && (
                          <Button
                            variant="outline" icon="phone"
                            onClick={() => { setPairing(p); setCode(null); }}
                          >
                            Pair a phone
                          </Button>
                        )}

                        {canManage && p.devices.length > 0 && (
                          <Button
                            variant="ghost" icon="ban"
                            loading={busy === p.userId}
                            onClick={() => setConfirming(p)}
                          >
                            Lost or stolen
                          </Button>
                        )}
                      </div>

                      {expanded && (
                        <div className="mt-2 ms-6 grid gap-1.5">
                          {p.devices.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              Nothing signed in. They have never used the app or the website on this branch.
                            </p>
                          ) : p.devices.map((d) => (
                            <div key={`${d.kind}-${d.id}`} className="flex flex-wrap items-center gap-2 text-xs">
                              <Icon name={KIND[d.kind].icon} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span className="font-medium">{d.label}</span>
                              <span className="text-muted-foreground">{KIND[d.kind].label}</span>
                              {d.pending && <Badge tone="warning">Pairing code not used yet</Badge>}
                              {d.detail && <span className="truncate text-muted-foreground">{d.detail}</span>}
                              <span className="ms-auto whitespace-nowrap text-muted-foreground">{ago(d.lastSeenAt)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </ListFilter>
        )}
      </SectionCard>

      {pairing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md p-4">
            <h2 className="text-base font-semibold">Pair a phone for {pairing.fullName}</h2>

            {!code ? (
              <>
                {/* A manager doing this for the first time, with the
                    technician standing in front of them. Say what pairing
                    grants and how to undo it BEFORE they commit, not after. */}
                <ol className="mt-3 grid gap-1.5 ps-4 text-sm leading-relaxed text-muted-foreground">
                  <li>Press <strong>Get a code</strong> below. It lasts 30 minutes.</li>
                  <li>On their phone, open <strong>Vcare</strong> and choose <strong>Pair this phone</strong>.</li>
                  <li>They type the six characters. That is all.</li>
                </ol>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  Pairing lets that phone act as {pairing.fullName} &mdash; clock in, open their
                  jobs, and sync their call log if that is switched on. It does <strong>not</strong>{' '}
                  change what they are allowed to do; that stays with their role.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  To undo it later, use <strong>Lost or stolen</strong> on their row. One phone per
                  person: pairing a new one replaces the old.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setPairing(null)}>Cancel</Button>
                  <Button icon="phone" loading={busy === pairing.userId} onClick={() => void pair(pairing)}>
                    Get a code
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-muted-foreground">
                  Type this into the Vcare app on their phone:
                </p>
                {/* Spaced and large: it is read off a screen across a desk and
                    typed on a phone keyboard by somebody who did not choose to
                    be doing this. */}
                <p className="my-3 text-center font-mono text-3xl font-bold tracking-[0.3em]">
                  {code.code}
                </p>
                <p className="text-center text-xs text-muted-foreground">
                  Expires at {new Date(code.expiresAt).toLocaleTimeString('en-IN', {
                    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
                  })}. If it runs out, just get another.
                </p>
                <div className="mt-4 flex justify-end">
                  <Button onClick={() => { setPairing(null); setCode(null); }}>Done</Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md p-4">
            <h2 className="text-base font-semibold">Cut off {confirming.fullName}?</h2>
            {/* Say exactly what will happen. "Are you sure?" is not informed
                consent when four different things are about to be revoked. */}
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              This unpairs every phone, ends every app session, signs out every browser and
              stops notifications &mdash; all at once, so nothing is left working while you
              move between screens.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Their account is <strong>not</strong> disabled and nothing is deleted. They can
              sign in again and pair a new phone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(null)}>Cancel</Button>
              <Button variant="danger" icon="ban" onClick={() => void cutOff(confirming)}>
                Cut off everything
              </Button>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
