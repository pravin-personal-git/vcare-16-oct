'use client';

import Link from 'next/link';

/**
 * A product's name that opens its history (G-36, 10 Oct 2026) - stock, every
 * document it moved on, its serial units. A line typed in by hand, with no
 * product behind it, stays plain text. Clicks do not bubble, so the name can
 * sit inside a clickable row.
 */
export function ProductLink({ id, children, className = '' }: {
  id: string | null | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  if (!id) return <span className={className}>{children}</span>;
  return (
    <Link
      href={`/product-journey?product=${id}`}
      onClick={(e) => e.stopPropagation()}
      className={`hover:text-brand hover:underline ${className}`}
    >
      {children}
    </Link>
  );
}
