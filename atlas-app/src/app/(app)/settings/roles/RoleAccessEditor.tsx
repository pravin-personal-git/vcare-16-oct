'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Layout';
import { Icon } from '@/components/ui/Icon';
import { canOpenRoute } from '@/lib/route-access';
import {
  LEVEL_LABEL, ROLE_MODULES, allKeysOf, applyKeys, applyModule, levelsOf, moduleState,
  type ModuleLevel, type RoleModule,
} from '@/lib/role-modules';
import { actionByKey } from '@/lib/action-registry';
import type { MenuOption, PermissionOption } from '@/server/roles';
import { isExcluded, isPageOff, moduleOfRoleModule } from '@/lib/modules';

/**
 * What a role can do and see, as one grid (27 Sep 2026, streamline S3) -
 * replaces the two lists (Permissions, Menu access) that had to agree by
 * hand. Left: one row per module with a level. Right: the side menu this
 * role will actually get, live. The menu follows the levels; a page the role
 * may open can still be hidden from its menu (Advanced).
 */
export function RoleAccessEditor({
  permissions, menus: allMenus, keys, setKeys, hidden, setHidden,
  excludedModules = [], excludedPages = [],
}: {
  permissions: PermissionOption[];
  menus: MenuOption[];
  keys: Set<string>;
  setKeys: (next: Set<string>) => void;
  /** Menu ids the role may open but should not see in its menu. */
  hidden: Set<string>;
  setHidden: (next: Set<string>) => void;
  /**
   * Modules the platform switched off for this business (F-01). Their rows and
   * pages are not offered: granting them would do nothing. Permissions a role
   * already holds for them are kept as they are, in case the module returns.
   */
  excludedModules?: string[];
  /**
   * Individual pages the platform switched off (F-01, 10 Oct 2026). Same
   * reasoning as the modules above, one level down: a page nobody in this
   * business can open is not offered in a role's menu either.
   */
  excludedPages?: string[];
}) {
  const [showHide, setShowHide] = useState(hidden.size > 0);
  /**
   * Which modules have their button list open (10 Oct 2026). Opened by hand,
   * and opened for you when the role already holds a mix no level describes -
   * the old editor called that "custom" and gave you nowhere to look.
   */
  const [openActions, setOpenActions] = useState<Set<string>>(new Set());
  const off = useMemo(() => new Set(excludedModules), [excludedModules]);
  const offPages = useMemo(() => new Set(excludedPages), [excludedPages]);
  const menus = useMemo(
    () => allMenus.filter((m) => !isPageOff(m.route, off, offPages)),
    [allMenus, off, offPages],
  );
  const known = useMemo(() => new Set(permissions.map((p) => p.key)), [permissions]);
  const modules = useMemo(() => ROLE_MODULES.filter((m) =>
    [...m.view, ...m.edit].some((k) => known.has(k)) && !isExcluded(moduleOfRoleModule(m.key), off)), [known, off]);
  const groups = useMemo(() => [...new Set(modules.map((m) => m.group))], [modules]);

  /** One button on or off, leaving the rest of the module exactly as it is. */
  const setOne = (m: RoleModule, key: string, on: boolean) => {
    const exact = new Set(allKeysOf(m).filter((k) => keys.has(k)));
    if (on) exact.add(key); else exact.delete(key);
    setKeys(applyKeys(keys, m, exact));
  };

  const set = (m: RoleModule, patch: Partial<{ level: ModuleLevel; delete: boolean; extras: Record<string, boolean> }>) => {
    const cur = moduleState(m, keys);
    setKeys(applyModule(keys, m, {
      level: patch.level ?? cur.level,
      delete: patch.delete ?? cur.delete,
      extras: { ...cur.extras, ...(patch.extras ?? {}) },
    }));
  };

  // The side menu this role gets: pages its levels open, minus hidden ones.
  const openable = (m: MenuOption) => !!m.route && canOpenRoute(m.route, keys);
  const roots = menus.filter((m) => !m.parentId);
  const kids = (id: string) => menus.filter((m) => m.parentId === id);
  const shown = (m: MenuOption): boolean => (openable(m) && !hidden.has(m.id)) || kids(m.id).some(shown);
  const openablePages = menus.filter(openable);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
      <div className="overflow-hidden rounded-lg border border-border">
        {(off.size > 0 || offPages.size > 0) && (
          <p className="border-b border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
            Not in this business&apos;s plan, so not shown:{' '}
            {[
              ...off,
              /* Pages switched off one at a time (F-01, 10 Oct 2026). Counted
                 rather than listed - naming a route to whoever is setting up a
                 role tells them nothing, and the row is simply absent. */
              ...(offPages.size > 0 ? [`${offPages.size} ${offPages.size === 1 ? 'page' : 'pages'}`] : []),
            ].join(', ')}. To add something, ask your Atlas provider.
          </p>
        )}
        <div className="max-h-[28rem] overflow-y-auto">
          {groups.map((g) => (
            <div key={g}>
              <p className="sticky top-0 z-10 border-b border-border bg-muted px-3 py-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">{g}</p>
              {modules.filter((m) => m.group === g).map((m) => {
                const st = moduleState(m, keys);
                const mine = allKeysOf(m).filter((k) => known.has(k));
                const granted = mine.filter((k) => keys.has(k));
                // A role that already holds an odd mix is shown it, unasked.
                const showButtons = openActions.has(m.key) || st.custom;
                return (
                  <div key={m.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2 last:border-0">
                    <div className="min-w-[9rem] flex-1">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {m.label}
                        {st.custom && (
                          <span title="This role holds an unusual mix of this module's permissions. Choosing a level replaces it.">
                            <Badge tone="warning">custom</Badge>
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">{m.hint}</p>
                    </div>
                    <div role="radiogroup" aria-label={`${m.label} access`} className="flex overflow-hidden rounded-lg border border-border">
                      {levelsOf(m).map((l) => (
                        <button key={l} type="button" role="radio" aria-checked={st.level === l && !st.custom}
                          onClick={() => set(m, { level: l })}
                          className={`px-2.5 py-1 text-xs transition ${st.level === l
                            ? l === 'none' ? 'bg-muted font-semibold' : 'bg-brand font-semibold text-white'
                            : 'hover:bg-muted'}`}>
                          {LEVEL_LABEL[l]}
                        </button>
                      ))}
                    </div>
                    {((m.delete?.length ?? 0) > 0 || (m.extras?.length ?? 0) > 0) && (
                      <div className="flex w-full flex-wrap gap-x-4 gap-y-1 ps-0.5">
                        {(m.delete?.length ?? 0) > 0 && (
                          <label className={`flex items-center gap-1.5 text-xs ${st.level === 'none' ? 'opacity-50' : ''}`}>
                            <input type="checkbox" disabled={st.level === 'none'} checked={st.delete} onChange={(e) => set(m, { delete: e.target.checked })} />
                            Can delete
                          </label>
                        )}
                        {(m.extras ?? []).filter((x) => known.has(x.key)).map((x) => (
                          <label key={x.key} className="flex items-center gap-1.5 text-xs">
                            <input type="checkbox" checked={!!st.extras[x.key]} onChange={(e) => set(m, { extras: { [x.key]: e.target.checked } })} />
                            {x.label}
                          </label>
                        ))}
                      </div>
                    )}

                    {/*
                      ONE BUTTON AT A TIME (10 Oct 2026).

                      The four levels above are presets, and a preset is a
                      bundle: Edit on Invoices is raise AND change AND see our
                      cost, because that is what the bundle says. Pravin wanted
                      the level underneath - "har button ko specific user role
                      ko hi de paye aur dikhayein" - so every key the module
                      owns is also a tick of its own, named as the button it
                      unlocks and told where that button is (lib/action-
                      registry). Ticking one leaves the rest of the module
                      alone; if the result matches no level, the row says
                      "custom", which is now a description and not a warning.
                    */}
                    {mine.length > 0 && (
                      <div className="w-full">
                        <button
                          type="button"
                          onClick={() => {
                            const next = new Set(openActions);
                            if (next.has(m.key)) next.delete(m.key); else next.add(m.key);
                            setOpenActions(next);
                          }}
                          className="flex items-center gap-1 text-micro text-muted-foreground hover:text-foreground"
                        >
                          <Icon name={showButtons ? 'chevron-up' : 'chevron-down'} className="h-3.5 w-3.5" />
                          Each button separately
                          <span className="text-muted-foreground">
                            ({granted.length} of {mine.length} on)
                          </span>
                        </button>
                        {showButtons && (
                          <div className="mt-1.5 grid gap-1 rounded-md border border-border bg-muted/30 p-2">
                            {mine.map((k) => {
                              const a = actionByKey(k);
                              return (
                                <label key={k} className="flex items-start gap-2 text-xs">
                                  <input
                                    type="checkbox" className="mt-0.5"
                                    checked={keys.has(k)}
                                    onChange={(e) => setOne(m, k, e.target.checked)}
                                  />
                                  <span>
                                    <span className="font-medium">{a?.label ?? k}</span>
                                    {a?.sensitive && (
                                      <span className="ms-1.5 align-middle"><Badge tone="warning">careful</Badge></span>
                                    )}
                                    <span className="block text-micro text-muted-foreground">
                                      {a?.where ?? k}
                                      {a?.hint ? ` - ${a.hint}` : ''}
                                    </span>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="grid content-start gap-3">
        <div className="rounded-lg border border-border p-3">
          <p className="mb-1 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground">
            <Icon name="eye" className="h-3.5 w-3.5" /> Their side menu
          </p>
          <p className="mb-2 text-xs text-muted-foreground">Follows the levels on the left. My Desk, Dashboard and their own things are always there.</p>
          <ul className="max-h-[18rem] overflow-y-auto text-xs">
            {roots.filter(shown).map((r) => (
              <li key={r.id} className="py-0.5">
                <span className="font-medium">{r.label}</span>
                {kids(r.id).filter(shown).length > 0 && (
                  <ul className="ms-3 border-s border-border ps-2 text-muted-foreground">
                    {kids(r.id).filter(shown).map((k) => (
                      <li key={k.id}>{k.label}{kids(k.id).filter(shown).length > 0 ? ` (${kids(k.id).filter(shown).length})` : ''}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border p-3">
          <button type="button" onClick={() => setShowHide(!showHide)} className="flex w-full items-center justify-between text-xs font-medium">
            Advanced: hide pages from the menu {hidden.size > 0 && <Badge tone="neutral">{hidden.size} hidden</Badge>}
            <Icon name={showHide ? 'chevron-up' : 'chevron-down'} className="h-4 w-4" />
          </button>
          {showHide && (
            <div className="mt-2 grid max-h-[14rem] gap-1 overflow-y-auto">
              <p className="text-xs text-muted-foreground">Unticked pages stay allowed (a link still works) but are not shown in the menu.</p>
              {openablePages.map((m) => (
                <label key={m.id} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={!hidden.has(m.id)} onChange={(e) => {
                    const next = new Set(hidden);
                    if (e.target.checked) next.delete(m.id); else next.add(m.id);
                    setHidden(next);
                  }} />
                  {m.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
