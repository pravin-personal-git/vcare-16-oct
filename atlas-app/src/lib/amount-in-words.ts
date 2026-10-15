/**
 * Amount in words, Indian convention.
 *
 * Every printed Indian financial document carries the total spelled out, and it
 * uses the Indian grouping - lakh and crore - not the international one. A
 * library that renders "two million" on an invoice is worse than no library.
 *
 * Paise are spelled too when they are not zero, because "and fifty paise only"
 * is what a bank cashier expects to read.
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

/** 0–99. */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

/** 0–999. */
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h === 0) return twoDigits(rest);
  const head = `${ONES[h]} Hundred`;
  return rest ? `${head} ${twoDigits(rest)}` : head;
}

/**
 * Indian grouping: crore, lakh, thousand, then the last three digits.
 * 1,23,45,678 reads as "One Crore Twenty Three Lakh Forty Five Thousand Six
 * Hundred Seventy Eight".
 */
export function rupeesInWords(rupees: number): string {
  const n = Math.floor(Math.abs(rupees));
  if (n === 0) return 'Zero';

  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));

  return parts.join(' ');
}

/**
 * Full line for a document footer.
 * @param paise integer paise - money is never a float in this codebase
 */
export function amountInWords(paise: number, currency = 'Indian Rupee'): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const remainder = abs % 100;

  const head = `${currency} ${rupeesInWords(rupees)}`;
  const tail = remainder > 0 ? ` and ${twoDigits(remainder)} Paise` : '';

  return `${negative ? 'Minus ' : ''}${head}${tail} Only`;
}
