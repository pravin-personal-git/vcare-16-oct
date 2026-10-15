import { Pressable, ScrollView, View } from 'react-native';
import { confirmSignOut } from '@/lib/signout';
import { router } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { PrefSwitches, Screen, Text } from '@/components/ui';
import { AttendanceCard } from '@/components/AttendanceCard';
import { MyWorkCard } from '@/components/MyWorkCard';
import { Icon, type IconName } from '@/components/Icon';
import { SimpleNav } from '@/components/SimpleNav';
import { OfflineBar } from '@/components/OfflineBar';
import { useLayout } from '@/lib/layout';
import { radius, space } from '@/theme/tokens';

/**
 * ME - the simple field-worker app's third tab (13 Oct 2026): clock in and
 * out, this month's work, reminders, leave / claims, language and text, and
 * sign out. Everything a technician needs about themselves, in one place.
 */
export default function Me() {
  const { t } = useT();
  const { c } = useTheme();
  const { access } = useLayout();
  const link = (icon: IconName, label: string, line: string, href: '/reminders' | '/employee/requests' | '/business/setup') => (
    <Pressable key={href} accessibilityRole="button" onPress={() => router.push(href)}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.brandSoft : c.surface })}>
      <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} color={c.brand} />
      </View>
      <View style={{ flex: 1 }}>
        <Text weight="semibold">{label}</Text>
        <Text variant="small" color={c.inkSoft}>{line}</Text>
      </View>
      <Icon name="arrowRight" size={20} color={c.muted} />
    </Pressable>
  );
  return (
    <Screen edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md }}>
        <Text variant="h2" weight="bold" style={{ flex: 1 }}>{t('Me')}</Text>
        <PrefSwitches />
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 0, gap: space.md, paddingBottom: space.xxxl }}>
        <OfflineBar />
        {access.sections.attendance && access.tracking.clockIn && (
          <AttendanceCard trackLocation={access.tracking.location} requireSelfie={access.tracking.selfie} />
        )}
        <MyWorkCard />
        {link('bell', t('Reminders'), t('Rings full screen, like an alarm clock'), '/reminders')}
        {link('send', t('My requests'), t('Leave, work from home, claims'), '/employee/requests')}
        {link('info', t('Phone setup'), t('Location, battery and permissions'), '/business/setup')}
        <Pressable accessibilityRole="button" onPress={() => { void confirmSignOut(t); }}
          style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, marginTop: space.md }}>
          <Icon name="logout" size={18} color={c.danger} />
          <Text weight="semibold" color={c.danger}>{t('Sign out')}</Text>
        </Pressable>
      </ScrollView>
      <SimpleNav current="me" schedule={access.layout.schedule} />
    </Screen>
  );
}
