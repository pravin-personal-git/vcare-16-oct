import { useCallback, useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { HomeFrame } from '@/components/HomeFrame';
import { UpdateBanner } from '@/components/UpdateBanner';
import { Card, Text } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';
import { Pill, Row, SectionLabel, fmtDate, rupees, useLoad } from '@/components/Kit';
import { customerHome, CUSTOMER_STATUS_LABEL, statusTone } from '@/lib/jobs';
import { loadSession } from '@/lib/session';
import { font, radius, space } from '@/theme/tokens';

/** The customer home: what is open, what is due, and the three things they come to do. */
export default function CustomerHome() {
  const { c } = useTheme();
  const { t } = useT();
  const { data } = useLoad(useCallback(() => customerHome(), []));

  // A temporary password from the business must be replaced first.
  useEffect(() => { loadSession().then((s) => { if (s?.mustReset) router.replace('/customer/password?first=1'); }); }, []);

  return (
    <HomeFrame kind="party" roleLine={data ? `${data.business.name} · ${data.business.branch}` : t('Customer account')}>
      {() => (
        <>
          <UpdateBanner />
          {data && (
            <View style={{ flexDirection: 'row', gap: space.md }}>
              <Stat label={t('Open complaints')} value={String(data.summary.openComplaints)} />
              <Stat label={t('Amount due')} value={rupees(data.summary.totalDuePaise)} tone={data.summary.totalDuePaise > 0 ? c.warning : undefined} />
            </View>
          )}
          {/* The shop first (3 Oct 2026): existing customers were never shown the
              catalogue at all, which was Pravin's point after the live review. */}
          <Action icon="box" title={t('Shop')} line={t('Browse, make a list, get a quote.')} onPress={() => router.push('/customer/shop')} />
          <Action icon="wrench" title={t('Raise a complaint')} line={t('Something wrong with a purchase? Tell us here.')} onPress={() => router.push('/customer/raise')} />
          <Action icon="calendar" title={t('Request a service visit')} line={t('A technician comes to your site.')} onPress={() => router.push('/customer/raise?kind=visit')} />
          <Action icon="file" title={t('My bills')} line={t('Invoices and what is due.')} onPress={() => router.push('/customer/invoices')} />
          <Action icon="lock" title={t('Change password')} line={t('Keep your account safe.')} onPress={() => router.push('/customer/password')} />

          {data && data.recentComplaints.length > 0 && (
            <>
              <SectionLabel>{t('My complaints')}</SectionLabel>
              {data.recentComplaints.map((cm) => (
                <Row
                  key={cm.id}
                  title={cm.productName ?? cm.complaintNo}
                  line={cm.description}
                  meta={`${cm.complaintNo} · ${fmtDate(cm.createdAt)}`}
                  onPress={() => router.push({ pathname: '/customer/complaint/[id]', params: { id: cm.id } })}
                  right={<Pill label={t(CUSTOMER_STATUS_LABEL[cm.status] ?? cm.status)} tone={statusTone(cm.status)} />}
                />
              ))}
            </>
          )}
        </>
      )}
    </HomeFrame>
  );

  function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
    return (
      <Card style={{ flex: 1, gap: 2, padding: space.lg }}>
        <Text variant="micro" color={c.inkSoft} style={{ textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</Text>
        <Text style={{ fontFamily: font.brand, fontSize: 24, lineHeight: 30 }} color={tone ?? c.ink}>{value}</Text>
      </Card>
    );
  }

  function Action({ icon, title, line, onPress }: { icon: IconName; title: string; line: string; onPress: () => void }) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress}>
        {({ pressed }) => (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg, backgroundColor: pressed ? c.brandSoft : c.surface }}>
            <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={icon} size={24} color={c.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text weight="semibold">{title}</Text>
              <Text variant="small" color={c.inkSoft}>{line}</Text>
            </View>
            <Icon name="arrowRight" size={20} color={c.muted} />
          </Card>
        )}
      </Pressable>
    );
  }
}
