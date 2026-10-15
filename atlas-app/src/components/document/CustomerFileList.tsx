import { Icon } from '@/components/ui/Icon';

/**
 * Files the business marked "Customer sees it" (G5, 11 Oct 2026), on the
 * no-login invoice / quotation links and in the portal. Plain links - no
 * client hooks - so a server page and a client list can both render it.
 */
export function CustomerFileList({ files, title = 'Files' }: {
  files: { id: string; fileName: string; tag: string | null; url: string | null }[];
  title?: string;
}) {
  if (files.length === 0) return null;
  return (
    <section className="no-print rounded-lg border border-border bg-card p-3">
      <p className="mb-2 text-micro font-semibold uppercase text-muted-foreground">{title}</p>
      <ul className="grid gap-1.5">
        {files.map((f) => (
          <li key={f.id} className="flex min-w-0 items-center gap-2 text-sm">
            <Icon name="paperclip" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {f.url
              ? <a href={f.url} target="_blank" rel="noreferrer" className="truncate text-brand hover:underline">{f.fileName}</a>
              : <span className="truncate text-muted-foreground">{f.fileName}</span>}
            {f.tag && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-cap text-muted-foreground">{f.tag}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
