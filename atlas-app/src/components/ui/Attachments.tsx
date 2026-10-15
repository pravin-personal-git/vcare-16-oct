'use client';

import { useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { Button } from './Button';
import { EmptyState } from './Layout';

export interface AttachmentView {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /**
   * A short-lived signed link, or null when the object has gone missing from
   * storage. Null is rendered as an un-clickable name rather than hidden - a
   * row you can see and cannot open tells you something is wrong; a row that
   * silently disappears does not.
   */
  url: string | null;
  label: string | null;
  uploadedAt: string | Date;
  uploadedByName: string | null;
  /** 11 Oct 2026 - set on saved files (lib/attachment-tags); absent on files not yet saved. */
  tag?: string | null;
  visibleToCustomer?: boolean;
  extracted?: { summary?: string; match?: boolean | null } | null;
  olderVersions?: number;
}

/**
 * Files hung off a sales document.
 *
 * Used on quotations, orders and invoices, and inside the create forms before
 * the document exists - in that case the parent holds the files in memory and
 * saves them once the document has an id.
 */

const ICON_FOR: { match: (m: string) => boolean; icon: IconName; tone: string }[] = [
  { match: (m) => m === 'application/pdf', icon: 'file-text', tone: 'text-danger' },
  { match: (m) => m.startsWith('image/'), icon: 'image', tone: 'text-brand' },
  { match: (m) => m.includes('spreadsheet') || m === 'text/csv', icon: 'grid', tone: 'text-success' },
  { match: (m) => m.includes('word'), icon: 'file-text', tone: 'text-navy' },
];

function iconFor(mime: string) {
  return ICON_FOR.find((e) => e.match(mime)) ?? { icon: 'paperclip' as const, tone: 'text-muted-foreground' };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.docx,.csv,application/pdf,image/jpeg,image/png,image/webp';

export function Attachments({
  files,
  onAdd,
  onRemove,
  readOnly = false,
  title = 'Attachments',
  hint = 'Signed copy, customer PO, site photo - anything that explains why this document says what it says.',
  compact = false,
}: {
  files: AttachmentView[];
  onAdd?: (files: File[]) => void | Promise<void>;
  onRemove?: (id: string) => void | Promise<void>;
  readOnly?: boolean;
  title?: string;
  hint?: string;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const take = async (list: FileList | null) => {
    if (!list || list.length === 0 || !onAdd) return;
    setBusy(true);
    try {
      await onAdd(Array.from(list));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Icon name="paperclip" className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-semibold">{title}</h3>
        {files.length > 0 && (
          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-semibold text-on-tint-brand">
            {files.length}
          </span>
        )}
        {!readOnly && (
          <Button
            size="sm"
            variant="outline"
            icon="upload"
            className="ms-auto"
            loading={busy}
            onClick={() => input.current?.click()}
          >
            Add file
          </Button>
        )}
      </div>

      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => take(e.target.files)}
      />

      {files.length === 0 ? (
        readOnly ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            No files attached.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files); }}
            className={`w-full rounded-lg border border-dashed px-3 py-5 text-center transition ${
              dragging ? 'border-brand bg-brand/[0.06]' : 'border-border hover:border-brand/50 hover:bg-muted/50'
            }`}
          >
            <Icon name="upload" className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-1.5 text-xs font-medium">Drop files here, or click to choose</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              PDF, image, Excel, Word or CSV - up to 10 MB each
            </p>
          </button>
        )
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {files.map((f) => {
            const { icon, tone } = iconFor(f.mimeType);
            return (
              <li key={f.id} className="flex items-center gap-3 bg-card px-3 py-2">
                <Icon name={icon} className={`h-4 w-4 shrink-0 ${tone}`} />
                <div className="min-w-0 flex-1">
                  {f.url ? (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-sm font-medium hover:text-brand hover:underline"
                    >
                      {f.fileName}
                    </a>
                  ) : (
                    <p
                      title="This file is no longer in storage."
                      className="block truncate text-sm font-medium text-muted-foreground line-through"
                    >
                      {f.fileName}
                    </p>
                  )}
                  {!compact && (
                    <p className="truncate text-xs text-muted-foreground">
                      {formatSize(f.fileSize)}
                      {f.label && ` · ${f.label}`}
                      {f.uploadedByName && ` · ${f.uploadedByName}`}
                    </p>
                  )}
                </div>
                {f.url && (
                  <a
                    href={f.url}
                    download={f.fileName}
                    title="Download"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    <Icon name="download" className="h-3.5 w-3.5" />
                  </a>
                )}
                {!readOnly && onRemove && (
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => onRemove(f.id)}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted-foreground transition hover:bg-danger/10 hover:text-danger"
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && files.length > 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** The paperclip that appears in a list row when a document carries files. */
export function AttachmentBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span
      title={`${count} file${count === 1 ? '' : 's'} attached`}
      className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground"
    >
      <Icon name="paperclip" className="h-3 w-3" />
      {count}
    </span>
  );
}

export { EmptyState };
