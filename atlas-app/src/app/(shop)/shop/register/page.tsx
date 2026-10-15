import { redirect } from 'next/navigation';

/**
 * Registration moved under each business's shop on 3 Oct 2026
 * (/shop/<name>/register), so an account is made in the right business. A link
 * to the old address goes to /shop, which finds the business when there is
 * only one and otherwise asks for the shop's own link.
 */
export default function OldRegisterPage() {
  redirect('/shop');
}
