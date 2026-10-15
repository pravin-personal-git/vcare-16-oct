import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Icon, type IconName } from './Icon';
import { Text } from './ui';
import { space } from '@/theme/tokens';

/**
 * The simple field-worker app's bottom bar (13 Oct 2026): My work ·
 * Schedule · Me - and nothing else (Pravin: "I don't want technicians to see
 * anything other than their complaints and their scheduled visits").
 * Schedule goes when the owner switches it off in the layout.
 */
export type SimpleTab = 'work' | 'schedule' | 'me';

const TABS: { key: SimpleTab; icon: IconName; label: string; href: '/employee/work' | '/employee/schedule' | '/employee/me' }[] = [
  { key: 'work', icon: 'wrench', label: 'My work', href: '/employee/work' },
  { key: 'schedule', icon: 'calendar', label: 'Schedule', href: '/employee/schedule' },
  { key: 'me', icon: 'user', label: 'Me', href: '/employee/me' },
];

export function SimpleNav({ current, schedule = true }: { current: SimpleTab; schedule?: boolean }) {
  const { c } = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.line, backgroundColor: c.surface, paddingBottom: Math.max(insets.bottom, space.sm) }}>
      {TABS.filter((x) => schedule || x.key !== 'schedule').map((x) => {
        const on = x.key === current;
        return (
          <Pressable key={x.key} accessibilityRole="tab" accessibilityState={{ selected: on }}
            onPress={() => { if (!on) router.replace(x.href); }}
            style={{ flex: 1, alignItems: 'center', paddingTop: space.sm, gap: 2, minHeight: 56 }}>
            <Icon name={x.icon} size={24} color={on ? c.brand : c.muted} />
            <Text variant="small" weight={on ? 'bold' : 'medium'} color={on ? c.brand : c.muted}>{t(x.label)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
