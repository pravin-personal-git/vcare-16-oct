import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Card, Text } from './ui';
import { myWork, type MyWorkMonth } from '@/lib/jobs';
import { space } from '@/theme/tokens';

/** "2 h 15 m", "3 d 4 h" - same wording as the website report. */
const mins = (m: number | null) => {
  if (m == null) return '-';
  if (m < 60) return `${m} m`;
  if (m < 1440) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} m` : ''}`;
  const h = Math.floor((m % 1440) / 60);
  return `${Math.floor(m / 1440)} d${h ? ` ${h} h` : ''}`;
};

/**
 * My work this month (F-02, 6 Oct 2026): a technician's own jobs closed,
 * open, how fast, deadlines, rating and km - the figures the owner sees on
 * Technician Performance, so nobody is surprised by them. Hidden for anyone
 * with no jobs.
 */
export function MyWorkCard() {
  const { c } = useTheme();
  const { t } = useT();
  const [data, setData] = useState<{ thisMonth: MyWorkMonth; lastMonth: MyWorkMonth } | null>(null);
  useEffect(() => { myWork().then((d) => setData(d ?? null)).catch(() => undefined); }, []);

  const r = data?.thisMonth.row;
  if (!data || !r) return null;
  const last = data.lastMonth.row;

  const cells: { label: string; value: string; bad?: boolean }[] = [
    { label: t('Closed'), value: String(r.closed) },
    { label: t('Open now'), value: String(r.openNow) },
    { label: t('To close (avg)'), value: mins(r.avgCloseMin) },
    { label: t('Missed deadline'), value: r.slaTracked ? `${r.slaMissed} / ${r.slaTracked}` : '-', bad: r.slaMissed > 0 },
    { label: t('Rating'), value: r.avgRating != null ? `${r.avgRating}★` : '-' },
    { label: t('Km'), value: r.km == null ? t('Not tracked') : String(r.km) },
  ];

  return (
    <Card style={{ gap: space.sm }}>
      <Text weight="semibold">{t('My work this month')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm }}>
        {cells.map((x) => (
          <View key={x.label} style={{ width: '33.3%' }}>
            <Text variant="micro" color={c.inkSoft}>{x.label}</Text>
            <Text weight="bold" color={x.bad ? c.danger : c.ink}>{x.value}</Text>
          </View>
        ))}
      </View>
      {last && (
        <Text variant="micro" color={c.inkSoft}>
          {t('Last month')}: {last.closed} {t('closed')} · {mins(last.avgCloseMin)} {t('to close')}
        </Text>
      )}
    </Card>
  );
}
