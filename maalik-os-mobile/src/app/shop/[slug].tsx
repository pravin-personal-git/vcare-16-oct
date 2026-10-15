import { useCallback, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { Banner, Button } from '@/components/ui';
import { Loading, SubScreen, useLoad } from '@/components/Kit';
import { ShopGrid } from '@/components/ShopGrid';
import { browseShop, rememberShop } from '@/lib/shop';

/**
 * A business's shop, read only, before signing in. Looking is free; making a
 * list needs an account (decision 9), so every button here leads to sign-in.
 */
export default function BrowseShop() {
  const { t } = useT();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data, error, loading, reload } = useLoad(useCallback(() => browseShop(String(slug ?? '')), [slug]));

  // Remember it only once it has opened: a mistyped name is not worth keeping.
  useEffect(() => { if (data?.slug) void rememberShop(data.slug); }, [data]);

  const signIn = () => router.push('/customer/login');

  return (
    <SubScreen
      title={data?.business ?? t('Shop')}
      subtitle={t('Prices are for the product only. Nothing is paid in the app.')}
      onRefresh={reload}
      footer={data ? <Button label={t('Sign in to make a list')} icon="arrowRight" onPress={signIn} /> : undefined}
    >
      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data ? <Loading /> : data && (
        <ShopGrid items={data.items} categories={data.categories} onSignIn={signIn} />
      )}
    </SubScreen>
  );
}
