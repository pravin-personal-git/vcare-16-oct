'use client';

import { useEffect, useState } from 'react';
import { PageHeader, Badge, Card, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { ChannelKind } from '@/lib/messaging/contract';
import { saveChannelAction, testChannelAction } from './actions';

/**
 * Settings > Email & WhatsApp (workstream D).
 *
 * Both channels on one screen, because an admin setting up communications is
 * doing one job, not two - and because the differences between them (a
 * sending domain here, an approved template there) only make sense side by
 * side.
 */

interface ProviderVM {
  id: string;
  label: string;
  hint: string;
  fields: { key: string; label: string; secret: boolean; placeholder?: string; hint?: string }[];
}

interface ChannelVM {
  channel: ChannelKind;
  provider: string;
  values: Record<string, string>;
  secretState: Record<string, string | null>;
  fromName: string | null;
  fromAddress: string | null;
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestNote: string | null;
}

const TITLE: Record<ChannelKind, string> = { email: 'Email', whatsapp: 'WhatsApp' };

export function MessagingClient({ email, whatsapp, saved, canEdit, secretsAvailable }: {
  email: ProviderVM[];
  whatsapp: ProviderVM[];
  saved: ChannelVM[];
  canEdit: boolean;
  secretsAvailable: boolean;
}) {
  return (
    <>
      <PageHeader
        badge="MSG"
        title="Email & WhatsApp"
        subtitle="How this branch reaches its customers, and who it comes from"
      />

      {!secretsAvailable && (
        /* Said plainly and first. Saving would throw, and an error on submit
           is a worse way to learn this than a line at the top. */
        <Card className="mb-3 flex items-start gap-2.5 border-danger px-3 py-2.5">
          <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <p className="flex-1 text-sm leading-relaxed">
            <strong>This Atlas cannot store credentials yet.</strong> An API key is encrypted
            before it is written, and the key that does the encrypting
            (<span className="font-mono text-xs">ATLAS_SECRET_KEY</span>) is not set on the
            server. Ask your administrator to set it, then come back.
          </p>
        </Card>
      )}

      <div className="grid gap-3">
        {(['email', 'whatsapp'] as const).map((channel) => (
          <ChannelCard
            key={channel}
            channel={channel}
            providers={channel === 'email' ? email : whatsapp}
            saved={saved.find((s) => s.channel === channel) ?? null}
            canEdit={canEdit && secretsAvailable}
          />
        ))}
      </div>

      <Card className="mt-3 px-3 py-2.5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          <strong>Your key is encrypted before it is stored</strong> and is never shown again -
          only its last four characters. Nobody at N.A.I.R. Solutions can read it out of a
          database backup. To change it, type the new one; leaving the box empty keeps what is
          already saved.
        </p>
      </Card>
    </>
  );
}

function ChannelCard({ channel, providers, saved, canEdit }: {
  channel: ChannelKind;
  providers: ProviderVM[];
  saved: ChannelVM | null;
  canEdit: boolean;
}) {
  const [providerId, setProviderId] = useState(saved?.provider ?? providers[0]?.id ?? '');
  // This site's address, for the webhook line - read after load so the server and browser render agree.
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const [values, setValues] = useState<Record<string, string>>(saved?.values ?? {});
  const [fromName, setFromName] = useState(saved?.fromName ?? '');
  const [fromAddress, setFromAddress] = useState(saved?.fromAddress ?? '');
  const [isActive, setIsActive] = useState(saved?.isActive ?? true);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const provider = providers.find((p) => p.id === providerId);
  const sameProvider = saved?.provider === providerId;

  const save = async () => {
    setBusy('save');
    const r = await saveChannelAction({ channel, provider: providerId, values, fromName, fromAddress, isActive });
    setBusy(null);
    setNote(r.error ? { tone: 'bad', text: r.error } : { tone: 'ok', text: 'Saved.' });
  };

  const test = async () => {
    setBusy('test');
    const r = await testChannelAction(channel, testTo);
    setBusy(null);
    setNote(r.error ? { tone: 'bad', text: r.error } : { tone: 'ok', text: r.message ?? 'Sent.' });
  };

  return (
    <SectionCard
      title={TITLE[channel]}
      icon={channel === 'email' ? 'mail' : 'whatsapp'}
      action={
        saved?.lastTestedAt
          ? <Badge tone={saved.lastTestOk ? 'success' : 'danger'}>
            {saved.lastTestOk ? 'Test passed' : 'Test failed'}
          </Badge>
          : <Badge tone="neutral">Never tested</Badge>
      }
    >
      {saved?.lastTestOk === false && saved.lastTestNote && (
        <p className="mb-2 text-xs text-danger">{saved.lastTestNote}</p>
      )}

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Provider</span>
        <select
          value={providerId} disabled={!canEdit}
          onChange={(e) => { setProviderId(e.target.value); setValues({}); }}
          className="h-9 w-full max-w-sm rounded-md border border-border bg-background px-2 text-sm"
        >
          {providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {provider && <span className="mt-1 block text-xs text-muted-foreground">{provider.hint}</span>}
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {provider?.fields.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="mb-1 block font-medium">{f.label}</span>
            <input
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              disabled={!canEdit}
              placeholder={
                f.secret && sameProvider && saved?.secretState[f.key]
                  ? saved.secretState[f.key]!
                  : f.placeholder
              }
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            />
            {f.hint && <span className="mt-1 block text-xs text-muted-foreground">{f.hint}</span>}
            {f.secret && sameProvider && saved?.secretState[f.key] && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Already set. Leave blank to keep it.
              </span>
            )}
          </label>
        ))}
      </div>

      {channel === 'whatsapp' && providerId === 'whatsapp_cloud' && (
        <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed">
          <p className="mb-1 font-semibold">Sending documents as PDF - one-time setup in Meta</p>
          <ol className="ms-4 list-decimal space-y-0.5 text-muted-foreground">
            <li>In WhatsApp Manager, create a <b>Utility</b> template with a <b>Document</b> header and a body using {'{{1}}'} customer name, {'{{2}}'} document and number, {'{{3}}'} your business - e.g. &quot;Hello {'{{1}}'}, please find {'{{2}}'} from {'{{3}}'} attached.&quot; Wait for Meta to approve it, then type its name above.</li>
            <li>In your Meta app: WhatsApp &gt; Configuration &gt; Webhook. Callback URL:
              {' '}<span className="select-all rounded bg-card px-1 font-mono text-foreground">{`${origin}/api/webhooks/whatsapp`}</span>,
              verify token: the word you typed above. Subscribe to <b>messages</b>.</li>
            <li>Copy the App secret (Settings &gt; Basic) into App secret above, so Atlas can trust the &quot;delivered&quot; and &quot;read&quot; updates.</li>
          </ol>
          <p className="mt-1 text-muted-foreground">Then every invoice, quotation and order page shows <b>Send PDF from business WhatsApp</b>, with sent, delivered and read beside it.</p>
        </div>
      )}

      {channel === 'email' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">From name</span>
            <input
              value={fromName} disabled={!canEdit}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Vcare Global"
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">From address</span>
            <input
              value={fromAddress} disabled={!canEdit}
              onChange={(e) => setFromAddress(e.target.value)}
              placeholder="accounts@yourcompany.com"
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Must be on a domain your provider has verified, or mail is rejected or spam-filed.
            </span>
          </label>
        </div>
      )}

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox" checked={isActive} disabled={!canEdit}
          onChange={(e) => setIsActive(e.target.checked)}
        />
        <span>Use this channel</span>
      </label>

      {note && (
        <p className={`mt-3 text-sm ${note.tone === 'bad' ? 'text-danger' : 'text-success'}`}>
          {note.text}
        </p>
      )}

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Button icon="check" loading={busy === 'save'} onClick={() => void save()}>Save</Button>

          <div className="ms-auto flex items-end gap-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">
                Send a test to {channel === 'email' ? 'an address' : 'a number'}
              </span>
              <input
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder={channel === 'email' ? 'you@yourcompany.com' : '98275 63406'}
                className="h-9 w-56 rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>
            <Button variant="outline" icon="send" loading={busy === 'test'} onClick={() => void test()}>
              Send test
            </Button>
          </div>
        </div>
      )}

      {channel === 'whatsapp' && (
        /* The single thing that surprises everyone setting WhatsApp up.
           Better here than discovered through a 400 from Meta. */
        <p className="mt-3 border-t border-border pt-2 text-xs leading-relaxed text-muted-foreground">
          <strong>WhatsApp will not let you message someone out of the blue in plain text.</strong>{' '}
          Free text only reaches a customer who messaged you in the last 24 hours. Anything you
          start - an invoice, a job update - must use a template approved by Meta in advance.
          Only the official Business API is supported: QR-code tools get the number banned, and
          it is the number your customers have saved.
        </p>
      )}
    </SectionCard>
  );
}
