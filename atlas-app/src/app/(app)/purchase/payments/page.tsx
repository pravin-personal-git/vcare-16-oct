import { redirect } from 'next/navigation';

/** Supplier payments are listed on Payables; a payment's own page is /purchase/payments/[id]. */
export default function PaymentsIndex() {
  redirect('/purchase/payables');
}
