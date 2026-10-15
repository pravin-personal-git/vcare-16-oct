'use client';

import Link from 'next/link';
import { Icon } from './Icon';

/**
 * Active / History.
 *
 * A pair of links rather than local state, because which list you are looking
 * at belongs in the URL. With state, a bookmark, a refresh or the back button
 * all silently drop you back into Active - and you lose the closed document you
 * were reading.
 */
export function ViewToggle({
  view,
  basePath,
}: {
  view: 'active' | 'history';
  basePath: string;
}) {
  const opts = [
    { key: 'active' as const, label: 'Active', icon: 'check-circle' as const, href: basePath },
    { key: 'history' as const, label: 'History', icon: 'clock' as const, href: `${basePath}?view=history` },
  ];

  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-full border border-border">
      {opts.map((o) => (
        <Link
          key={o.key}
          href={o.href}
          className={`inline-flex h-9 items-center gap-1.5 px-3.5 text-sm font-medium transition ${
            view === o.key
              ? o.key === 'active'
                ? 'bg-success text-success-fg'
                : 'bg-navy text-navy-fg'
              : 'bg-card text-muted-foreground hover:bg-muted'
          }`}
        >
          <Icon name={o.icon} className="h-3.5 w-3.5" />
          {o.label}
        </Link>
      ))}
    </div>
  );
}
