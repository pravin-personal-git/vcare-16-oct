'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader, Card, EmptyState } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import {
  SETTINGS_SECTIONS, SECTION_LABEL, SECTION_HINT, SECTION_ICON, SECTION_GROUPS, SECTION_WHEN,
  searchSettings, type SettingsEntry, type SettingsSection,
} from '@/lib/settings-registry';

/**
 * Settings - the one door to every setting (rebuilt 5 Oct 2026).
 *
 * Since that day nothing that is a setting appears in the sidebar
 * (lib/settings-only-routes), so this page has to carry all of it, plainly:
 *
 * - EIGHT NUMBERED STEPS, joined by a line, in the order a new client sets
 *   Atlas up - each one leans on the one before.
 * - Each step says what it decides and when it is usually done; each screen
 *   says in a line what it decides, so nobody opens a screen to find out
 *   whether it was the one they wanted.
 * - Set / Not yet beside a screen when that can be told from the data
 *   (server/settings-status), and a progress bar for the whole setup.
 * - Search uses the same matcher as the top bar, so the two cannot disagree.
 *
 * GENERATED FROM THE REGISTRY, NOT HAND-WRITTEN: a screen added without a
 * registry entry fails the coverage test instead of going missing here.
 */

/** Each step's own colour, for the number and the icon dots. Tokens only. */
const TONE: Record<SettingsSection, { solid: string; soft: string; text: string }> = {
  business: { solid: 'bg-brand', soft: 'bg-brand/10', text: 'text-brand' },
  money: { solid: 'bg-success', soft: 'bg-success/10', text: 'text-success' },
  selling: { solid: 'bg-navy', soft: 'bg-navy/10', text: 'text-navy' },
  documents: { solid: 'bg-warning', soft: 'bg-warning/10', text: 'text-warning' },
  people: { solid: 'bg-info', soft: 'bg-info/10', text: 'text-info' },
  attendance: { solid: 'bg-brand', soft: 'bg-brand/10', text: 'text-brand' },
  devices: { solid: 'bg-success', soft: 'bg-success/10', text: 'text-success' },
  system: { solid: 'bg-navy', soft: 'bg-navy/10', text: 'text-navy' },
};

export function HubClient({ entries, status }: { entries: SettingsEntry[]; status: Record<string, boolean> }) {
  const [q, setQ] = useState('');
  const allowed = useMemo(() => new Set(entries.map((e) => e.key)), [entries]);

  const matches = useMemo(() => {
    if (q.trim().length < 2) return null;
    return searchSettings(q).filter((e) => allowed.has(e.key));
  }, [q, allowed]);

  const sections = SETTINGS_SECTIONS
    .map((s) => ({ section: s, items: entries.filter((e) => e.section === s) }))
    .filter((g) => g.items.length > 0);

  // Progress counts only what can be told from data.
  const tracked = entries.filter((e) => e.key in status);
  const done = tracked.filter((e) => status[e.key]).length;
  const pct = tracked.length ? Math.round((done / tracked.length) * 100) : 0;

  return (
    <>
      <PageHeader
        badge="SET"
        title="Settings"
        subtitle="Every setting in Atlas, in one place, in the order you set them up"
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative min-w-[14rem] flex-1">
            <Icon
              name="search"
              className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="What do you want to change? Try GST, logo, courier, approval, lost phone…"
              aria-label="Search settings"
              className="h-10 w-full rounded-md border border-border bg-background ps-9 pe-3 text-sm outline-none focus:border-brand"
            />
          </div>
          {tracked.length > 0 && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Setup</span>
              <div className="h-2 w-40 overflow-hidden rounded-full bg-muted" role="progressbar"
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Setup complete">
                <div className="h-full bg-success" style={{ width: `${pct}%` }} />
              </div>
              <span className="font-semibold tabular-nums">{done} / {tracked.length}</span>
            </div>
          )}
        </div>
        {!matches && (
          <nav aria-label="Jump to a step" className="mt-3 flex flex-wrap gap-1.5">
            {sections.map(({ section }, i) => (
              <a key={section} href={`#step-${section}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-brand hover:text-brand">
                <span className={`font-bold ${TONE[section].text}`}>{i + 1}</span>
                {SECTION_LABEL[section]}
              </a>
            ))}
          </nav>
        )}
      </Card>

      {matches !== null ? (
        matches.length === 0 ? (
          <EmptyState
            icon="search"
            title="Nothing matches"
            hint="Try the word you would use for it - the search looks at what each setting does, not only its name."
          />
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="grid sm:grid-cols-2">
              {matches.map((e) => <EntryRow key={e.key} entry={e} status={status[e.key]} showSection />)}
            </div>
          </Card>
        )
      ) : (
        <ol className="grid gap-4">
          {sections.map(({ section, items }, i) => (
            <Step key={section} n={i + 1} last={i === sections.length - 1} section={section} items={items} status={status} />
          ))}
        </ol>
      )}

      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        Settings open only from here. Screens you use every day - Employees, Leave Types &amp; Allocation,
        the incentive report - stay in the menu. Set / Not yet is shown where Atlas can tell from your data
        whether something has been filled in.
      </p>
    </>
  );
}

/**
 * One numbered step. The line down the left joins it to the next, so the page
 * reads as an order, not a pile of boxes.
 */
function Step({ n, last, section, items, status }: {
  n: number; last: boolean; section: SettingsSection; items: SettingsEntry[]; status: Record<string, boolean>;
}) {
  const tone = TONE[section];
  const groups = SECTION_GROUPS[section]
    .map((g) => ({ group: g, items: items.filter((e) => e.group === g) }))
    .filter((g) => g.items.length > 0);
  const tracked = items.filter((e) => e.key in status);
  const done = tracked.filter((e) => status[e.key]).length;

  return (
    <li id={`step-${section}`} className="relative grid scroll-mt-20 grid-cols-[2.75rem_1fr] gap-3">
      <div className="relative flex justify-center">
        <span className={`z-[1] grid h-10 w-10 place-items-center rounded-xl text-base font-bold text-white shadow-card ${tone.solid}`}>
          {n}
        </span>
        {!last && <span aria-hidden className="absolute top-11 -bottom-4 w-0.5 bg-border" />}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tone.soft} ${tone.text}`}>
            <Icon name={SECTION_ICON[section]} className="h-5 w-5" />
          </span>
          <div className="min-w-[12rem] flex-1">
            <h2 className="text-base font-semibold">{SECTION_LABEL[section]}</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">{SECTION_HINT[section]}</p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-micro font-semibold text-muted-foreground">
            {SECTION_WHEN[section]}{tracked.length > 0 ? ` · ${done}/${tracked.length} set` : ''}
          </span>
        </div>

        {groups.map(({ group, items: inGroup }) => (
          <div key={group}>
            {/* One group in a step needs no sub-heading - it would only repeat the step. */}
            {groups.length > 1 && (
              <h3 className="border-b border-border bg-muted/30 px-4 py-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </h3>
            )}
            <div className="grid sm:grid-cols-2">
              {inGroup.map((e) => <EntryRow key={e.key} entry={e} status={status[e.key]} tone={tone} />)}
            </div>
          </div>
        ))}
      </Card>
    </li>
  );
}

function EntryRow({ entry, status, tone, showSection = false }: {
  entry: SettingsEntry;
  status: boolean | undefined;
  tone?: { soft: string; text: string };
  showSection?: boolean;
}) {
  const t = tone ?? TONE[entry.section];
  return (
    <Link
      href={entry.route}
      className="group flex items-start gap-3 border-b border-border px-4 py-3 transition hover:bg-muted/40 sm:odd:border-e"
    >
      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md ${t.soft} ${t.text}`}>
        <Icon name="chevron-right" className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold group-hover:text-brand">
          {entry.label}
          {status === true && (
            <span className="rounded bg-success/10 px-1.5 text-micro font-semibold text-on-tint-success">Set</span>
          )}
          {status === false && (
            <span className="rounded bg-warning/10 px-1.5 text-micro font-semibold text-on-tint-warning">Not yet</span>
          )}
        </span>
        {/* The hint is the point of the row: it answers "is this the one?"
            without spending a click to find out. */}
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{entry.hint}</span>
        {showSection && (
          <span className="mt-1 block text-micro font-medium text-muted-foreground">
            {SECTION_LABEL[entry.section]} › {entry.group}
          </span>
        )}
      </span>
    </Link>
  );
}
