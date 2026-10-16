import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Button, Field, Text } from '@/components/ui';
import { SubScreen } from '@/components/Kit';
import { lastShop } from '@/lib/shop';

/**
 * Browse a shop without an account (3 Oct 2026). Vcare serves many
 * businesses, so the person types the shop name the business gave them - the
 * same name as the website's /shop/<name>. The last one is remembered.
 */
export default function PickShop() {
  const { c } = useTheme();
  const { t } = useT();
  const [name, setName] = useState('');

  useEffect(() => { void lastShop().then((s) => { if (s) setName(s); }); }, []);

  const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');

  return (
    <SubScreen title={t('Browse a shop')} subtitle={t('No account needed to look around.')}>
      <Text color={c.inkSoft}>
        {t('Type the shop name the business gave you. It is the last part of their shop link, like "vcare" in app.vcarebgsgroup.in/shop/vcare.')}
      </Text>
      <Field
        label={t('Shop name')}
        value={name}
        onChangeText={setName}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="vcare"
        icon="globe"
        onSubmitEditing={() => { if (clean) router.push({ pathname: '/shop/[slug]', params: { slug: clean } }); }}
      />
      <Button
        label={t('Open the shop')}
        icon="arrowRight"
        disabled={!clean}
        onPress={() => router.push({ pathname: '/shop/[slug]', params: { slug: clean } })}
      />
      <Text variant="small" color={c.inkSoft}>
        {t('Already a customer? Sign in instead - your own business’s shop is on your home screen.')}
      </Text>
      <Button label={t("I'm a customer")} variant="secondary" onPress={() => router.replace('/customer/login')} />
    </SubScreen>
  );
}
