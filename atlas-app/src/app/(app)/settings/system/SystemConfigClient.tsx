'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Badge, Card, PageHeader, type BadgeTone } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Toolbar, FilterChip } from '@/components/ui/Toolbar';
import {
  CONFIG_CARDS, SCOPE_LABEL, STATUS_LABEL,
  type ConfigCard, type ConfigStatus,
} from './config-catalogue';

const TONE_TINT: Record<ConfigCard['tone'], string> = {
  brand: 'bg-brand/10 text-on-tint-brand',
  navy: 'bg-navy/10 text-on-tint-navy',
  success: 'bg-success/10 text-on-tint-success',
  warning: 'bg-warning/15 text-on-tint-warning',
  danger: 'bg-danger/10 text-on-tint-danger',
  info: 'bg-info/10 text-on-tint-info',
  accent: 'bg-accent/15 text-accent',
};

const STATUS_TONE: Record<ConfigStatus, BadgeTone> = {
  built: 'success',
  partial: 'warning',
  not_built: 'neutral',
};

const GROUPS = ['Integrations', 'Documents', 'Financial', 'Organisation', 'Legal'] as const;

/**
 * System Configuration.
 *
 * Sixteen cards, matching the reference app's grid and its scope badges. Each
 * carries an honest status: what works, what half-works, and what is waiting on
 * which backlog item.
 *
 * The status is the point. A settings screen offering sixteen integrations and
 * delivering two is how a demo turns into a complaint two weeks later - so the
 * card says so on its face, and the drawer says why.
 */
export function SystemConfigClient({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState<ConfigCard | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ConfigStatus | null>(null);

  const counts = useMemo(() => ({
    built: CONFIG_CARDS.filter((c) => c.status === 'built').length,
    partial: CONFIG_CARDS.filter((c) => c.status === 'partial').length,
    not_built: CONFIG_CARDS.filter((c) => c.status === 'not_built').length,
  }), []);

  const q = search.trim().toLowerCase();
  const visible = CONFIG_CARDS.filter(
    (c) =>
      (!status || c.status === status)
      && (!q || `${c.title} ${c.blurb} ${c.detail}`.toLowerCase().includes(q)),
  );

  return (
    <div>
      <PageHeader
        badge="SY"
        title="System Configuration"
        subtitle="Manage integrations and system-level settings"
        actions={
          <Badge tone={counts.built + counts.partial > 0 ? 'warning' : 'neutral'}>
            {counts.partial} partly working · {counts.not_built} not built
          </Badge>
        }
      />

      <Card className="mb-3 flex items-start gap-2.5 border-info/25 bg-info/[0.05] p-3">
        <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <div className="text-xs text-foreground">
          <p className="font-semibold">Every card is here; several are still not wired up.</p>
          <p className="mt-0.5 text-muted-foreground">
            This screen mirrors the reference app so the shape of the settings
            surface is settled early. Each card states plainly whether it works,
            and what it is waiting on - open one to see the detail. A card
            marked Working links straight to where that setting actually lives;
            this screen itself is a directory, not the settings form.
          </p>
        </div>
      </Card>

      <Toolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search a setting…"
        count={`Total (${visible.length})`}
        filters={
          <>
            {(['partial', 'not_built'] as ConfigStatus[]).map((s) => (
              <FilterChip
                key={s}
                label={STATUS_LABEL[s]}
                count={counts[s]}
                icon={s === 'partial' ? 'clock' : 'ban'}
                active={status === s}
                onClick={() => setStatus((v) => (v === s ? null : s))}
              />
            ))}
          </>
        }
      />

      {GROUPS.map((group) => {
        const cards = visible.filter((c) => c.group === group);
        if (cards.length === 0) return null;

        return (
          <section key={group} className="mb-6">
            <div className="mb-2 flex items-center gap-3">
              <h2 className="text-micro font-bold uppercase tracking-widest text-muted-foreground">
                {group}
              </h2>
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">{cards.length}</span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {cards.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setOpen(c)}
                  className="group relative flex flex-col rounded-lg border border-border bg-card p-4 text-center shadow-card transition hover:-translate-y-px hover:shadow-raised"
                >
                  {c.scope && (
                    <span className="absolute end-2 top-2">
                      <Badge tone={c.scope === 'super_admin' ? 'danger' : c.scope === 'mobile' ? 'navy' : 'info'}>
                        {SCOPE_LABEL[c.scope]}
                      </Badge>
                    </span>
                  )}

                  <span className={`mx-auto grid h-12 w-12 place-items-center rounded-full ${TONE_TINT[c.tone]}`}>
                    <Icon name={c.icon} className="h-5 w-5" />
                  </span>

                  <p className="mt-3 text-sm font-semibold">{c.title}</p>
                  <p className="mt-1 flex-1 text-xs leading-relaxed text-muted-foreground">
                    {c.blurb}
                  </p>

                  <span className="mt-3 flex items-center justify-center gap-1.5 border-t border-border pt-2.5 text-xs font-medium text-brand">
                    <Icon name="settings" className="h-3.5 w-3.5" />
                    Configure
                  </span>

                  <span className="absolute start-2 top-2">
                    <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      {visible.length === 0 && (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">Nothing matches that search.</p>
        </Card>
      )}

      {open && (
        <Modal
          title={open.title}
          subtitle={open.blurb}
          icon={open.icon}
          tone={open.status === 'built' ? 'brand' : 'navy'}
          size="sm"
          onClose={() => setOpen(null)}
          footer={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[open.status]}>{STATUS_LABEL[open.status]}</Badge>
              {open.blockedBy && <Badge tone="neutral">Waiting on {open.blockedBy}</Badge>}
              <div className="ms-auto flex gap-2">
                <Button variant="outline" icon="x" onClick={() => setOpen(null)}>Close</Button>
                {open.href ? (
                  <Link
                    href={open.href}
                    className="inline-flex h-9 items-center gap-2 rounded bg-brand px-3 text-sm font-medium text-brand-fg shadow-card transition hover:bg-brand-hover"
                  >
                    <Icon name="arrow-up-right" className="h-4 w-4" />
                    Where it lives now
                  </Link>
                ) : (
                  <Button
                    variant="primary" icon="settings"
                    disabled={!canEdit || open.status === 'not_built'}
                    title={
                      open.status === 'not_built'
                        ? 'Not built yet'
                        : canEdit ? undefined : 'Needs the settings.edit permission'
                    }
                  >
                    Configure
                  </Button>
                )}
              </div>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-card p-3">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${TONE_TINT[open.tone]}`}>
                <Icon name={open.icon} className="h-4 w-4" />
              </span>
              <p className="text-sm leading-relaxed">{open.detail}</p>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-border bg-card p-2.5">
                <dt className="text-micro font-semibold uppercase text-muted-foreground">Group</dt>
                <dd className="mt-0.5 font-medium">{open.group}</dd>
              </div>
              <div className="rounded-lg border border-border bg-card p-2.5">
                <dt className="text-micro font-semibold uppercase text-muted-foreground">Visible to</dt>
                <dd className="mt-0.5 font-medium">
                  {open.scope ? SCOPE_LABEL[open.scope] : 'Store admin'}
                </dd>
              </div>
            </dl>
          </div>
        </Modal>
      )}
    </div>
  );
}
