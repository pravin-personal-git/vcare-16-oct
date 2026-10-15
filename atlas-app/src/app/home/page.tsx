import type { Metadata } from 'next';
import { LandingClient } from './LandingClient';

/**
 * The public business landing page (5 Oct 2026, Pravin: "a business landing
 * page discussing our platform module by module, in English and Hindi, in
 * simple terms with examples, small clickable demos, and it should collect
 * leads"). Lives at /home; the root still goes to sign-in, because on a
 * client's own deployment "/" belongs to that client's staff.
 *
 * Enquiries land in N.A.I.R.'s own Leads (server/landing-leads), never in a
 * client's.
 */
export const metadata: Metadata = {
  title: 'Vcare - one system for sales, stock, service, staff and accounts',
  description: 'Vcare by N.A.I.R. Solutions runs an Indian small business in one place: quotations with GST, stock with barcodes, service jobs with OTP close, staff attendance and payroll, accounts and an online shop - on the web and on the phone.',
};

export default function HomeLandingPage() {
  return <LandingClient whatsapp={process.env.NEXT_PUBLIC_SALES_WHATSAPP ?? null} />;
}
