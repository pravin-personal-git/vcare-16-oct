'use client';

import Link from 'next/link';

/**
 * A customer's name that opens the customer (G-35, 10 Oct 2026). Pravin:
 * "any data that has its own page and is displayed anywhere else should be
 * clickable". The customer page - ledger, sites, AMC, history - is the place.
 *
 * A walk-in or a name with no record behind it stays plain text: a link
 * that lands on "not found" is worse than no link. Clicks do not bubble, so
 * the name can sit inside a clickable row or card.
 */
export function CustomerLink({ id, children, className = '', via }: {
  id: string | null | undefined;
  /**
   * G-39: the document this link sits on, as `<kind>:<id>` (invoice, quotation,
   * order, receipt, credit, return, complaint, amc, challan). The customer page
   * then says where you came from and highlights it and what it links to.
   */
  via?: string;
  children: React.ReactNode;
  className?: string;
}) {
  if (!id) return <span className={className}>{children}</span>;
  return (
    <Link
      href={via ? `/customers/${id}?via=${encodeURIComponent(via)}` : `/customers/${id}`}
      onClick={(e) => e.stopPropagation()}
      className={`hover:text-brand hover:underline ${className}`}
    >
      {children}
    </Link>
  );
}
