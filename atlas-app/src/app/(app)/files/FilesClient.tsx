'use client';
import { newestFirst, oldestFirst } from '@/lib/card-list';
import { ListFilter } from '@/components/ui/ListFilter';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, EmptyState, Field, PageHeader, SectionCard } from '@/components/ui/Layout';
import { describeSize } from '@/lib/file-type';

/**
 * Common Hub → Shared Files & Docs.
 *
 * Deliberately flat: one label per file rather than a folder tree, matching
 * the reference app's own equivalent screen and `server/shared-files.ts`'s
 * reasoning for the same choice.
 */

interface FileRow {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  folder: string;
  description: string | null;
  url: string | null;
  uploadedAt: string;
  uploadedByName: string | null;
}

interface Props {
  files: FileRow[];
  folders: string[];
  canEdit: boolean;
  isSingleStore: boolean;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });

export function FilesClient({ files, folders, canEdit, isSingleStore }: Props) {
  const router = useRouter();
  const [active, setActive] = useState<string | 'All'>('All');
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderInput, setFolderInput] = useState('');

  const shown = useMemo(
    () => (active === 'All' ? files : files.filter((f) => f.folder === active)),
    [files, active],
  );

  async function upload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const form = new FormData();
        form.set('file', file);
        if (folderInput.trim()) form.set('folder', folderInput.trim());
        const res = await fetch('/api/shared-files', { method: 'POST', body: form });
        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          setError(body.error ?? `Could not upload ${file.name}.`);
          break;
        }
      }
      router.refresh();
    } catch {
      setError('Upload failed. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch('/api/shared-files', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? 'Remove failed.');
        return;
      }
      router.refresh();
    } catch {
      setError('Remove failed. Check your connection and try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        badge="SF"
        title="Shared Files & Docs"
        subtitle={`${files.length} file${files.length === 1 ? '' : 's'} · a shared library, not attached to any document`}
      />

      {error && (
        <Card className="mb-3 border-danger/40 bg-danger/5 p-3">
          <p className="flex items-start gap-2 text-sm text-danger">
            <Icon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        </Card>
      )}

      {canEdit && !isSingleStore && (
        <Card className="mb-3 border-warning/40 bg-warning/10 p-3">
          <p className="text-sm">
            <strong>All Company</strong> is read-only. Select a single store to upload a file.
          </p>
        </Card>
      )}

      {canEdit && isSingleStore && (
        <SectionCard title="Add a file" icon="upload" className="mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Folder" hint="Optional - a single label, not a path" htmlFor="sf-folder" className="w-48">
              <input
                id="sf-folder"
                list="sf-folder-options"
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="General"
                className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <datalist id="sf-folder-options">
                {folders.map((f) => <option key={f} value={f} />)}
              </datalist>
            </Field>
            <label>
              <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-brand px-4 text-sm font-medium text-brand-fg hover:opacity-90">
                <Icon name="upload" className="h-4 w-4" />
                {uploading ? 'Uploading…' : 'Choose files'}
              </span>
              <input
                type="file"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  void upload(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              PDF, image, Excel, Word or CSV - up to 10 MB each.
            </p>
          </div>
        </SectionCard>
      )}

      {folders.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <FolderChip label="All" active={active === 'All'} onClick={() => setActive('All')} />
          {folders.map((f) => (
            <FolderChip key={f} label={f} active={active === f} onClick={() => setActive(f)} />
          ))}
        </div>
      )}

      <SectionCard title={active === 'All' ? 'All files' : active} icon="folder" bodyClassName="p-0">
        {shown.length === 0 ? (
          <EmptyState
            icon="folder"
            title="No files here yet"
            hint={canEdit ? 'Upload one above.' : 'Nothing has been shared to this folder yet.'}
          />
        ) : (
          /* F1b / D17. The folder tabs above narrow by folder; this finds a
             file by its name, its description or who uploaded it, which is how
             anybody actually looks for one. */
          <ListFilter
            exportAs={{ title: 'Shared files', columns: [{ header: 'File', value: (r) => r.fileName }, { header: 'Folder', value: (r) => r.folder }, { header: 'Description', value: (r) => r.description }, { header: 'Size (KB)', value: (r) => Math.round(r.fileSize / 1024) }, { header: 'Uploaded', value: (r) => r.uploadedAt ? r.uploadedAt.slice(0, 10) : '' }, { header: 'By', value: (r) => r.uploadedByName }] }}
            rows={shown}
            // Date filter and sort, newest first (9 Oct 2026).
            dates={[{ key: 'up', label: 'Uploaded on', of: (r) => r.uploadedAt }]}
            sorts={[{ key: 'new', label: 'Newest first', compare: newestFirst((r) => r.uploadedAt) }, { key: 'old', label: 'Oldest first', compare: oldestFirst((r) => r.uploadedAt) }]}
            noun="files"
            placeholder="File name, description, who uploaded it…"
            searchOn={(f) => [f.fileName, f.description, f.uploadedByName, f.folder]}
          >
            {(found) => (found.length === 0 ? (
              <EmptyState icon="search" title="Nothing matches" hint="Clear the search to see every file in this folder." />
            ) : (
          <div className="divide-y divide-border">
            {found.map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Icon name="file-text" className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{f.fileName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {describeSize(f.fileSize)} · {fmtDate(f.uploadedAt)}
                    {f.uploadedByName && ` · ${f.uploadedByName}`}
                    {f.description && ` · ${f.description}`}
                  </p>
                </div>
                {active === 'All' && <Badge tone="neutral">{f.folder}</Badge>}
                {f.url ? (
                  <a
                    href={f.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted/60"
                  >
                    Open
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">Link unavailable</span>
                )}
                {canEdit && (
                  <button
                    type="button"
                    disabled={busyId === f.id}
                    onClick={() => remove(f.id)}
                    className="inline-flex h-8 items-center rounded-md px-2.5 text-xs font-medium text-danger hover:bg-danger/10"
                  >
                    {busyId === f.id ? '…' : 'Remove'}
                  </button>
                )}
              </div>
            ))}
          </div>
            ))}
          </ListFilter>
        )}
      </SectionCard>
    </div>
  );
}

function FolderChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant={active ? 'primary' : 'outline'} onClick={onClick}>
      {label}
    </Button>
  );
}
