'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, PageHeader, SectionCard, Segmented } from '@/components/ui/Layout';
import { BOM, parseCsv, rowsToObjects, toCsv } from '@/lib/csv';
import { templateHeaders, fieldsFor, type ImportTarget } from '@/lib/import-fields';
import { dryRunImport, commitImport } from './actions';
import type { DryRunReport, ImportOutcome } from '@/server/import';

interface Props {
  canImportCustomers: boolean;
  canImportProducts: boolean;
  isSingleStore: boolean;
}

type Stage = 'pick' | 'preview' | 'done';

export function ImportClient({ canImportCustomers, canImportProducts, isSingleStore }: Props) {
  const router = useRouter();
  const [target, setTarget] = useState<ImportTarget>(canImportCustomers ? 'customers' : 'products');
  const [stage, setStage] = useState<Stage>('pick');
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [report, setReport] = useState<DryRunReport | null>(null);
  const [outcomes, setOutcomes] = useState<ImportOutcome[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canImport = target === 'customers' ? canImportCustomers : canImportProducts;

  function downloadTemplate() {
    const csv = BOM + toCsv([], templateHeaders(target).map((h) => ({ header: h, value: () => '' })));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${target}-import-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setStage('pick'); setFileName(null); setHeaders([]); setRows([]);
    setReport(null); setOutcomes(null); setError(null);
  }

  async function onFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const text = await file.text();
      const matrix = parseCsv(text);
      const { headers: h, rows: r } = rowsToObjects(matrix);

      if (r.length === 0) {
        setError('That file has no data rows - is it the template with nothing filled in yet?');
        setBusy(false);
        return;
      }

      setFileName(file.name);
      setHeaders(h);
      setRows(r);

      const res = await dryRunImport(target, h, r);
      if (res.error) { setError(res.error); setBusy(false); return; }
      setReport(res.data ?? null);
      setStage('preview');
    } catch {
      setError('Could not read that file. Check it is a plain CSV export.');
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await commitImport(target, headers, rows);
      if (res.error) { setError(res.error); setBusy(false); return; }
      setOutcomes(res.data ?? []);
      setStage('done');
      router.refresh();
    } catch {
      setError('The import failed. Nothing further was created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader badge="IM" title="Import Data" subtitle="Bring customers and products in from a spreadsheet" />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}

      {!isSingleStore && (
        <Card className="mb-3 border-warning/40 bg-warning/10 p-3">
          <p className="text-sm"><strong>All Company</strong> is read-only. Select a single store to import.</p>
        </Card>
      )}

      {stage === 'pick' && (
        <SectionCard title="1. Choose what to import" icon="upload">
          {canImportCustomers && canImportProducts && (
            <Segmented
              value={target}
              onChange={(v) => { setTarget(v); reset(); }}
              options={[
                { value: 'customers' as const, label: 'Customers' },
                { value: 'products' as const, label: 'Products' },
              ]}
            />
          )}

          {!canImport ? (
            <p className="mt-3 text-sm text-muted-foreground">
              You do not have permission to import {target}.
            </p>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button variant="outline" iconEnd="download" onClick={downloadTemplate}>
                  Download {target} template
                </Button>
                <span className="text-xs text-muted-foreground">
                  Fill it in, keep the header row, then upload it below.
                </span>
              </div>

              <div className="mt-4">
                <label>
                  <span className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-brand-fg hover:opacity-90">
                    <Icon name="upload" className="h-4 w-4" />
                    {busy ? 'Reading…' : 'Choose CSV file'}
                  </span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    disabled={busy || !isSingleStore}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onFile(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>

              <FieldReference target={target} />
            </>
          )}
        </SectionCard>
      )}

      {stage === 'preview' && report && (
        <>
          <SectionCard
            title={`2. Check the file - ${fileName}`}
            icon="check-circle"
            action={<Button variant="outline" size="sm" onClick={reset}>Start over</Button>}
          >
            {report.missingRequired.length > 0 ? (
              <div className="rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm text-on-tint-danger">
                Could not find a column for: <strong>{report.missingRequired.join(', ')}</strong>.
                Check the header row matches the template.
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <Badge tone="success" icon="check-circle">{report.validCount} ready to import</Badge>
                {report.rows.length - report.validCount > 0 && (
                  <Badge tone="danger" icon="alert-circle">
                    {report.rows.length - report.validCount} with an error
                  </Badge>
                )}
                <span className="text-muted-foreground">{report.rows.length} rows in the file</span>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-1.5">
              {report.matched.map((m) => (
                <Badge key={m.field} tone={m.column ? 'neutral' : 'warning'} title={m.column ?? 'not found in this file'}>
                  {fieldsFor(target).find((f) => f.key === m.field)?.label}: {m.column ?? '-'}
                </Badge>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Row by row" icon="file-text" className="mt-4" bodyClassName="p-0">
            <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
              {report.rows.map((r) => (
                <div key={r.line} className="flex items-start gap-3 px-4 py-2">
                  <span className="w-12 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">Row {r.line}</span>
                  <Icon
                    name={r.ok ? 'check-circle' : 'alert-circle'}
                    className={`mt-0.5 h-4 w-4 shrink-0 ${r.ok ? 'text-success' : 'text-danger'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.summary}</p>
                    {r.errors.map((e, i) => <p key={i} className="text-xs text-danger">{e}</p>)}
                    {r.notes.map((n, i) => <p key={i} className="text-xs text-warning">{n}</p>)}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          {report.validCount > 0 && report.missingRequired.length === 0 && (
            <div className="mt-4 flex justify-end">
              <Button variant="primary" loading={busy} onClick={doImport}>
                Import {report.validCount} row{report.validCount === 1 ? '' : 's'}
              </Button>
            </div>
          )}
        </>
      )}

      {stage === 'done' && outcomes && (
        <SectionCard
          title="3. Done"
          icon="check-circle"
          action={<Button variant="outline" size="sm" onClick={reset}>Import another file</Button>}
          bodyClassName="p-0"
        >
          <div className="border-b border-border bg-muted/20 px-4 py-3 text-sm">
            <strong>{outcomes.filter((o) => o.ok).length}</strong> created
            {outcomes.some((o) => !o.ok) && (
              <> · <strong className="text-danger">{outcomes.filter((o) => !o.ok).length}</strong> failed and were skipped</>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
            {outcomes.map((o) => (
              <div key={o.line} className="flex items-center gap-3 px-4 py-2">
                <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">Row {o.line}</span>
                <Icon name={o.ok ? 'check-circle' : 'alert-circle'} className={`h-4 w-4 shrink-0 ${o.ok ? 'text-success' : 'text-danger'}`} />
                <span className="min-w-0 flex-1 truncate text-sm">{o.summary}</span>
                {o.ok ? (
                  <Badge tone="success">{o.code}</Badge>
                ) : (
                  <span className="text-xs text-danger">{o.error}</span>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {stage === 'pick' && !canImportCustomers && !canImportProducts && (
        <EmptyState icon="upload" title="Nothing to import" hint="You do not have permission to add customers or products." />
      )}
    </div>
  );
}

function FieldReference({ target }: { target: ImportTarget }) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3">
      <p className="mb-2 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
        Columns this recognises
      </p>
      <div className="flex flex-wrap gap-1.5">
        {fieldsFor(target).map((f) => (
          <Badge key={f.key} tone={f.required ? 'brand' : 'neutral'}>
            {f.label}{f.required ? ' *' : ''}
          </Badge>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Matched by header text, not column order - near-enough spellings like &ldquo;Mobile&rdquo; for
        Phone are recognised too. * required.
      </p>
    </div>
  );
}
