import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text as RNText, TextInput, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { font, radius, space, type as typeScale, TOUCH } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { useTextScale } from '@/theme/textScale';

/**
 * The building blocks every screen is made of. Colours, type and spacing
 * come only from the theme tokens, so every screen follows light/dark and the
 * brand without restating them.
 */

type Variant = keyof typeof typeScale;
type Weight = 'regular' | 'medium' | 'semibold' | 'bold';

export function Text({
  children, variant = 'body', weight = 'regular', color, align, style, numberOfLines,
}: {
  children: ReactNode; variant?: Variant; weight?: Weight; color?: string;
  align?: TextStyle['textAlign']; style?: StyleProp<TextStyle>; numberOfLines?: number;
}) {
  const { c } = useTheme();
  const k = useTextScale();
  const size = typeScale[variant];
  return (
    <RNText
      numberOfLines={numberOfLines}
      style={[k === 1 ? size : { fontSize: Math.round(size.fontSize * k), lineHeight: Math.round(size.lineHeight * k) }, { fontFamily: font[weight], color: color ?? c.ink, textAlign: align }, style]}
    >
      {children}
    </RNText>
  );
}

export function Screen({ children, style, edges = ['top', 'bottom'] }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const { c } = useTheme();
  return <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: c.bg }, style]}>{children}</SafeAreaView>;
}

export function Button({
  label, onPress, variant = 'primary', icon, loading = false, disabled = false, style,
}: {
  label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost';
  icon?: IconName; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const bg = variant === 'primary' ? c.brand : variant === 'secondary' ? c.surface : 'transparent';
  const fg = variant === 'primary' ? c.brandInk : c.ink;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}
      disabled={off}
      onPress={() => { void Haptics.selectionAsync().catch(() => undefined); onPress(); }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: variant === 'secondary' ? c.line : 'transparent',
          opacity: off ? 0.55 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          <Text weight="semibold" color={fg}>{label}</Text>
          {icon && <Icon name={icon} size={20} color={fg} />}
        </>
      )}
    </Pressable>
  );
}

export function Field({
  label, error, secure = false, icon, ...input
}: TextInputProps & { label: string; error?: string | null; secure?: boolean; icon?: IconName }) {
  const { c } = useTheme();
  const { t } = useT();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secure);
  return (
    <View style={{ gap: 6 }}>
      <Text variant="small" weight="medium" color={c.inkSoft}>{label}</Text>
      <View
        style={[
          styles.field,
          { backgroundColor: c.surface, borderColor: error ? c.danger : focused ? c.brand : c.line },
        ]}
      >
        {icon && <Icon name={icon} size={20} color={focused ? c.brand : c.muted} />}
        <TextInput
          {...input}
          secureTextEntry={hidden}
          placeholderTextColor={c.muted}
          onFocus={(e) => { setFocused(true); input.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); input.onBlur?.(e); }}
          style={[typeScale.body, { flex: 1, fontFamily: font.regular, color: c.ink, paddingVertical: 10 }]}
        />
        {secure && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? t('Show password') : t('Hide password')}
            hitSlop={12}
            onPress={() => setHidden((h) => !h)}
          >
            <Icon name={hidden ? 'eye' : 'eyeOff'} size={20} color={c.muted} />
          </Pressable>
        )}
      </View>
      {error ? <Text variant="small" color={c.danger}>{error}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.line, boxShadow: `0 6px 18px ${c.shadow}` }, style]}>
      {children}
    </View>
  );
}

export function Banner({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: string; children: ReactNode }) {
  const { c } = useTheme();
  const map = {
    info: [c.brandSoft, c.brand, 'info'],
    warning: [c.warningSoft, c.warning, 'calendar'],
    danger: [c.dangerSoft, c.danger, 'alert'],
    success: [c.successSoft, c.success, 'check'],
  } as const;
  const [bg, fg, icon] = map[tone];
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: bg }]}>
      <Icon name={icon} size={20} color={fg} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text weight="semibold" color={fg}>{title}</Text> : null}
        <Text variant="small" color={c.ink}>{children}</Text>
      </View>
    </View>
  );
}

/** Language and theme switches - present in the corner of every entry screen. */
export function PrefSwitches({ onHero = false }: { onHero?: boolean }) {
  const { c, isDark, toggle } = useTheme();
  const { lang, toggle: toggleLang, t } = useT();
  const fg = onHero ? c.heroInk : c.ink;
  const border = onHero ? 'rgba(255,255,255,0.18)' : c.line;
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('Language')}
        onPress={toggleLang}
        style={[styles.chip, { borderColor: border }]}
      >
        <Icon name="globe" size={18} color={fg} />
        <Text variant="small" weight="semibold" color={fg}>{lang === 'hi' ? 'English' : 'हिंदी'}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={isDark ? t('Light mode') : t('Dark mode')}
        onPress={toggle}
        style={[styles.chip, { borderColor: border, paddingHorizontal: 12 }]}
      >
        <Icon name={isDark ? 'sun' : 'moon'} size={18} color={fg} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: TOUCH + 4, borderRadius: radius.md, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.xl,
  },
  field: {
    minHeight: TOUCH + 4, borderRadius: radius.md, borderWidth: 1.5,
    flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg,
  },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: space.lg },
  banner: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md, alignItems: 'flex-start' },
  chip: {
    minHeight: 40, borderRadius: radius.pill, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14,
  },
});
