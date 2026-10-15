import { useEffect, useState, type ReactNode } from 'react';
import { confirmSignOut } from '@/lib/signout';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { PrefSwitches, Screen, Text } from './ui';
import { Icon } from './Icon';
import { OfflineBar } from './OfflineBar';
import { loadSession, type Session } from '@/lib/session';
import { font, radius, space } from '@/theme/tokens';

/**
 * The frame of every signed-in home: one compact row - initials, "Hi, name",
 * the role, language and theme - then the content. (Pravin, 28 Sep 2026: the
 * big dark branded hero took too much of the screen.) Also the guard - no
 * saved session sends the person back to Welcome.
 */
export function HomeFrame({ kind, roleLine, children }: {
  kind: Session['kind']; roleLine: string; children: (session: Session) => ReactNode;
}) {
  const { c } = useTheme();
  const { t } = useT();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    loadSession().then((s) => {
      if (!s || s.kind !== kind) { router.replace('/welcome'); return; }
      setSession(s);
    });
  }, [kind]);

  if (!session) return <Screen><View /></Screen>;

  const first = session.profile.name.split(' ')[0] || session.profile.name;
  const initials = session.profile.name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

  return (
    <Screen edges={['bottom']} style={{ backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: space.xxxl }}>
        <Animated.View entering={FadeInDown.duration(400)} style={styles.header}>
          <View style={[styles.avatar, { backgroundColor: c.brandSoft }]}>
            <Text weight="bold" color={c.brand} style={{ fontFamily: font.brand, fontSize: 14, lineHeight: 18 }}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text weight="bold" numberOfLines={1}>{t(`Hi, ${first}`)}</Text>
            <Text variant="micro" color={c.muted} numberOfLines={1}>{roleLine}</Text>
          </View>
          <PrefSwitches />
        </Animated.View>

        <View style={styles.content}><OfflineBar />{children(session)}</View>

        <Pressable
          accessibilityRole="button"
          onPress={() => { void confirmSignOut(t); }}
          style={[styles.signOut, { borderColor: c.line }]}
        >
          <Icon name="logout" size={18} color={c.danger} />
          <Text weight="semibold" color={c.danger}>{t('Sign out')}</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: 52, paddingHorizontal: space.xl, paddingBottom: space.sm },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.xl, paddingTop: space.md, gap: space.lg },
  signOut: {
    marginHorizontal: space.xl, marginTop: space.lg, minHeight: 48, borderRadius: radius.md, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
  },
});
