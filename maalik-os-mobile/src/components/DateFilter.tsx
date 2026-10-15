import { View } from 'react-native';
import { useT } from '@/i18n/I18nProvider';
import { Segmented } from '@/components/Kit';
import { space } from '@/theme/tokens';

/**
 * DATE FILTERS ON THE PHONE (Vcare, 8 Oct 2026).
 *
 * Pravin asked for date filters on every page, "daily weekly monthly", on the
 * website AND in the app. The website got them on 7 Oct; this is the app.
 *
 * FILTERED IN THE PHONE, not on the server, and that is the right call here
 * rather than a shortcut. Every one of these screens already downloads its
 * whole list in one request and narrows it in the browser - that is how the
 * To do / Done / kind tabs have always worked. Sending a date to the server
 * would mean a round trip per tap, on a phone that is often on one bar of
 * signal in somebody's basement, to filter a list it is already holding.
 *
 * ALL is the default, matching the website after Pravin changed his mind on
 * 8 Oct. A technician opening the app wants to see the job that has been
 * sitting there since Friday.
 *
 * Weeks start on Monday, which is how a Vcare week is talked about.
 */
/*
  The arithmetic lives in the website's `lib/date-windows`, which metro
  resolves through `@shared/` - so it is written once and, more to the point,
  TESTED once. The app has no test runner, and "this month" at a month
  boundary is exactly the sort of thing that goes quietly wrong.
*/
import type { DateKey } from '@shared/lib/date-windows';

export { inDateRange } from '@shared/lib/date-windows';
export type { DateKey };

/**
 * The four buttons. Kept to four and to one word each, because this sits on
 * a screen that already has a scope switch, a tab row and a kind row - a
 * fifth choice would push the list itself below the fold on a small phone.
 */
export function DateFilter({ value, onChange }: { value: DateKey; onChange: (k: DateKey) => void }) {
  const { t } = useT();
  return (
    <View style={{ marginBottom: space.sm }}>
      <Segmented
        value={value}
        onChange={onChange}
        options={[
          { key: 'all', label: t('All') },
          { key: 'today', label: t('Today') },
          // One word each (13 Oct 2026): "This week" was cut to "This" on a 6" phone.
          { key: 'week', label: t('Week') },
          { key: 'month', label: t('Month') },
        ]}
      />
    </View>
  );
}
