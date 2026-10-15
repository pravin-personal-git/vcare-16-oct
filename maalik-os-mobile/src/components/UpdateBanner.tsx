import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Text } from './ui';
import { Icon } from './Icon';
import { checkForUpdate, type UpdateInfo } from '@/lib/update';
import { radius, space } from '@/theme/tokens';

/** A quiet strip at the top of a home screen when a newer build exists. */
export function UpdateBanner() {
  const { c } = useTheme();
  const { t } = useT();
  const [u, setU] = useState<UpdateInfo | null>(null);
  useEffect(() => { checkForUpdate().then(setU).catch(() => undefined); }, []);
  if (!u) return null;
  return (
    <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(u.url)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: u.required ? c.dangerSoft : c.accentSoft }}>
        <Icon name="refresh" size={20} color={u.required ? c.danger : c.accent} />
        <View style={{ flex: 1 }}>
          <Text weight="semibold">{u.required ? t('Update needed') : t('Update available')}{u.version ? ` · ${u.version}` : ''}</Text>
          <Text variant="small" color={c.inkSoft}>{u.notes ?? t('Tap to download the new version.')}</Text>
        </View>
        <Icon name="arrowRight" size={18} color={c.muted} />
      </View>
    </Pressable>
  );
}
