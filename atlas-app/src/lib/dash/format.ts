/**
 * Number formatting for the dashboards - lakh / crore, the way the demo reads.
 * Pure, so the server can write a card's sub-line and the browser its axis
 * with the same words.
 */

/** ₹ 1,26,300 */
export function inrFull(v: number): string {
  const neg = v < 0; const n = Math.abs(Math.round(v));
  const s = String(n); const last3 = s.slice(-3); const rest = s.slice(0, -3);
  const out = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${neg ? '−' : ''}₹ ${out}`;
}

/** ₹ 47.51 L, ₹ 2.30 Cr, ₹ 84.5 K */
export function inrC(v: number): string {
  const neg = v < 0; const a = Math.abs(v);
  let t: string;
  if (a >= 1e7) t = `₹ ${(a / 1e7).toFixed(2)} Cr`;
  else if (a >= 1e5) t = `₹ ${(a / 1e5).toFixed(2)} L`;
  else if (a >= 1e3) t = `₹ ${(a / 1e3).toFixed(1)} K`;
  else t = `₹ ${Math.round(a)}`;
  return `${neg ? '−' : ''}${t}`;
}

export const num = (v: number) => Math.round(v).toLocaleString('en-IN');
export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
