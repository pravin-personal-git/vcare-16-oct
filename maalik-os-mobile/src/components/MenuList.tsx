import { Pressable, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './ui';
import { Icon, type IconName } from './Icon';
import { radius, space } from '@/theme/tokens';

/**
 * A list of places to go, for the owner's Sales / Money / More tabs (13 Oct
 * 2026). A native screen opens directly; one not built natively yet opens
 * that page of the website, marked "Website" so nobody is surprised - each
 * one moves to native in the next builds (ADMIN-NATIVE-APP-SPEC).
 */
export interface MenuItem { icon: IconName; label: string; line?: string; href?: Href; web?: string; badge?: string; tone?: 'danger' | 'warning' }

export function MenuList({ items }: { items: MenuItem[] }) {
  const { t } = useT();
  const { c } = useTheme();
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden' }}>
      {items.map((m, i) => (
        <Pressable key={m.label} accessibilityRole="button"
          onPress={() => (m.href ? router.push(m.href) : m.web ? router.push({ pathname: '/owner/web', params: { next: m.web } }) : undefined)}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 60, backgroundColor: pressed ? c.brandSoft : 'transparent', borderTopWidth: i ? 1 : 0, borderTopColor: c.line })}>
          <View style={{ width: 38, height: 38, borderRadius: radius.md, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={m.icon} size={20} color={c.brand} />
          </View>
          <View style={{ flex: 1 }}>
            <Text weight="semibold">{m.label}</Text>
            {m.line ? <Text variant="small" color={c.inkSoft}>{m.line}</Text> : null}
          </View>
          {m.badge ? <Text variant="small" weight="bold" color={m.tone === 'danger' ? c.danger : m.tone === 'warning' ? c.warning : c.brand}>{m.badge}</Text> : null}
          {m.web && <Text variant="micro" color={c.muted}>{t('Website')}</Text>}
          <Icon name="arrowRight" size={18} color={c.muted} />
        </Pressable>
      ))}
    </View>
  );
}
