'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { resolveAccess, type AccessSettings } from '@/lib/app-access';
import {
  loadRoleAccessAction, loadUserAccessAction, saveRoleAccessAction, saveUserAccessAction,
} from '@/app/actions/app-access';
import { AccessForm, WhatTheySee } from './AccessForm';

/**
 * Phone app access dialogs (26 Sep 2026, PHONE-APP-ACCESS-SPEC.md):
 * one for a role (Settings > Roles), one for a person's override
 * (Settings > Users). Changes reach the phone the next time the app opens.
 */

type RoleView = NonNullable<Awaited<ReturnType<typeof loadRoleAccessAction>>>;
type UserView = NonNullable<Awaited<ReturnType<typeof loadUserAccessAction>>>;

function Loading() {
  return <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Icon name="refresh" className="h-4 w-4 animate-spin" /> Loading…</p>;
}

export function RolePhoneAppDialog({ roleId, onClose, onSaved }: { roleId: string; onClose: () => void; onSaved: () => void }) {
  const [view, setView] = useState<RoleView | null>(null);
  const [values, setValues] = useState<AccessSettings>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    loadRoleAccessAction(roleId).then((v) => {
      if (!v) { setError('That role could not be loaded.'); return; }
      setView(v);
      setValues(v.settings);
    });
  }, [roleId]);

  const preview = useMemo(() => (view ? resolveAccess([values], {}, view.permissions) : null), [view, values]);

  const save = () => start(async () => {
    const r = await saveRoleAccessAction(roleId, values);
    if (r.error) setError(r.error);
    else onSaved();
  });

  return (
    <Modal
      title={view ? `Phone app - ${view.roleName}` : 'Phone app'}
      subtitle={view ? `${view.storeName} · what everyone with this role sees in Vcare` : undefined}
      icon="phone"
      size="xl"
      onClose={onClose}
      footer={<>
        <Button onClick={onClose} disabled={pending}>Cancel</Button>
        {view?.canEdit && <Button variant="primary" loading={pending} onClick={save}>Save</Button>}
      </>}
    >
      {!view && !error && <Loading />}
      {error && <p role="alert" className="mb-3 rounded bg-danger/10 px-3 py-2 text-sm text-on-tint-danger">{error}</p>}
      {view && preview && (
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <div>
            {view.isPreset && (
              <p className="mb-3 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs">
                Not saved yet - these are the suggested settings for a role called &quot;{view.roleName}&quot;. Change anything and save.
              </p>
            )}
            <AccessForm mode="role" values={values} onChange={setValues} permissions={view.permissions} disabled={!view.canEdit} />
          </div>
          <div className="grid gap-3 lg:sticky lg:top-0 lg:self-start">
            <WhatTheySee name={`a ${view.roleName}`} r={preview} />
            <p className="text-xs text-muted-foreground">
              Someone with two roles gets whichever gives more. One person can be changed on their own from Settings › Users › Phone app.
              The app picks up changes the next time it opens.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function UserPhoneAppDialog({ user, onClose }: {
  user: { id: string; fullName: string; assignments: { storeId: string; storeName: string }[] };
  onClose: () => void;
}) {
  const branches = useMemo(() => [...new Map(user.assignments.map((a) => [a.storeId, a.storeName])).entries()], [user.assignments]);
  const [storeId, setStoreId] = useState(branches[0]?.[0] ?? '');
  const [view, setView] = useState<UserView | null>(null);
  const [override, setOverride] = useState<AccessSettings>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!storeId) return;
    setView(null);
    loadUserAccessAction(user.id, storeId).then((v) => {
      if (!v) { setError('This person could not be loaded for that branch.'); return; }
      setView(v);
      setOverride(v.override);
    });
  }, [user.id, storeId]);

  const preview = useMemo(
    () => (view ? resolveAccess(view.roles.map((r) => r.settings), override, view.permissions) : null),
    [view, override],
  );

  const save = () => start(async () => {
    setSaved(false);
    const r = await saveUserAccessAction(user.id, storeId, override);
    if (r.error) setError(r.error);
    else { setError(null); setSaved(true); }
  });

  return (
    <Modal
      title={`Phone app - ${user.fullName}`}
      subtitle="Only what is different for this person. Everything else follows their role."
      icon="phone"
      size="xl"
      onClose={onClose}
      footer={<>
        <Button onClick={onClose} disabled={pending}>Close</Button>
        {view?.canEdit && Object.keys(override).length > 0 && (
          <Button onClick={() => setOverride({})} disabled={pending}>Reset to role</Button>
        )}
        {view?.canEdit && <Button variant="primary" loading={pending} onClick={save}>Save</Button>}
      </>}
    >
      {branches.length === 0 && <p className="text-sm text-muted-foreground">This person has no role yet, so the app shows them nothing. Give them a role first.</p>}
      {branches.length > 1 && (
        <label className="mb-3 flex items-center gap-2 text-sm">
          Branch
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="h-8 rounded-lg border border-border bg-card px-2 text-sm">
            {branches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      )}
      {branches.length > 0 && !view && !error && <Loading />}
      {error && <p role="alert" className="mb-3 rounded bg-danger/10 px-3 py-2 text-sm text-on-tint-danger">{error}</p>}
      {saved && <p className="mb-3 rounded bg-success/10 px-3 py-2 text-sm text-on-tint-success">Saved. Their phone picks it up the next time the app opens.</p>}
      {view && preview && (
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <div>
            <p className="mb-3 text-xs text-muted-foreground">
              Roles here: <strong className="text-foreground">{view.roles.map((r) => r.name).join(', ') || 'none'}</strong>
            </p>
            <AccessForm
              mode="user" values={override} onChange={setOverride} permissions={view.permissions}
              base={view.fromRoles.values} disabled={!view.canEdit}
            />
          </div>
          <div className="lg:sticky lg:top-0 lg:self-start">
            <WhatTheySee name={user.fullName} r={preview} />
          </div>
        </div>
      )}
    </Modal>
  );
}
