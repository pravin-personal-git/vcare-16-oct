import { useCallback, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { useT } from '@/i18n/I18nProvider';
import { Banner, Button } from '@/components/ui';
import { Loading, SubScreen, useLoad } from '@/components/Kit';
import { ShopGrid } from '@/components/ShopGrid';
import { ApiError } from '@/lib/api';
import { addToList, customerShop, type ShopList } from '@/lib/shop';

/**
 * Shop, for a signed-in customer (3 Oct 2026, decision 9). Their own
 * business's catalogue - from their sign-in, never chosen here - and a list
 * kept on their account, so it is still there next time they open the app.
 */
export default function CustomerShop() {
  const { t } = useT();
  const { data, error, loading, reload } = useLoad(useCallback(() => customerShop(), []));
  // The loaded list, until an add or a quantity change returns a newer one.
  const [changed, setList] = useState<ShopList | null | undefined>(undefined);
  const list = changed === undefined ? (data?.list ?? null) : changed;
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);


  const inList = useMemo(() => new Map((list?.lines ?? []).map((l) => [l.refId, l.qty])), [list]);
  const count = (list?.lines ?? []).reduce((n, l) => n + l.qty, 0);

  return (
    <SubScreen
      title={data ? `${t('Shop')} · ${data.business}` : t('Shop')}
      subtitle={t('Make a list and send it - they ring you with a quote.')}
      onRefresh={reload}
      footer={<Button label={`${t('My list')} · ${count}`} icon="arrowRight" onPress={() => router.push('/customer/list')} />}
    >
      {error && <Banner tone="danger">{error}</Banner>}
      {note && <Banner tone={note.tone}>{note.text}</Banner>}
      {loading && !data ? <Loading /> : data && (
        <ShopGrid
          items={data.items}
          categories={data.categories}
          inList={inList}
          busyId={busy}
          onAdd={async (item) => {
            setBusy(item.id);
            setNote(null);
            try {
              const r = await addToList(item.kind, item.id);
              if (!r) { router.replace('/customer/login'); return; }
              setList(r.list);
              setNote({ tone: 'success', text: `${item.name} ${t('added to your list.')}` });
            } catch (e) {
              setNote({ tone: 'danger', text: e instanceof ApiError ? e.message : t('Could not add that.') });
            } finally {
              setBusy(null);
            }
          }}
        />
      )}
    </SubScreen>
  );
}
