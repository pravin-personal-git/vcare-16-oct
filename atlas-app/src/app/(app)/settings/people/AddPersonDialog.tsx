'use client';

import { useState, useTransition } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Layout';
import { whatsappLink } from '@/lib/revenue';
import { addPersonAction } from './actions';

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

const TYPES = [
  { v: 'full_time', l: 'Full time' }, { v: 'part_time', l: 'Part time' },
  { v: 'contract', l: 'Contract (also outside accountant / auditor)' }, { v: 'intern', l: 'Intern' },
];

export interface AddPersonOptions {
  roles: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  managers: { id: string; name: string }[];
}

/** "ravi kumar" -> "ravi.kumar" - a suggestion the admin can change. */
const suggestUsername = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 30);

/**
 * Add a person (B3 part 2, 11 Oct 2026): login, role(s) in this branch,
 * employee record and manager in one form. Every login is an employee
 * (Pravin, P3). After saving: the sign-in details once, to send.
 */
export function AddPersonDialog({ options, storeName, onClose }: { options: AddPersonOptions; storeName: string; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [touchedUser, setTouchedUser] = useState(false);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [managerId, setManagerId] = useState('');
  const [employmentType, setEmploymentType] = useState('full_time');
  const [joined, setJoined] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  const [password, setPassword] = useState('');
  const [done, setDone] = useState<{ userId: string; username: string; password: string; warning: string | null } | null>(null);

  const save = () => start(async () => {
    setError(null);
    const r = await addPersonAction({
      fullName, username, phone: phone || null, email: email || null, departmentId: departmentId || null,
      roleIds, managerId: managerId || null, employmentType, dateOfJoining: joined || null, password: password || null,
    });
    if (r.error || !r.userId) { setError(r.error ?? 'Could not add the person.'); return; }
    setDone({ userId: r.userId, username: r.username!, password: r.password!, warning: r.warning ?? null });
  });

  if (done) {
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    const message = `Hi ${fullName.trim()}, your Atlas sign-in:\nLink: ${origin}/login\nUsername: ${done.username}\nPassword: ${done.password}`;
    return (
      <Modal title={`${fullName.trim()} is added`} subtitle={storeName} icon="user-plus" size="sm" onClose={() => { window.location.reload(); onClose(); }}
        footer={<>
          <Button variant="outline" onClick={() => { window.location.href = `/settings/people/${done.userId}`; }}>Open their page</Button>
          <Button variant="wa" icon="whatsapp" onClick={() => window.open(whatsappLink(phone || null, message), '_blank')}>Send on WhatsApp</Button>
        </>}>
        <div className="grid gap-3 text-sm">
          <p>Login, role{roleIds.length === 1 ? '' : 's'} and employee record are made. Send the sign-in now - the password is shown here once (an admin can read it again in User List).</p>
          <div className="rounded-lg bg-muted px-3 py-2 font-mono text-sm">
            <div>Username: <strong>{done.username}</strong></div>
            <div>Password: <strong className="select-all">{done.password}</strong></div>
          </div>
          {done.warning && <p className="rounded-lg bg-warning/10 px-3 py-2 text-on-tint-warning">{done.warning}</p>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Add a person"
      subtitle={`${storeName} · login, role and employee record together`}
      icon="user-plus"
      size="md"
      onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="check" disabled={pending || !fullName.trim() || !username.trim() || roleIds.length === 0} onClick={save}>
          {pending ? 'Adding…' : 'Add person'}
        </Button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-on-tint-danger sm:col-span-2">{error}</p>}
        <Field label="Full name" required htmlFor="p-name" className="sm:col-span-2">
          <input id="p-name" value={fullName} autoFocus className={inputClass}
            onChange={(e) => { setFullName(e.target.value); if (!touchedUser) setUsername(suggestUsername(e.target.value)); }} />
        </Field>
        <Field label="Username" required hint="What they type to sign in." htmlFor="p-user">
          <input id="p-user" value={username} className={inputClass} onChange={(e) => { setTouchedUser(true); setUsername(e.target.value); }} />
        </Field>
        <Field label="Password" hint="Leave blank and Atlas picks a strong one (or at least 12 characters)." htmlFor="p-pwd">
          <input id="p-pwd" value={password} className={inputClass} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Mobile" htmlFor="p-phone" hint="Also where the sign-in is sent.">
          <input id="p-phone" inputMode="tel" value={phone} className={inputClass} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="p-email">
          <input id="p-email" type="email" value={email} className={inputClass} onChange={(e) => setEmail(e.target.value)} />
        </Field>

        <Field label="Role in this branch" required className="sm:col-span-2" hint="Tick one or more - they add up.">
          <div className="flex flex-wrap gap-2">
            {options.roles.map((r) => (
              <label key={r.id} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${roleIds.includes(r.id) ? 'border-brand bg-brand/10 text-brand' : 'border-border'}`}>
                <input type="checkbox" className="accent-brand" checked={roleIds.includes(r.id)}
                  onChange={(e) => setRoleIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id)))} />
                {r.name}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Reports to" htmlFor="p-mgr">
          <select id="p-mgr" value={managerId} className={inputClass} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">Nobody</option>
            {options.managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </Field>
        <Field label="Department" htmlFor="p-dept">
          <select id="p-dept" value={departmentId} className={inputClass} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">-</option>
            {options.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <Field label="Employment type" required htmlFor="p-type">
          <select id="p-type" value={employmentType} className={inputClass} onChange={(e) => setEmploymentType(e.target.value)}>
            {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </Field>
        <Field label="Joining date" htmlFor="p-joined">
          <input id="p-joined" type="date" value={joined} className={inputClass} onChange={(e) => setJoined(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
