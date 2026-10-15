'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';

/**
 * "Back to list" that comes back to the list as it was left - filters,
 * search and page intact (F1b detail-page standard, 6 Oct 2026). List screens
 * remember their address per tab (useListParams); without one this is a plain
 * link to the list.
 */
export function BackLink({ href, title, className, children }: {
  href: string; title?: string; className?: string; children: ReactNode;
}) {
  const [to, setTo] = useState(href);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(`atlas:list:${href}`);
      if (saved && saved.startsWith(href)) setTo(saved);
    } catch { /* storage off: plain link */ }
  }, [href]);
  return <Link href={to} title={title} className={className}>{children}</Link>;
}
