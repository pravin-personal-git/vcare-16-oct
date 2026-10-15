/**
 * Indian formatting conventions.
 * Values render as "₹ 47.51 L", not "₹ 4,751,000". Intl defaults are wrong here.
 * Spec: 03-technical-docs/01-specification/00-architecture.md §4
 */

const LAKH = 100_000;
const CRORE = 10_000_000;

/** Compact Indian currency - ₹ 47.51 L, ₹ 1.20 Cr, ₹ 8,180 */
export function formatCurrencyCompact(paise: number, symbol = '₹'): string {
  const rupees = paise / 100;
  const abs = Math.abs(rupees);
  if (abs >= CRORE) return `${symbol} ${(rupees / CRORE).toFixed(2)} Cr`;
  if (abs >= LAKH) return `${symbol} ${(rupees / LAKH).toFixed(2)} L`;
  return `${symbol} ${formatIndianGrouping(rupees)}`;
}

/** Full precision with Indian digit grouping - ₹ 12,34,567.00 */
export function formatCurrency(paise: number, symbol = '₹'): string {
  return `${symbol} ${formatIndianGrouping(paise / 100, 2)}`;
}

/** 2-3-3 grouping: 1234567 -> 12,34,567 */
export function formatIndianGrouping(value: number, decimals = 0): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const grouped = rest
    ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`
    : last3;
  const sign = value < 0 ? '-' : '';
  return decPart ? `${sign}${grouped}.${decPart}` : `${sign}${grouped}`;
}

/** Money is stored as integer paise. Never use floats for currency. */
export const toPaise = (rupees: number): number => Math.round(rupees * 100);
export const toRupees = (paise: number): number => paise / 100;
