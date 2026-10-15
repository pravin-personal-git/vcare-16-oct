'use client';

import type { ReactNode } from 'react';
import { PageHeader, Badge, type BadgeTone } from '@/components/ui/Layout';
import { Icon, type IconName } from '@/components/ui/Icon';
import { BackLink } from '@/components/ui/BackLink';

/**
 * The one head every detail page wears (F1b detail-page standard, F1-SPEC
 * §3.2, 6 Oct 2026): what the record is and its number, its status, the three
 * to five facts somebody opens it for, the actions on the right, and a Back
 * that returns to the list as it was left (filters intact, BackLink).
 *
 * Built on PageHeader so it looks exactly like every list screen's heading -
 * the same badge, size and spacing - instead of each detail page drawing its
 * own. Hidden when printing; the document below carries its own heading.
 */
export interface DetailFact { label: string; value: ReactNode }

export function DetailHeader({
  icon, kind, number, status, facts = [], actions, backHref, backLabel = 'Back to list',
}: {
  icon: IconName;
  /** What the record is: "Credit note", "Repair challan". */
  kind: string;
  /** Its number or name. */
  number: string;
  status?: { label: string; tone: BadgeTone };
  facts?: DetailFact[];
  actions?: ReactNode;
  /** The list this record belongs to. */
  backHref: string;
  backLabel?: string;
}) {
  const shown = facts.filter((f) => f.value !== null && f.value !== undefined && f.value !== '');
  return (
    <div className="no-print print:hidden">
      <PageHeader
        badge={icon}
        title={`${kind} ${number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {status && <Badge tone={status.tone}>{status.label}</Badge>}
            {shown.map((f) => (
              <span key={f.label} className="whitespace-nowrap">
                <span className="text-muted-foreground">{f.label}:</span>{' '}
                <span className="font-medium text-foreground">{f.value}</span>
              </span>
            ))}
          </span>
        }
        actions={
          <>
            {actions}
            <BackLink
              href={backHref}
              title={backLabel}
              className="grid h-9 w-9 place-items-center rounded bg-navy text-navy-fg shadow-card transition hover:bg-navy-hover"
            >
              <Icon name="arrow-left" className="h-4 w-4" />
            </BackLink>
          </>
        }
      />
    </div>
  );
}
