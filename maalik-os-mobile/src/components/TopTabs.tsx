import { Pressable, ScrollView, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Text } from './ui';
import { useAccess } from '@/lib/access';
import { space } from '@/theme/tokens';

/**
 * The tab bar, at the TOP.
 *
 * Pravin, 2 Oct 2026, after clicking through the archetype: "the navbar instead
 * of being down wouldn't it be better if it upside of the app, because right
 * now the technician app has Vcare branding very big and taking up a lot of
 * space so we can make it smaller and use that space".
 *
 * So this sits directly under the one-line greeting row, in the space the
 * branding used to take. Two consequences worth stating:
 *
 *   - IT SCROLLS SIDEWAYS. Five tabs at a readable size do not fit across a
 *     narrow phone, and shrinking the text to make them fit is how a tab bar
 *     becomes unusable in a van in daylight. A tab that is off-screen is
 *     findable; a tab that is four pixels tall is not.
 *
 *   - IT IS BUILT FROM `access.sections`, the same switch the home tiles use.
 *     A shop that does no installations never sees that tab, rather than
 *     seeing one that opens an empty list.
 */

type Tab = { key: string; label: string; href: string };

export function TopTabs({ current }: { current: string }) {
  const { c } = useTheme();
  const { t } = useT();
  const a = useAccess();
  const path = usePathname();

  const tabs: Tab[] = [
    { key: 'home', label: t('Home'), href: '/employee/home' },
    ...(a.sections.installations ? [{ key: 'installs', label: t('Installs'), href: '/employee/installations' }] : []),
    ...(a.sections.complaints ? [{ key: 'jobs', label: t('Complaints'), href: '/employee/complaints' }] : []),
    ...(a.sections.complaints ? [{ key: 'visits', label: t('Visits'), href: '/employee/visits' }] : []),
    ...(a.sections.van ? [{ key: 'van', label: t('My van'), href: '/employee/van' }] : []),
  ];

  // One tab is not a tab bar. A shop with everything else switched off should
  // see a plain home screen, not a lone button that goes where they already are.
  if (tabs.length < 2) return null;

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: c.bg }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.lg }}
      >
        {tabs.map((tab) => {
          const on = tab.key === current || path === tab.href;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => { if (!on) router.replace(tab.href as never); }}
              style={{
                paddingVertical: space.sm,
                borderBottomWidth: 2,
                borderBottomColor: on ? c.brand : 'transparent',
              }}
            >
              <Text weight={on ? 'bold' : 'semibold'} color={on ? c.brand : c.muted} variant="small">
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
