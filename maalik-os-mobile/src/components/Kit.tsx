import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/I18nProvider';
import { Screen, Text } from './ui';
import { OfflineBar } from './OfflineBar';
import { Icon, type IconName } from './Icon';
import { radius, space } from '@/theme/tokens';
import { ApiError } from '@/lib/api';

/**
 * The pieces every job screen is built from - one header, one list row, one
 * status pill - so the technician, store and sales screens read as one app.
 */

/** Phone width stays as it was; a tablet gets a centred column instead of 1000px-wide rows (13 Oct 2026, audit). */
const COLUMN = { width: '100%', maxWidth: 720, alignSelf: 'center' } as const;

/**
 * `list` draws long lists with FlatList - only the rows on screen exist, so a
 * 200-customer list opens and scrolls smoothly on a cheap phone (13 Oct 2026,
 * audit). `children` become the list's header (search, chips, banners), so a
 * screen keeps its layout. The keyboard pushes the screen up instead of
 * covering the field and the footer's Save.
 */
export function SubScreen<T = unknown>({ title, subtitle, children, onRefresh, right, footer, list }: {
  title: string; subtitle?: string; children: ReactNode;
  onRefresh?: () => Promise<void>; right?: ReactNode; footer?: ReactNode;
  list?: { data: readonly T[]; key: (item: T) => string; render: (item: T) => ReactElement | null };
}) {
  const { c } = useTheme();
  const { t } = useT();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = onRefresh ? (
    <RefreshControl
      refreshing={refreshing}
      colors={[c.brand]}
      onRefresh={async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } }}
    />
  ) : undefined;
  const content = { padding: space.lg, gap: space.md, paddingBottom: space.xxxl, ...COLUMN };
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md }, COLUMN]}>
        <Pressable
          accessibilityRole="button" accessibilityLabel={t('Back')} hitSlop={12}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}
        >
          <Icon name="arrowLeft" size={20} color={c.ink} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="h3" weight="bold" numberOfLines={1}>{title}</Text>
          {subtitle ? <Text variant="small" color={c.inkSoft} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {list ? (
          <FlatList
            data={list.data}
            keyExtractor={list.key}
            renderItem={({ item }) => list.render(item)}
            ListHeaderComponent={<View style={{ gap: space.md, marginBottom: list.data.length ? space.md : 0 }}><OfflineBar />{children}</View>}
            ItemSeparatorComponent={Gap}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxxl, ...COLUMN }}
            initialNumToRender={12}
            windowSize={7}
            refreshControl={refresh}
          />
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={content} refreshControl={refresh}>
            <OfflineBar />
            {children}
          </ScrollView>
        )}
        {footer ? <View style={{ padding: space.lg, borderTopWidth: 1, borderColor: c.line, backgroundColor: c.bg }}><View style={COLUMN}>{footer}</View></View> : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Gap() {
  return <View style={{ height: space.md }} />;
}

export function Row({ title, line, meta, icon, onPress, right }: {
  title: string; line?: string | null; meta?: string | null; icon?: IconName; onPress?: () => void; right?: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg,
        borderRadius: radius.lg, borderWidth: 1, borderColor: c.line,
        backgroundColor: pressed ? c.brandSoft : c.surface,
      })}
    >
      {icon && (
        <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={20} color={c.brand} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="semibold" numberOfLines={1}>{title}</Text>
        {line ? <Text variant="small" color={c.inkSoft} numberOfLines={2}>{line}</Text> : null}
        {meta ? <Text variant="micro" color={c.muted} numberOfLines={1}>{meta}</Text> : null}
      </View>
      {right}
      {onPress && !right ? <Icon name="arrowRight" size={18} color={c.muted} /> : null}
    </Pressable>
  );
}

export type PillTone = 'brand' | 'success' | 'warning' | 'danger' | 'neutral';

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: PillTone }) {
  const { c } = useTheme();
  const map: Record<PillTone, [string, string]> = {
    brand: [c.brandSoft, c.brand], success: [c.successSoft, c.success], warning: [c.warningSoft, c.warning],
    danger: [c.dangerSoft, c.danger], neutral: [c.line, c.inkSoft],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: bg, alignSelf: 'flex-start' }}>
      <Text variant="micro" weight="semibold" color={fg}>{label}</Text>
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  const { c } = useTheme();
  return (
    <Text variant="small" weight="semibold" color={c.inkSoft} style={{ marginTop: space.sm, textTransform: 'uppercase', letterSpacing: 1 }}>
      {children}
    </Text>
  );
}

export function Empty({ icon, title, line }: { icon: IconName; title: string; line?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.xxxl }}>
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={26} color={c.inkSoft} />
      </View>
      <Text weight="semibold" align="center">{title}</Text>
      {line ? <Text variant="small" color={c.inkSoft} align="center">{line}</Text> : null}
    </View>
  );
}

export function Segmented<K extends string>({ value, options, onChange }: {
  value: K; options: { key: K; label: string }[]; onChange: (k: K) => void;
}) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', padding: 4, borderRadius: radius.md, backgroundColor: c.line, gap: 4 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key} accessibilityRole="button" accessibilityState={{ selected: on }}
            onPress={() => onChange(o.key)}
            style={{ flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center', backgroundColor: on ? c.surface : 'transparent' }}
          >
            <Text variant="small" weight={on ? 'semibold' : 'medium'} color={on ? c.ink : c.inkSoft}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Load something on open and on pull-to-refresh; errors become one sentence. */
/**
 * Load a screen's data. `everyMs` refreshes it silently (no spinner, no error
 * flash if one refresh fails) while the screen is in front and the app is
 * open - Pravin, 28 Sep 2026: "things change without pulling to refresh".
 */
export function useLoad<T>(load: () => Promise<T | null>, opts: { everyMs?: number } = {}) {
  const { t } = useT();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);
  const reload = useCallback(async (silent = false) => {
    if (silent && busy.current) return;
    busy.current = true;
    try {
      const d = await load();
      if (d === null) { router.replace('/welcome'); return; }
      setData(d);
      setError(null);
    } catch (e) {
      if (!silent) setError(e instanceof ApiError ? t(e.message) : t('Could not reach the server. Check the connection and try again.'));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [load, t]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- an async load; state is set when it resolves
  useEffect(() => { void reload(); }, [reload]);
  const every = opts.everyMs ?? 0;
  useFocusEffect(useCallback(() => {
    if (!every) return undefined;
    const timer = setInterval(() => { if (AppState.currentState === 'active') void reload(true); }, every);
    return () => clearInterval(timer);
  }, [every, reload]));
  const loud = useCallback(() => reload(false), [reload]);
  return { data, setData, error, loading, reload: loud };
}

export function Loading() {
  const { c } = useTheme();
  return <View style={{ paddingVertical: space.xxxl }}><ActivityIndicator color={c.brand} /></View>;
}

export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
export const fmtDateTime = (d: string | Date) =>
  new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const rupees = (paise: number) =>
  `₹ ${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
