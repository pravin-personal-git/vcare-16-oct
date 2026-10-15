import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Text } from './ui';
import { Icon } from './Icon';
import { shopRupees, type ShopItem } from '@/lib/shop';
import { font, radius, space } from '@/theme/tokens';

/**
 * The shop's cards, two to a row (3 Oct 2026, the phone screen in Pravin's
 * approved mock-up). Shared by the signed-in Shop and by browsing without an
 * account, so the two never drift apart.
 *
 * `onAdd` absent means browsing without an account: the button asks them to
 * sign in instead (decision 9 - browse is public, a list needs a login).
 */
export function ShopGrid({ items, categories, inList, onAdd, onSignIn, busyId }: {
  items: ShopItem[];
  categories: string[];
  inList?: Map<string, number>;
  onAdd?: (item: ShopItem) => void;
  onSignIn?: () => void;
  busyId?: string | null;
}) {
  const { c } = useTheme();
  const { t } = useT();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => (!cat || i.categoryName === cat)
      && (!s || `${i.name} ${i.brandName ?? ''} ${i.blurb ?? ''}`.toLowerCase().includes(s)));
  }, [items, q, cat]);

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
        <Icon name="search" size={18} color={c.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={t('Search cameras, recorders, hard disks…')}
          placeholderTextColor={c.muted}
          style={{ flex: 1, paddingVertical: 10, fontFamily: font.regular, color: c.ink }}
          accessibilityLabel={t('Search the shop')}
        />
      </View>

      {categories.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
          {['', ...categories].map((k) => {
            const on = cat === k;
            return (
              <Pressable
                key={k || 'all'}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setCat(k)}
                style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: on ? c.ink : c.line, backgroundColor: on ? c.ink : c.surface }}
              >
                <Text variant="small" weight="semibold" color={on ? c.bg : c.ink}>{k || t('Everything')}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {shown.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.xs }}>
          <Text weight="semibold">{items.length === 0 ? t('Nothing on the shop yet') : t('Nothing matches')}</Text>
          <Text variant="small" color={c.inkSoft} align="center">
            {items.length === 0 ? t('Please ring the business - they will know what is available.') : t('Try another word, or tap Everything.')}
          </Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {shown.map((i) => {
            const n = inList?.get(i.id) ?? 0;
            return (
              <View key={i.id} style={{ width: '48.5%', borderRadius: radius.lg, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden' }}>
                {i.imageUrls[0] ? (
                  <Image source={{ uri: i.imageUrls[0] }} accessibilityLabel={i.name} resizeMode="contain" style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: c.surface }} />
                ) : (
                  <View style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={i.kind === 'combo' ? 'box' : 'camera'} size={28} color={c.brand} />
                  </View>
                )}
                {i.offerLabel ? (
                  <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: c.surface, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text variant="micro" weight="bold">{i.offerLabel}</Text>
                  </View>
                ) : null}
                <View style={{ padding: space.sm, gap: 3, flex: 1 }}>
                  {i.brandName ? <Text variant="micro" weight="bold" color={c.brand} style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>{i.brandName}</Text> : null}
                  <Text variant="small" weight="semibold" numberOfLines={2}>{i.name}</Text>
                  {i.contains.length > 0 ? <Text variant="micro" color={c.inkSoft} numberOfLines={2}>{i.contains.join(' · ')}</Text> : null}
                  <Text weight="bold" style={{ fontSize: 16 }}>{shopRupees(i.pricePaise)}</Text>
                  <Text variant="micro" color={c.inkSoft}>{t('Product only · fitting quoted separately')}</Text>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busyId === i.id}
                    onPress={() => (onAdd ? onAdd(i) : onSignIn?.())}
                    style={({ pressed }) => ({
                      marginTop: 6, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center',
                      borderWidth: 1.5, borderColor: c.brand,
                      backgroundColor: n ? c.brand : pressed ? c.brandSoft : c.surface,
                      opacity: busyId === i.id ? 0.6 : 1,
                    })}
                  >
                    <Text variant="small" weight="bold" color={n ? c.brandInk : c.brand}>
                      {!onAdd ? t('Sign in to add') : n ? `${t('In my list')} (${n}) +` : t('Add to my list')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
