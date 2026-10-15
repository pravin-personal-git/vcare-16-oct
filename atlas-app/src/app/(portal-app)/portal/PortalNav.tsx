'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The portal's tabs, with the current one marked (3 Oct 2026). The old nav had
 * no current tab at all, so a customer could not tell where they were.
 */
export function PortalNav({ showShop, compact }: { showShop: boolean; compact?: boolean }) {
  const path = usePathname();
  const tabs: [string, string][] = [
    ['/portal', 'Home'],
    ...(showShop ? [['/portal/shop', 'Shop'] as [string, string]] : []),
    ['/portal/purchases', 'My Purchases'],
    ['/portal/complaints', 'My Complaints'],
  ];
  const on = (href: string) => (href === '/portal' ? path === '/portal' : path.startsWith(href));
  return (
    <>
      {tabs.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={on(href) ? 'page' : undefined}
          className={`whitespace-nowrap rounded-lg px-3 py-1.5 font-semibold transition ${compact ? 'text-xs' : 'text-sm'} ${
            on(href) ? 'bg-navy/10 text-on-tint-navy' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          {label}
        </Link>
      ))}
    </>
  );
}
