import type { QuickAction } from '@/components/ui/DataGrid';
import { whatsappLink } from './revenue';

/**
 * WhatsApp / Call for a row with a mobile number (UI refresh, 4 Oct 2026).
 * Nothing for a number too short to dial - a button that opens "not on
 * WhatsApp" teaches people the buttons do not work.
 *
 * Indian 10-digit numbers get +91, the same rule as `whatsappLink`.
 *
 * There was a third button here, "Text message", pointing at `sms:`. Windows
 * has no SMS handler, so on every office desktop Chrome answered it with
 * "Open Pick an app?" and nothing was ever sent. Removed 4 Oct 2026. If SMS
 * comes back it has to go through the messaging channel, not a device link.
 */
export function contactActions(phone: string | null | undefined, whatsappText = ''): QuickAction[] {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return [];
  const intl = digits.length === 10 ? `91${digits}` : digits;
  return [
    { label: 'WhatsApp', icon: 'whatsapp', href: whatsappLink(digits, whatsappText), tone: 'whatsapp' },
    { label: 'Call', icon: 'phone', href: `tel:+${intl}`, tone: 'call' },
  ];
}
