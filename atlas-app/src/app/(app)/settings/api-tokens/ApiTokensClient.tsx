'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { createApiTokenAction, revokeApiTokenAction } from './actions';

interface Token {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

/**
 * Workspace tokens for external agents - the "bearer-token generator" the
 * MCP Connector and ChatGPT/OpenAI Connector settings cards both point at.
 * One token system, two marketing names - both call the same `/api/mcp`.
 */
export function ApiTokensClient({ tokens, canEdit }: { tokens: Token[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Token | null>(null);

  const live = tokens.filter((t) => !t.revokedAt);

  const report = (res: { error?: string; message?: string }) => {
    setError(res.error ?? null);
    setNotice(res.error ? null : res.message ?? null);
    if (!res.error) router.refresh();
  };

  return (
    <div>
      <PageHeader
        badge="AT"
        title="API Tokens"
        subtitle="Bearer tokens for external agents - MCP Connector and ChatGPT/OpenAI Connector both use these"
        actions={
          canEdit ? (
            <Button variant="primary" icon="plus" onClick={() => { setIssued(null); setCreating(true); }}>
              New token
            </Button>
          ) : undefined
        }
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}
      {notice && !error && (
        <Card className="mb-3 border-success/40 bg-success/5 p-3">
          <p className="flex items-start gap-2 text-sm">
            <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <span>{notice}</span>
          </p>
        </Card>
      )}

      <SectionCard title={`${live.length} active token${live.length === 1 ? '' : 's'}`} icon="lock" bodyClassName="p-0">
        {tokens.length === 0 ? (
          <EmptyState icon="lock" title="No tokens yet" hint="Create one to let an external agent read this workspace's data over /api/mcp." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-semibold">Label</th>
                <th className="px-4 py-2 font-semibold">Created</th>
                <th className="px-4 py-2 font-semibold">Last used</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="w-20 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-medium">{t.label}</td>
                  <td className="px-4 py-2 text-muted-foreground">{fmt(t.createdAt)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{fmt(t.lastUsedAt)}</td>
                  <td className="px-4 py-2">
                    {t.revokedAt ? <Badge tone="danger">Revoked</Badge> : <Badge tone="success">Active</Badge>}
                  </td>
                  <td className="px-4 py-2">
                    {canEdit && !t.revokedAt && (
                      <button type="button" onClick={() => setRevoking(t)}
                        className="grid h-7 w-7 place-items-center rounded text-muted-foreground hover:bg-danger/10 hover:text-danger"
                        aria-label={`Revoke ${t.label}`}>
                        <Icon name="x" className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {creating && (
        <CreateDialog
          pending={pending}
          issued={issued}
          onClose={() => { setCreating(false); setIssued(null); router.refresh(); }}
          onCreate={(label) => {
            setError(null);
            startTransition(async () => {
              const res = await createApiTokenAction(label);
              if (res.error) { setError(res.error); setCreating(false); return; }
              if (res.token) setIssued(res.token);
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
              <Button variant="danger" icon="x" loading={pending}
                onClick={() => { const id = revoking.id; setRevoking(null); startTransition(async () => report(await revokeApiTokenAction(id))); }}>
                Revoke
              </Button>
            </div>
          }
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            Any agent using this token is refused immediately.
          </p>
        </Modal>
      )}
    </div>
  );
}

function CreateDialog({
  pending, issued, onClose, onCreate,
}: {
  pending: boolean;
  issued: string | null;
  onClose: () => void;
  onCreate: (label: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [copied, setCopied] = useState(false);

  return (
    <Modal
      open
      title="New API token"
      subtitle={issued ? 'Copy this token now' : 'For an MCP connector, ChatGPT/OpenAI, or any external agent'}
      icon="lock"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button onClick={onClose}>{issued ? 'Done' : 'Cancel'}</Button>
          {!issued && (
            <Button variant="primary" icon="plus" disabled={!label.trim() || pending} loading={pending} onClick={() => onCreate(label)}>
              Create
            </Button>
          )}
        </div>
      }
    >
      {issued ? (
        <div>
          <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
            This token will not be shown again. Send it as
            <code className="mx-1 rounded bg-muted px-1">Authorization: Bearer &lt;token&gt;</code>
            to <code className="rounded bg-muted px-1">/api/mcp</code>.
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
            <code className="flex-1 break-all font-mono text-xs">{issued}</code>
            <button type="button" onClick={() => { navigator.clipboard.writeText(issued); setCopied(true); }}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : (
        <Field label="Label" required htmlFor="tok-label" hint="A name to recognise this token by later.">
          <input id="tok-label" value={label} placeholder="Claude Desktop"
            onChange={(e) => setLabel(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
        </Field>
      )}
    </Modal>
  );
}
