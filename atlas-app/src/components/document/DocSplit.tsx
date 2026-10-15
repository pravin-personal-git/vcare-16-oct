'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { DialogFrame } from '@/components/ui/DialogFrame';

/**
 * Document pages split in two (11 Oct 2026, ops-pages demo tab 3 - approved).
 *
 * Quotation, sales order and invoice pages showed the paper full size in the
 * middle with empty space either side. Now the work sits on the left and a
 * small preview of the real paper on the right, fading out; "Show full
 * document" opens it full size. Printing still prints the whole paper: the
 * preview is the printed copy (it carries `paperId`), and the print rules
 * below undo the shrinking.
 */
export function DocSplit({ left, paper, paperId, title }: {
  left: ReactNode;
  /** The document itself (InvoicePaper, QuotationPaper…), rendered once for print and preview. */
  paper: ReactNode;
  /** The id the page's print CSS shows. */
  paperId: string;
  title: string;
}) {
  const [full, setFull] = useState(false);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-4">{left}</div>
      <div className="min-w-0">
        <div className="rounded border border-border bg-card p-3 xl:sticky xl:top-4 print:border-0 print:p-0">
          <div className="no-print mb-2 flex items-center justify-between">
            <span className="text-micro font-semibold uppercase text-muted-foreground">Document</span>
            <Button size="sm" variant="tint" icon="maximize" onClick={() => setFull(true)}>Show full document</Button>
          </div>
          <button type="button" onClick={() => setFull(true)} aria-label={`Show ${title} full size`}
            className="doc-preview-frame block h-[420px] w-full overflow-hidden rounded-sm bg-muted text-start print:h-auto print:overflow-visible print:bg-transparent">
            {/* inert: the paper's own links are not tab stops inside this button (WCAG audit, 13 Oct 2026) */}
            <div inert className="doc-preview-scale origin-top-left">
              <div id={paperId}>{paper}</div>
            </div>
          </button>
          <p className="no-print mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Icon name="info" className="h-3.5 w-3.5" />Click the preview to read it full size. Print and PDF print the whole document.</p>
        </div>
      </div>
      {full && (
        <DialogFrame label={title} onClose={() => setFull(false)} closeOnBackdrop className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
          <div className="w-full max-w-4xl animate-fade-in rounded-lg bg-card p-4 shadow-overlay">
            <div className="mb-3 flex items-center justify-between gap-2">
              <b className="truncate">{title}</b>
              <div className="flex gap-2">
                <Button size="sm" icon="printer" onClick={() => { setFull(false); setTimeout(() => window.print(), 50); }}>Print</Button>
                <Button size="sm" variant="ghost" icon="x" onClick={() => setFull(false)}>Close</Button>
              </div>
            </div>
            <div className="rounded-sm bg-muted p-2 sm:p-4">{paper}</div>
          </div>
        </DialogFrame>
      )}
    </div>
  );
}

/** A figure tile for the left side of a document page. */
export function DocKpi({ label, value, tone }: { label: string; value: ReactNode; tone?: 'success' | 'danger' | 'warning' }) {
  const c = tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : '';
  return (
    <div className="rounded border border-border bg-card p-4">
      <p className="text-micro font-semibold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-xl font-bold ${c}`}>{value}</p>
    </div>
  );
}

/** A titled panel on the left side. */
export function DocPanel({ title, icon, right, children }: { title: string; icon?: Parameters<typeof Icon>[0]['name']; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="no-print rounded border border-border bg-card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-title font-semibold">{icon && <Icon name={icon} className="h-4 w-4 text-muted-foreground" />}{title}{right && <span className="ms-auto">{right}</span>}</h3>
      {children}
    </section>
  );
}
