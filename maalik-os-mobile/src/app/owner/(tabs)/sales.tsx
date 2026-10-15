import { ScrollView, View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { PrefSwitches, Screen, Text } from '@/components/ui';
import { OfflineBar } from '@/components/OfflineBar';
import { MenuList } from '@/components/MenuList';
import { space } from '@/theme/tokens';

/**
 * SALES tab (13 Oct 2026). Leads, quotations (part 2), orders and invoices
 * with payments (part 3) are native and work offline; receipts on account and
 * customers open on the website until part 4.
 */
export default function SalesTab() {
  const { t } = useT();
  return (
    <Screen edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md }}>
        <Text variant="h2" weight="bold" style={{ flex: 1 }}>{t('Sales')}</Text>
        <PrefSwitches />
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.md, paddingBottom: space.xxxl }}>
        <OfflineBar />
        <MenuList items={[
          { icon: 'box', label: t('Shop requests'), line: t('What customers asked for in the online shop'), href: '/sales/shop-requests' },
          { icon: 'trending', label: t('Leads'), line: t('Follow-ups and new leads'), href: '/employee/leads' },
          { icon: 'plus', label: t('New lead'), href: '/employee/lead-new' },
          { icon: 'file', label: t('Quotations'), line: t('Make, share, turn into an order - works offline'), href: '/sales/quotations' },
          { icon: 'plus', label: t('New quotation'), href: '/sales/quotation-new' },
        ]} />
        <MenuList items={[
          { icon: 'box', label: t('Sales orders'), line: t('Make the invoice from an order'), href: '/sales/orders' },
          { icon: 'file', label: t('Invoices'), line: t('Payments, WhatsApp, PDF - works offline'), href: '/sales/invoices' },
          { icon: 'plus', label: t('New invoice'), line: t('A sale on the spot, signal or not'), href: '/sales/invoice-new' },
        ]} />
        <MenuList items={[
          { icon: 'send', label: t('Receipts'), line: t('Payments not against one invoice'), web: '/receipts' },
          { icon: 'user', label: t('Customers'), href: '/customers' },
        ]} />
      </ScrollView>
    </Screen>
  );
}
