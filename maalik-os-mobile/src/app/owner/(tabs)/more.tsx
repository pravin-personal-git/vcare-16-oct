import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { Button, PrefSwitches, Screen, Text } from '@/components/ui';
import { OfflineBar } from '@/components/OfflineBar';
import { MenuList } from '@/components/MenuList';
import { confirmSignOut } from '@/lib/signout';
import { space } from '@/theme/tokens';

/**
 * MORE tab (13 Oct 2026): everything else - the native screens that already
 * exist (approvals, reminders, stock, requests, waiting to send) and the
 * website for the rest, settings included (decision N3).
 */
export default function MoreTab() {
  const { t } = useT();
  return (
    <Screen edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md }}>
        <Text variant="h2" weight="bold" style={{ flex: 1 }}>{t('More')}</Text>
        <PrefSwitches />
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.md, paddingBottom: space.xxxl }}>
        <OfflineBar />
        <MenuList items={[
          { icon: 'check', label: t('Approvals'), line: t('Approve or reject what waits on you'), href: '/employee/approvals' },
          { icon: 'bell', label: t('Reminders'), line: t('Rings full screen, like an alarm clock'), href: '/reminders' },
          { icon: 'calendar', label: t('Team today'), line: t('On shift, not marked, on leave'), href: '/people/today' },
          { icon: 'user', label: t('Customers'), line: t('What they owe, documents, jobs, items'), href: '/customers' },
          { icon: 'box', label: t('Stock on hand'), line: t('Out of stock, reorder now'), href: '/stock/on-hand' },
          { icon: 'scan', label: t('Stock'), line: t('Scan, look up, receive'), href: '/employee/stock' },
          { icon: 'send', label: t('My requests'), line: t('Leave, work from home, claims'), href: '/employee/requests' },
          { icon: 'refresh', label: t('Waiting to send'), href: '/outbox' },
        ]} />
        <MenuList items={[
          { icon: 'briefcase', label: t('Staff and leave'), web: '/hrm' },
          { icon: 'trending', label: t('Reports'), web: '/reports/downloads' },
          { icon: 'info', label: t('Settings'), web: '/settings/hub' },
        ]} />
        <Button label={t('Open the full website')} icon="globe" variant="secondary" onPress={() => router.push('/owner/web')} />
        <Button label={t('Sign out')} icon="logout" variant="ghost" onPress={() => { void confirmSignOut(t); }} />
      </ScrollView>
    </Screen>
  );
}
