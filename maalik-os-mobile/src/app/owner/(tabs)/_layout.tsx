import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Icon, type IconName } from '@/components/Icon';
import { font } from '@/theme/tokens';

/**
 * The owner's app (13 Oct 2026, ADMIN-NATIVE-APP-SPEC decision N2): bottom
 * tabs Home · Service · Sales · Money · More - native screens, no website in
 * between. Settings stay on the website (N3), one tap away under More.
 */
const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'home', title: 'Home', icon: 'home' },
  { name: 'service', title: 'Service', icon: 'wrench' },
  { name: 'sales', title: 'Sales', icon: 'trending' },
  { name: 'money', title: 'Money', icon: 'file' },
  { name: 'more', title: 'More', icon: 'briefcase' },
];

export default function OwnerTabs() {
  const { c } = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.brand,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line, height: 60 + insets.bottom, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 6) },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 12 },
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      {TABS.map((x) => (
        <Tabs.Screen key={x.name} name={x.name} options={{ title: t(x.title), tabBarIcon: ({ color }) => <Icon name={x.icon} size={24} color={String(color)} /> }} />
      ))}
    </Tabs>
  );
}
