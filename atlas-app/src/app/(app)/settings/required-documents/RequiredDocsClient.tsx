'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader, Badge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  ATTACHMENT_TAGS, DEFAULT_REQUIRED, REQUIRED_DOCS, type RequiredDoc, type RequiredRule,
} from '@/lib/attachment-tags';
import { saveRequiredDocsAction } from './actions';

/**
 * The required-documents table (ops-pages demo tab 4): per document, which
 * tagged file it needs and what happens when it is missing. Warn = amber on
 * the document; Block = the named step refuses with a clear message.
 */
const DOCS = Object.keys(REQUIRED_DOCS) as RequiredDoc[];

export function RequiredDocsClient({ initial, canEdit }: { initial: RequiredRule[]; canEdit: boolean }) {
  const router = useRouter();
  const [rules, setRules] = useState<RequiredRule[]>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const set = (i: number, p: Partial<RequiredRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const add = () => setRules((rs) => [...rs, { doc: 'sales_order', tag: 'Other', mode: 'warn', on: true }]);
  const drop = (i: number) => setRules((rs) => rs.filter((_, j) => j !== i));
  const save = () => start(async () => {
    setMsg(null);
    const r = await saveRequiredDocsAction(rules);
    setMsg(r.error ?? 'Saved - documents check these now.');
    if (!r.error) router.refresh();
  });

  const field = 'rounded-sm border border-border bg-card px-2 py-1 text-sm disabled:opacity-60';

  return (
    <div className="space-y-4">
      <PageHeader badge="RD" title="Required documents" subtitle="Which files each document needs. Warn shows amber on the document; Block stops that one step until the file is attached and tagged." />
      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Icon name="shield-check" className="h-4 w-4 text-brand" />
          <h3 className="me-auto text-sm font-semibold">Settings › Required documents</h3>
          <span className="text-xs text-muted-foreground">Per document type - admin only</span>
        </div>
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-micro font-semibold uppercase text-muted-foreground">
                <th className="pb-2 text-start">Document</th>
                <th className="pb-2 text-start">Needs</th>
                <th className="pb-2 text-start">If missing</th>
                <th className="pb-2 text-start">On</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r, i) => {
                const step = REQUIRED_DOCS[r.doc].step;
                return (
                  <tr key={i} className={`border-t border-border ${r.on ? '' : 'opacity-55'}`}>
                    <td className="py-2 pe-2">
                      <select aria-label="Document" disabled={!canEdit} value={r.doc} className={field}
                        onChange={(e) => { const doc = e.target.value as RequiredDoc; set(i, { doc, mode: REQUIRED_DOCS[doc].step ? r.mode : 'warn' }); }}>
                        {DOCS.map((d) => <option key={d} value={d}>{REQUIRED_DOCS[d].label}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pe-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <select aria-label="Needs" disabled={!canEdit} value={r.tag} className={field} onChange={(e) => set(i, { tag: e.target.value as RequiredRule['tag'] })}>
                          {ATTACHMENT_TAGS.map((t) => <option key={t}>{t}</option>)}
                        </select>
                        {r.doc === 'receipt' && (
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">over ₹
                            <input type="number" min={0} step={1000} disabled={!canEdit} aria-label="Only over this amount (rupees)"
                              value={r.overPaise ? r.overPaise / 100 : ''} placeholder="any"
                              onChange={(e) => set(i, { overPaise: e.target.value ? Math.round(Number(e.target.value) * 100) : undefined })}
                              className={`${field} w-24`} />
                          </label>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pe-2">
                      {canEdit && step ? (
                        <div className="flex rounded-full bg-muted p-0.5 text-xs">
                          <button type="button" onClick={() => set(i, { mode: 'warn' })} className={`rounded-full px-2.5 py-1 font-medium ${r.mode === 'warn' ? 'bg-card shadow-raised text-warning' : 'text-muted-foreground'}`}>Warn</button>
                          <button type="button" onClick={() => set(i, { mode: 'block' })} className={`rounded-full px-2.5 py-1 font-medium ${r.mode === 'block' ? 'bg-card shadow-raised text-danger' : 'text-muted-foreground'}`}>Block &ldquo;{step}&rdquo;</button>
                        </div>
                      ) : (
                        <Badge tone={r.mode === 'block' ? 'danger' : 'warning'} title={step ? undefined : 'A receipt has no later step to stop, so it can only warn.'}>
                          {r.mode === 'block' && step ? `Block “${step}”` : 'Warn'}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pe-2">
                      <input type="checkbox" aria-label="Rule on" disabled={!canEdit} checked={r.on} onChange={(e) => set(i, { on: e.target.checked })} className="h-4 w-4 accent-brand" />
                    </td>
                    <td className="py-2 text-end">
                      {canEdit && (
                        <button type="button" title="Remove rule" aria-label="Remove rule" onClick={() => drop(i)} className="rounded-full p-1.5 text-muted-foreground hover:bg-danger/10 hover:text-danger">
                          <Icon name="trash" className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Files are matched by their tag. A receipt can only warn - it has no later step to stop. Delivery is checked when an order is marked Delivered; Installation when it is handed over.
        </p>
        {canEdit ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" icon="check" loading={pending} onClick={save}>Save</Button>
            <Button icon="plus" onClick={add}>Add a rule</Button>
            <Button variant="ghost" icon="rotate-ccw" onClick={() => setRules(DEFAULT_REQUIRED)}>Back to the defaults</Button>
            {msg && <span role="status" className="text-sm text-muted-foreground">{msg}</span>}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Only an admin can change these, with a single branch picked.</p>
        )}
      </section>
    </div>
  );
}
