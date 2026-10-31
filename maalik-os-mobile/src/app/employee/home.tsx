import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { allGood, readPermissionState } from '@/lib/permissions';
import { loadDevice } from '@/lib/device';
import { refreshMe } from '@/lib/api';
import { OPEN_ACCESS, type AppAccess } from '@/lib/access';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { HomeFrame } from '@/components/HomeFrame';
import { TopTabs } from '@/components/TopTabs';
import { UpdateBanner } from '@/components/UpdateBanner';
import { AttendanceCard } from '@/components/AttendanceCard';
import { MyWorkCard } from '@/components/MyWorkCard';
import { Card, Text } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';
import { radius, space } from '@/theme/tokens';
import { markHomeReady, takePendingJob } from '@/lib/push';

/**
 * The employee home: clock in/out first, then the job sections (week 3),
 * shown by permission rather than by job title.
 */
export default function EmployeeHome() {
  const { c } = useTheme();
  const { t } = useT();
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [perms, setPerms] = useState<Set<string> | null>(null);
  const [access, setAccess] = useState<AppAccess>(OPEN_ACCESS);

  // A job notification tapped while the app was closed: open that job now.
  useEffect(() => {
    markHomeReady();
    const id = takePendingJob();
    if (id) router.push({ pathname: '/employee/complaint/[id]', params: { id } });
  }, []);

  useEffect(() => {
    Promise.all([loadDevice(), readPermissionState()])
      .then(([d, p]) => setSetupNeeded(!!d && !allGood(p)))
      .catch(() => undefined);
    // What this person may do is decided on the website; re-read it on every open.
    refreshMe().then((s) => {
      setPerms(new Set(s?.permissions ?? []));
      if (s?.kind === 'user' && s.app) setAccess(s.app);
      // The owner may have switched this person to the full website since last time.
      if (s?.kind === 'user' && s.home === 'owner') router.replace('/owner/home');
      // ...or to the simple field-worker layout (13 Oct 2026).
      else if (s?.kind === 'user' && s.app?.layout?.preset === 'simple') router.replace('/employee/work');
    }).catch(() => setPerms(new Set()));
  }, []);

  const has = (...keys: string[]) => !!perms && keys.some((k) => perms.has(k));
  const tiles: { icon: IconName; label: string; line: string; href: '/employee/myjobs' | '/employee/stock' | '/employee/leads' | '/employee/tasks' | '/employee/requests' | '/employee/approvals' | '/reminders' }[] = [
    ...(access.sections.complaints && has('complaints.view', 'complaints.edit') ? [{ icon: 'wrench' as const, label: t('My jobs'), line: t('Complaints and installations'), href: '/employee/myjobs' as const }] : []),
    ...(access.sections.stock && has('stock.view', 'purchase.view', 'purchase.edit') ? [{ icon: 'box' as const, label: t('Stock'), line: t('Scan, look up, receive'), href: '/employee/stock' as const }] : []),
    ...(access.sections.leads && has('leads.view', 'leads.edit', 'leads.create') ? [{ icon: 'trending' as const, label: t('Leads'), line: t('Follow-ups and new leads'), href: '/employee/leads' as const }] : []),
    // Everyone can be given a task, so everyone gets the tile - unless the owner switched it off.
    ...(access.sections.tasks ? [{ icon: 'check' as const, label: t('Tasks'), line: t('Work assigned to you'), href: '/employee/tasks' as const }] : []),
    // Everyone can ask for leave or a claim (27 Sep 2026, My Desk).
    { icon: 'send' as const, label: t('My requests'), line: t('Leave, work from home, claims'), href: '/employee/requests' as const },
    // Anyone can be an approver (a manager for leave, a role for orders); the
    // screen shows "nothing waiting" to everyone else (5 Oct 2026).
    { icon: 'check' as const, label: t('Approvals'), line: t('Approve or reject what waits on you'), href: '/employee/approvals' as const },
    // Alarm-style reminders (13 Oct 2026) - everyone.
    { icon: 'bell' as const, label: t('Reminders'), line: t('Rings full screen, like an alarm clock'), href: '/reminders' as const },
  ];

  return (
    <HomeFrame kind="user" roleLine={t('Business account')}>
      {() => (
        <>
          {/*
            The tab bar, in the space the branding used to take (Pravin, 2 Oct
            2026). It sits above everything else on the home screen because a
            tab bar below the content is one somebody has to scroll to find.
          */}
          <TopTabs current="home" />
          {setupNeeded && (
            <Pressable accessibilityRole="button" onPress={() => router.push('/business/setup')}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, borderColor: c.warning, backgroundColor: c.warningSoft }}>
                <Icon name="alert" size={22} color={c.warning} />
                <View style={{ flex: 1 }}>
                  <Text weight="semibold">{t('Finish phone setup')}</Text>
                  <Text variant="small" color={c.inkSoft}>{t('A permission or battery setting is off, so attendance or location may not be recorded.')}</Text>
                </View>
                <Icon name="arrowRight" size={20} color={c.warning} />
              </Card>
            </Pressable>
          )}
          <UpdateBanner />
          {access.sections.attendance && access.tracking.clockIn && <AttendanceCard trackLocation={access.tracking.location} requireSelfie={access.tracking.selfie} />}

          {tiles.length > 0 && (
            <Text variant="small" weight="semibold" color={c.inkSoft} style={{ marginTop: space.sm, textTransform: 'uppercase', letterSpacing: 1 }}>
              {t('Your work')}
            </Text>
          )}
          {/* F-02: a technician's own month, for anyone who has jobs. */}
          {access.sections.complaints && has('complaints.view', 'complaints.edit') && <MyWorkCard />}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            {tiles.map((tile) => (
              <Tile key={tile.href} icon={tile.icon} label={tile.label} line={tile.line} onPress={() => router.push(tile.href)} />
            ))}
          </View>
        </>
      )}
    </HomeFrame>
  );
}

function Tile({ icon, label, line, onPress }: { icon: IconName; label: string; line: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexBasis: '47%', flexGrow: 1, minHeight: 112, padding: space.lg, gap: space.sm,
        borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.brandSoft : c.surface,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} color={c.brand} />
      </View>
      <Text weight="semibold">{label}</Text>
      <Text variant="micro" color={c.inkSoft}>{line}</Text>
    </Pressable>
  );
}
