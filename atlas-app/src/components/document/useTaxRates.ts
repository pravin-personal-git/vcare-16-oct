'use client';

import { useEffect, useState } from 'react';
import { taxChoicesAction } from '@/app/actions/search-options';

/**
 * GST rates for a line's rate dropdown, from the GST Rates master (26 Sep
 * 2026 - it was a hard-coded list). Fetched once per page and shared; shows
 * the standard slabs until the master answers, so the dropdown is never empty.
 */
let cached: Promise<number[]> | null = null;
const STANDARD = [0, 5, 12, 18, 28];

export function useTaxRates(): number[] {
  const [rates, setRates] = useState<number[]>(STANDARD);
  useEffect(() => {
    cached ??= taxChoicesAction().then((c) => c.rates).catch(() => STANDARD);
    let live = true;
    cached.then((r) => { if (live) setRates(r); });
    return () => { live = false; };
  }, []);
  return rates;
}

/** The master's rates plus the line's own, so an old document never loses its rate. */
export const rateOptions = (rates: number[], current: number) =>
  [...new Set([...rates, current])].sort((a, b) => a - b);
