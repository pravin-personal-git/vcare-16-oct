'use client';

import Link from 'next/link';

/**
 * A supplier's name that opens the supplier (G-37, 10 Oct 2026). Pravin:
 * "any data that has its own page and is displayed anywhere else should be
 * clickable". The supplier page - bills, orders, receipts, payments, balance.
 *
 * A supplier typed in with no record behind it stays plain text: a link
 * that lands on "not found" is worse than no link. Clicks do not bubble, so
 * the name can sit inside a clickable row or card.
 */
export function SupplierLink({ id, children, className = '' }: {
  id: string | null | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  if (!id) return <span className={className}>{children}</span>;
  return (
    <Link
      href={`/suppliers/${id}`}
      onClick={(e) => e.stopPropagation()}
      className={`hover:text-brand hover:underline ${className}`}
    >
      {children}
    </Link>
  );
}
