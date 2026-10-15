import type { FulfilmentStatus } from './sales-order-status';

/**
 * What counts as a sale.
 *
 * This list was written out by hand in six places across five files -
 * dashboard, sales targets, invoices, the order list and the order server. Add
 * a "returned" or "refunded" state later and you would have to find all six,
 * and the one you miss makes two reports disagree about revenue without either
 * looking wrong on its own.
 *
 * One list, one predicate, one place to change it.
 */
export const NON_REVENUE_FULFILMENT: FulfilmentStatus[] = ['void', 'failed'];

/** Prisma `where` fragment: only orders that represent a real sale. */
export const REVENUE_ORDER_WHERE = {
  fulfilmentStatus: { notIn: NON_REVENUE_FULFILMENT },
} as const;

/** In-memory version, for filtering rows already loaded. */
export function countsAsRevenue(status: string): boolean {
  return !(NON_REVENUE_FULFILMENT as string[]).includes(status);
}

/**
 * A wa.me link for an Indian mobile - or, with no number, for any chat.
 *
 * The country-code rule was repeated in three list screens. Getting it wrong is
 * silent - WhatsApp simply opens on "number not on WhatsApp" and the
 * salesperson assumes the customer is not reachable.
 *
 * A bare 10-digit number is Indian and needs 91 in front. Anything longer is
 * assumed to carry its own country code already.
 */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  const to = digits.length === 10 ? `91${digits}` : digits;
  // No number: WhatsApp opens with the text and lets the person pick the chat.
  // The ONE place a wa.me link is built (guard test wa-message.test.ts).
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

/**
 * What is wrong with a number somebody typed into a WhatsApp field, or null
 * if it will work. Checked where the number is SAVED, not where it is used -
 * a bad number stored today is a message that silently never arrives weeks
 * later, when nobody connects the two.
 *
 * Deliberately permissive about country codes (`whatsappLink` assumes a bare
 * 10-digit number is Indian and leaves longer ones alone), strict about the
 * one mistake that actually happens: a short or mistyped Indian mobile.
 */
export function whatsappNumberProblem(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) {
    return /^[6-9]/.test(digits) ? null : 'An Indian mobile number starts with 6, 7, 8 or 9.';
  }
  if (digits.length < 10) return 'That number is too short - 10 digits, or with the country code.';
  if (digits.length > 15) return 'That number is too long to be a phone number.';
  return null;
}

/**
 * Up to two initials for an avatar.
 *
 * Four copies of this existed and they did not agree - two took the first two
 * words, one took the last two. The same person showed different initials on
 * different screens, which quietly undermines the idea that they are the same
 * person.
 *
 * First and last word: "Rajesh Kumar Sharma" gives RS, which is what a person
 * would write.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
