import Link from 'next/link';
import { Icon, type IconName } from '@/components/ui/Icon';
import { KIND_LABEL, type TrailKind, type TrailStep } from '@/lib/document-trail';

/**
 * Where this document sits in the life of one sale.
 *
 * A strip across the top of a document showing quotation → order → invoice →
 * payment, with returns and credit notes after it. The step you are looking at
 * is highlighted; the others are links.
 *
 * WHY A STRIP AND NOT A "RELATED DOCUMENTS" PANEL AT THE BOTTOM.
 *
 * The question it answers - *where am I, and what happens next* - is the one
 * somebody has before they read the document, not after. A panel below the
 * totals is found by people who already understand the process, which is the
 * group that did not need it.
 *
 * The greyed final step is the part that does the work: an order with no
 * invoice says "not invoiced yet", an unpaid invoice says "not paid yet". That
 * turns the strip from a record of what happened into an answer to what to do,
 * without changing anything about how documents are actually created.
 */

const ICON: Record<TrailKind, IconName> = {
  quotation: 'file-text',
  order: 'shopping-cart',
  installation: 'home',
  invoice: 'receipt',
  receipt: 'credit-card',
  return: 'arrow-left',
  credit_note: 'file-text',
  // The service half (F1b, D18).
  complaint: 'alert-circle',
  visit: 'map-pin',
  challan: 'paperclip',
  gdn: 'truck',
  replacement: 'refresh',
  pickup: 'package',
  supplier_dispatch: 'truck',
  rma_receipt: 'download',
  // The buying side (F1b, D18).
  purchase_order: 'shopping-cart',
  goods_receipt: 'package',
  bill: 'file-text',
  supplier_payment: 'credit-card',
  purchase_return: 'arrow-left',
};

export function DocumentTrail({ steps }: { steps: TrailStep[] }) {
  // One step is just the document you are already looking at. Drawing a
  // one-item chain says nothing and takes up the space where the document
  // should be.
  if (steps.length < 2) return null;

  return (
    <div className="mb-4 overflow-x-auto rounded-lg border border-border bg-card p-2.5 shadow-card">
      <div className="flex min-w-max items-stretch gap-1.5">
        {steps.map((s, i) => (
          <div key={`${s.kind}-${s.id || i}`} className="flex items-stretch gap-1.5">
            {i > 0 && (
              <span className="flex items-center text-muted-foreground" aria-hidden>
                <Icon name="chevron-right" className="h-3.5 w-3.5" />
              </span>
            )}

            <StepBox step={s} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StepBox({ step }: { step: TrailStep }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5">
        <Icon
          name={ICON[step.kind]}
          className={`h-3.5 w-3.5 shrink-0 ${
            step.current ? 'text-brand' : step.pending ? 'text-muted-foreground' : ''
          }`}
        />
        <span className="text-micro font-medium uppercase tracking-wide text-muted-foreground">
          {KIND_LABEL[step.kind]}
        </span>
      </span>
      <span
        className={`mt-0.5 block text-sm font-semibold ${
          step.pending ? 'text-muted-foreground' : ''
        }`}
      >
        {step.label}
      </span>
      <span
        className={`block text-xs leading-snug ${
          step.detail.includes('reversed')
            ? 'text-muted-foreground line-through'
            : 'text-muted-foreground'
        }`}
      >
        {step.detail}
      </span>
    </>
  );

  const shell = 'flex min-w-[9.5rem] flex-col rounded-md border px-2.5 py-1.5 transition';

  // The current step is not a link. Linking a page to itself is a small lie
  // that costs somebody a click to discover.
  if (step.current) {
    return (
      <span className={`${shell} border-brand bg-brand/[0.07]`} aria-current="step">
        {body}
      </span>
    );
  }

  if (step.pending) {
    return (
      <Link href={step.route} className={`${shell} border-dashed border-border hover:border-brand`}>
        {body}
      </Link>
    );
  }

  return (
    <Link href={step.route} className={`${shell} border-border hover:border-brand hover:bg-muted`}>
      {body}
    </Link>
  );
}
