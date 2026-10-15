import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { PrefSwitches, Screen, Text } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';
import { BrandMark } from '@/components/BrandMark';
import { radius, space } from '@/theme/tokens';

/**
 * The first screen: customer or business. Two large, unmistakable choices -
 * the person holding the phone may be a shop owner's customer who has never
 * used business software, so nothing here assumes they know what a "portal"
 * or a "tenant" is.
 */
export default function Welcome() {
  const { c, isDark } = useTheme();
  const { t } = useT();

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body} bounces={false}>
        <View style={styles.top}>
          <BrandMark onDark={isDark} color={c.ink} />
          <PrefSwitches />
        </View>

        <Animated.View entering={FadeInDown.duration(500)} style={{ gap: space.sm, marginTop: space.xxl }}>
          <Text variant="h1" weight="bold">{t('Welcome')}</Text>
          <Text color={c.inkSoft}>{t('How would you like to sign in?')}</Text>
        </Animated.View>

        <View style={{ gap: space.lg, marginTop: space.xl }}>
          <Choice
            delay={120}
            icon="user"
            title={t("I'm a customer")}
            line={t('Raise a complaint, book a service visit, see your history.')}
            onPress={() => router.push('/customer/login')}
          />
          <Choice
            delay={170}
            icon="search"
            title={t('Just looking')}
            line={t('Browse a shop without an account.')}
            onPress={() => router.push('/shop')}
          />
          <Choice
            delay={220}
            icon="briefcase"
            title={t('Business login')}
            line={t('For business owners and staff.')}
            onPress={() => router.push('/business/login')}
            strong
          />
        </View>

        <View style={{ flex: 1 }} />
        <Text variant="micro" color={c.muted} align="center" style={{ marginTop: space.xxl }}>
          {t('The Operating System for Business')} · N.A.I.R. SOLUTIONS
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Choice({ icon, title, line, onPress, delay, strong = false }: {
  icon: IconName; title: string; line: string; onPress: () => void; delay: number; strong?: boolean;
}) {
  const { c, isDark } = useTheme();
  // The emphasised card is the dark hero on a light page; on a dark page
  // "dark" is no emphasis at all, so there it takes the brand colour instead.
  const bg = strong ? (isDark ? c.brandSoft : c.hero) : c.surface;
  const fg = strong ? c.heroInk : c.ink;
  const sub = strong ? c.heroSoft : c.inkSoft;
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(500)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${line}`}
        onPress={onPress}
        style={({ pressed }) => [
          styles.choice,
          { backgroundColor: bg, borderColor: strong ? (isDark ? c.brand : 'transparent') : c.line, boxShadow: `0 10px 24px ${c.shadow}`, transform: [{ scale: pressed ? 0.98 : 1 }] },
        ]}
      >
        <View style={[styles.choiceIcon, { backgroundColor: strong ? 'rgba(255,255,255,0.10)' : c.brandSoft }]}>
          <Icon name={icon} size={26} color={strong ? c.accent : c.brand} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="h3" weight="bold" color={fg}>{title}</Text>
          <Text variant="small" color={sub}>{line}</Text>
        </View>
        <Icon name="arrowRight" size={22} color={strong ? c.accent : c.brand} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, padding: space.xl, paddingTop: space.lg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  choice: {
    flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.xl, borderRadius: radius.xl, borderWidth: 1, minHeight: 112,
  },
  choiceIcon: { width: 56, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
});
