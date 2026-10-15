'use client';

import { useState } from 'react';
import { Attachments, formatSize, type AttachmentView } from '@/components/ui/Attachments';
import { Icon } from '@/components/ui/Icon';

/**
 * Attaching files to a document that does not exist yet.
 *
 * A create form has no id to hang a file off, so the files are held in memory
 * and uploaded once the document has been saved and has one.
 *
 * The alternative - uploading to a temporary location and moving the files
 * afterwards - means every abandoned form leaves orphaned bytes in storage that
 * nobody ever cleans up. Holding them in the browser costs nothing and cleans
 * itself up when the tab closes.
 *
 * The honest cost: if the save succeeds and an upload then fails, you get a
 * saved document with a missing file. `uploadPending` returns which ones failed
 * so the form can say so plainly rather than pretending everything landed.
 */

export function usePendingFiles() {
  const [files, setFiles] = useState<File[]>([]);

  const add = (chosen: File[]) => setFiles((f) => [...f, ...chosen]);
  const remove = (id: string) =>
    setFiles((f) => f.filter((x) => `${x.name}-${x.size}-${x.lastModified}` !== id));

  /** Shown in the list before anything has been uploaded. */
  const asViews = (): AttachmentView[] =>
    files.map((f) => ({
      id: `${f.name}-${f.size}-${f.lastModified}`,
      fileName: f.name,
      fileSize: f.size,
      mimeType: f.type,
      url: null,
      label: 'Will upload when you save',
      uploadedAt: new Date(),
      uploadedByName: null,
    }));

  /** Called after the document is saved. Returns the ones that did not make it. */
  const uploadPending = async (
    docType: 'quotation' | 'sales_order' | 'invoice',
    docId: string,
  ): Promise<string[]> => {
    const failed: string[] = [];
    for (const file of files) {
      const body = new FormData();
      body.set('docType', docType);
      body.set('docId', docId);
      body.set('file', file);
      try {
        const res = await fetch('/api/attachments', { method: 'POST', body });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          failed.push(`${file.name}: ${j.error ?? res.statusText}`);
        }
      } catch {
        failed.push(`${file.name}: the upload did not complete.`);
      }
    }
    return failed;
  };

  return { files, add, remove, asViews, uploadPending, count: files.length };
}

export function PendingAttachments({
  pending,
}: {
  pending: ReturnType<typeof usePendingFiles>;
}) {
  return (
    <div>
      <Attachments
        files={pending.asViews()}
        onAdd={(chosen) => pending.add(chosen)}
        onRemove={(id) => pending.remove(id)}
        title="Attachments"
        compact
      />
      {pending.count > 0 && (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-brand/[0.08] px-3 py-2 text-xs text-on-tint-brand">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {pending.count} file{pending.count === 1 ? '' : 's'} ready
          {' ('}
          {formatSize(pending.files.reduce((n, f) => n + f.size, 0))}
          {'). '}
          They upload once you save - nothing is stored until the document
          exists to attach them to.
        </p>
      )}
    </div>
  );
}
