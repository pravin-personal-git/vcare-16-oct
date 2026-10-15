import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';

/**
 * Stock as one place with three tabs (15 Oct 2026, Pravin: "these 3 pages are
 * confusing me and Vcare a lot").
 *
 * The three pages stay where they are - links, bookmarks and Ctrl+K keep
 * working - but the menu shows one "Stock" entry and every page carries this
 * strip, so they read as one screen:
 *
 *   Quantity  how many, what they are worth, what is running out
 *   Serials   each numbered piece: where it is, who has it
 *   Checks    where the count and the numbered pieces disagree, and expiry
 *
 * Checks carries a count only when something is waiting there, so nobody has
 * to open it to find out whether they need to.
 */
const TABS = [
  { key: 'qty', label: 'Quantity', href: '/reports/product-stock', icon: 'package' },
  { key: 'serials', label: 'Serials', href: '/stock-units', icon: 'scan' },
  { key: 'checks', label: 'Checks', href: '/reports/stock-health', icon: 'alert-triangle' },
] as const;

export type StockTab = (typeof TABS)[number]['key'];

export function StockTabs({ active, checks = 0 }: { active: StockTab; checks?: number }) {
  return (
    <nav aria-label="Stock" className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
      <span className="me-1 text-sm font-semibold">Stock</span>
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              on ? 'border-brand bg-brand text-brand-fg' : 'border-border bg-card text-muted-foreground hover:border-brand hover:text-foreground'
            }`}
          >
            <Icon name={t.icon} className="h-4 w-4" />
            {t.label}
            {t.key === 'checks' && checks > 0 && (
              <span className={`min-w-5 rounded-full px-1.5 text-center text-xs font-semibold ${on ? 'bg-brand-fg text-brand' : 'bg-danger text-white'}`}>
                {checks}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
