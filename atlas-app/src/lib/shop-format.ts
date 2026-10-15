/**
 * How the shop writes prices and promises (3 Oct 2026). Pure, so the public
 * shop, the portal's server-rendered home and the tests all say it the same way.
 */
import type { ShopItem } from '@/server/catalogue';

/** "₹2,150", or "₹22.50" when there are paise. A shop price is read, not audited. */
export function rupees(paise: number): string {
  const r = paise / 100;
  return `₹${r.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** "2 DAYS" -> "2 days". Client-typed notes arrive in every case there is. */
function sentence(s: string): string {
  const t = s.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** When it is usually ready, in words, or null when nobody has said. */
export function readyText(i: Pick<ShopItem, 'readyDays' | 'deliveryNote'>): string | null {
  if (i.readyDays && i.readyDays > 0) return `Usually ready in ${i.readyDays} day${i.readyDays === 1 ? '' : 's'}`;
  if (i.deliveryNote?.trim()) return `Delivery: ${sentence(i.deliveryNote)}`;
  return null;
}

export function warrantyText(months: number | null): string | null {
  if (!months) return null;
  if (months % 12 === 0) return `${months / 12} year${months === 12 ? '' : 's'} warranty`;
  return `${months} months warranty`;
}
