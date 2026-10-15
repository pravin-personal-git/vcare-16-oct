import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { PrefSwitches, Screen, Text } from './ui';
import { Icon, type IconName } from './Icon';
import { radius, space } from '@/theme/tokens';

/** The shared frame of both login screens: back, switches, a titled card. */
export function AuthFrame({ icon, title, subtitle, children }: {
  icon: IconName; title: string; subtitle: string; children: ReactNode;
}) {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.top}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Back')}
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
              style={[styles.back, { borderColor: c.line, backgroundColor: c.surface }]}
            >
              <Icon name="arrowLeft" size={20} color={c.ink} />
            </Pressable>
            <PrefSwitches />
          </View>

          <Animated.View entering={FadeInDown.duration(450)} style={{ gap: space.md, marginTop: space.xl }}>
            <View style={[styles.badge, { backgroundColor: c.brandSoft }]}>
              <Icon name={icon} size={26} color={c.brand} />
            </View>
            <Text variant="h1" weight="bold">{title}</Text>
            <Text color={c.inkSoft}>{subtitle}</Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(100).duration(450)} style={{ marginTop: space.xl, gap: space.lg }}>
            {children}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** Two-way switch used for "Password / OTP". */
export function Tabs<K extends string>({ value, options, onChange }: {
  value: K; options: { key: K; label: string }[]; onChange: (k: K) => void;
}) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: c.surface2 }]}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={[styles.tab, on && { backgroundColor: c.surface, boxShadow: `0 2px 6px ${c.shadow}` }]}
          >
            <Text weight={on ? 'semibold' : 'medium'} color={on ? c.ink : c.inkSoft}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, padding: space.xl, paddingTop: space.lg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { width: 44, height: 44, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { width: 56, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', padding: 4, borderRadius: radius.md, gap: 4 },
  tab: { flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
