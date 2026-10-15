import { useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './ui';
import { Icon } from './Icon';
import { font, radius, space, type as typeScale } from '@/theme/tokens';

/** A search-as-you-type list in a sheet - first 60 matches, so a big catalogue stays fast. */
export function SearchPicker({ visible, title, items, onClose }: {
  visible: boolean; title: string; onClose: () => void;
  items: { key: string; title: string; line: string; hay: string; pick: () => void }[];
}) {
  const { t } = useT();
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = (needle ? items.filter((x) => x.hay.toLowerCase().includes(needle)) : items).slice(0, 60);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: 40 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.lg }}>
          <Text variant="h3" weight="bold" style={{ flex: 1 }}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={onClose} hitSlop={10}><Icon name="x" size={24} color={c.ink} /></Pressable>
        </View>
        <View style={{ marginHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surface }}>
          <Icon name="search" size={18} color={c.muted} />
          <TextInput autoFocus value={q} onChangeText={setQ} placeholder={t('Search')} placeholderTextColor={c.muted}
            style={[typeScale.body, { flex: 1, fontFamily: font.regular, color: c.ink, paddingVertical: 10 }]} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: space.lg, gap: space.sm }}>
          {shown.map((x) => (
            <Pressable key={x.key} onPress={() => { setQ(''); x.pick(); }}
              style={({ pressed }) => ({ padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, backgroundColor: pressed ? c.brandSoft : c.surface })}>
              <Text weight="semibold">{x.title}</Text>
              <Text variant="small" color={c.inkSoft}>{x.line}</Text>
            </Pressable>
          ))}
          {shown.length === 0 && <Text color={c.muted}>{t('Nothing matches.')}</Text>}
        </ScrollView>
      </View>
    </Modal>
  );
}
