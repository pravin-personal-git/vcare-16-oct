import { useEffect } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import Animated, {
  Easing, FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Text } from '@/components/ui';
import { bootstrap, homeFor, INTRO_MAX_MS, INTRO_MIN_MS } from '@/lib/boot';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * The opening animation - N.A.I.R. SOLUTIONS, then Vcare.
 *
 * It is a curtain, not a wait: the sign-in check runs behind it from the
 * first frame. It stays at least INTRO_MIN_MS so it never flashes, and at
 * most INTRO_MAX_MS - if loading is slower than that, the app opens anyway
 * and loading finishes in the background. It can never hang here.
 */

const LOGO = require('../../assets/brand/logo-white.png');
// The Vcare wordmark's own shape (13 Oct 2026). Printed by
// scripts/brand-assets.cjs - the <Image> is sized by width and derives
// its height from this, so a stale ratio stretches the logo.
const LOGO_RATIO = 1891 / 726;
const LOGO_START = 350;

export default function Intro() {
  const { c } = useTheme();
  const { t } = useT();
  const underline = useSharedValue(0);
  const curtain = useSharedValue(1);
  const logo = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    // The logo rises and settles; the glow blooms behind it; then the gold
    // line sweeps out under it.
    logo.value = withDelay(LOGO_START, withSpring(1, { damping: 14, stiffness: 90 }));
    glow.value = withDelay(LOGO_START, withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }));
    underline.value = withDelay(
      LOGO_START + 900,
      withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }),
    );

    // Design review in the browser preview only: `?intro=hold` keeps the
    // intro on screen. There is no URL on a phone, so this never applies there.
    const hold = Platform.OS === 'web' && typeof location !== 'undefined' && location.search.includes('intro=hold');

    let left = false;
    const leave = (to: ReturnType<typeof homeFor>) => {
      if (left || hold) return;
      left = true;
      curtain.value = withTiming(0, { duration: 320 });
      setTimeout(() => router.replace(to), 330);
    };

    const started = Date.now();
    const hardStop = setTimeout(() => leave('/welcome'), INTRO_MAX_MS);
    bootstrap()
      .then(({ session }) => {
        const wait = Math.max(0, INTRO_MIN_MS - (Date.now() - started));
        setTimeout(() => leave(homeFor(session)), wait);
      })
      .catch(() => leave('/welcome'));
    return () => clearTimeout(hardStop);
  }, [curtain, underline, logo, glow]);

  const underlineStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: underline.value }], opacity: underline.value }));
  const curtainStyle = useAnimatedStyle(() => ({ opacity: curtain.value }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, logo.value * 1.4),
    transform: [{ translateY: (1 - logo.value) * 24 }, { scale: 0.9 + logo.value * 0.1 }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Animated.View style={[styles.fill, { backgroundColor: c.hero }, curtainStyle]}>
      {/* A soft glow behind the wordmark - a radial gradient, no image. */}
      <Animated.View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }, glowStyle]}>
        <Glow size={600} color={c.brand} opacity={0.38} />
        <Glow size={320} color={c.accent} opacity={0.14} />
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(600)} style={styles.maker}>
        <Text variant="micro" weight="semibold" color={c.heroSoft} style={{ letterSpacing: 4 }}>N.A.I.R. SOLUTIONS</Text>
        <Text variant="micro" color={c.heroSoft} style={{ letterSpacing: 1, opacity: 0.7 }}>{t('presents')}</Text>
      </Animated.View>

      <View style={styles.center}>
        <Animated.View style={logoStyle} accessibilityRole="header" accessibilityLabel="Vcare. Run it. Understand it. Grow it.">
          <Image source={LOGO} style={{ width: 290, height: 290 / LOGO_RATIO }} resizeMode="contain" />
        </Animated.View>
        <Animated.View style={[styles.underline, { backgroundColor: c.accent }, underlineStyle]} />
        <Animated.View entering={FadeIn.delay(1600).duration(700)} style={{ alignItems: 'center', gap: 6 }}>
          <Text variant="small" weight="semibold" color={c.heroInk} align="center">{t('The Operating System for Business')}</Text>
          <Text variant="micro" color={c.heroSoft} align="center" style={{ letterSpacing: 0.5 }}>
            {'Management • Automation • Analytics\nLifecycle • Intelligence • Knowledge'}
          </Text>
        </Animated.View>
      </View>

      <Animated.View entering={FadeIn.delay(2000).duration(700)} style={styles.footer}>
        <Text variant="micro" color={c.heroSoft} align="center">{t('developed by')}</Text>
        <Text variant="small" weight="semibold" color={c.heroInk} align="center" style={{ letterSpacing: 2 }}>N.A.I.R. SOLUTIONS</Text>
      </Animated.View>
    </Animated.View>
  );
}

function Glow({ size, color, opacity }: { size: number; color: string; opacity: number }) {
  const id = `g${size}`;
  return (
    // Its own full-screen layer, so the drawing never takes part in the page
    // layout - on the web an absolutely placed <svg> still pushed the
    // wordmark sideways.
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none', alignItems: 'center', justifyContent: 'center' }]}>
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="0.55" stopColor={color} stopOpacity={opacity * 0.35} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width={size} height={size} fill={`url(#${id})`} />
    </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 56, overflow: 'hidden' },
  maker: { alignItems: 'center', gap: 4, marginTop: 24 },
  center: { alignItems: 'center', gap: 20, paddingHorizontal: 24 },
  underline: { width: 132, height: 3, borderRadius: 2 },
  footer: { alignItems: 'center', gap: 2 },
});
