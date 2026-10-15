'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import type { MenuNode } from '@/server/context';
import { Icon, type IconName } from '@/components/ui/Icon';
import { translateLabel } from '@/i18n/ui-translations';
import { useMobileNav } from './MobileNav';
import { DIcon } from '@/app/(app)/dashboard/kit';

/**
 * The navigation rail.
 *
 * Seventeen menu groups is a lot, so the sidebar earns its width three ways:
 * a filter that searches group and child labels together, groups that stay
 * collapsed until needed, and an active state that marks both the child and
 * the group it lives in - otherwise a collapsed group gives no clue that the
 * current page is inside it.
 *
 * Icons are mapped from labels rather than stored on the menu row. The menu
 * tree is tenant-editable, and asking a client's admin to pick an icon name
 * from a list they cannot see is a worse problem than a sensible default.
 *
 * ON A PHONE IT IS A DRAWER, NOT A RAIL.
 *
 * This used to render at `w-14` or `w-60` at every screen size, with no
 * breakpoint anywhere in the file. On a 360px handset the collapsed rail took
 * 56px permanently - about a sixth of the screen, spent on icons nobody can
 * read - and expanded it took 240px of 360px, leaving 120px for the actual
 * business. That is the real reason Atlas "felt off" on a phone: it was not a
 * mobile layout at all, it was the desktop one with the content squeezed into
 * whatever was left.
 *
 * Below `md` the rail is now hidden entirely and the same navigation opens as
 * an overlay drawer from the header's hamburger. The content area gets the
 * whole screen, which is the point.
 */

const ICON_BY_LABEL: Record<string, IconName> = {
  Dashboard: 'home',
  Sales: 'trending-up',
  Leads: 'user-plus',
  Customers: 'users',
  Quotation: 'file-text',
  'Sales Orders': 'shopping-cart',
  Invoices: 'receipt',
  'Sales Target': 'pie-chart',
  Inventory: 'box',
  Stock: 'box',
  Products: 'package',
  // The shop group (13 Oct 2026): Catalogue + Shop Requests. Had no icon, so
  // it showed the generic chevron.
  Catalogue: 'bag',
  'Shop Requests': 'bag',
  Suppliers: 'truck',
  /*
    Found by the menu review, 1 Oct 2026: two of the most-used groups had no
    icon at all and fell back to a generic chevron.

    THREE KEYS FOR ONE GROUP. It has been 'Services Call', then
    'Services & Complaints', and since 7 Oct 2026 'Customer Service'. The old
    keys stay: a tenant whose sidebar has not been renamed yet - a client on
    an older deploy, or one whose migration has not run - still gets its icon
    rather than a bare chevron. They cost two lines and they are the whole
    reason nobody notices a rename.
  */
  'Customer Service': 'alert-circle',
  'Services & Complaints': 'alert-circle',
  'Services Call': 'alert-circle',
  'My Desk': 'send',
  'Task Manager': 'check-circle',
  Attendance: 'calendar',
  Accounts: 'credit-card',
  'Office Expenses': 'receipt',
  'Returns & Refunds': 'rotate-ccw',
  Purchase: 'shopping-cart',
  HRM: 'users',
  'HRM Configurations': 'settings',
  'Financial Reports': 'bar-chart',
  'Common Hub': 'folder',
  'Users & Roles': 'user',
  'System Settings': 'settings',
  // The one door to every setting since 5 Oct 2026.
  Settings: 'settings',
  'My Target': 'trending-up',
  'Reference Data': 'sliders',
  'FAQ / Help': 'info',
  'Help & Handbook': 'info',
  'SOP Guidebook': 'file-text',
};

export const iconFor = (label: string): IconName => ICON_BY_LABEL[label] ?? 'chevron-right';

/** Recursive version of the label filter, applied at every depth - a group or row survives
 *  if its own label matches, or if anything inside it (after the same filter) survived. */
function filterMenu(nodes: MenuNode[], q: string): MenuNode[] {
  return nodes
    .map((n) => ({ ...n, children: filterMenu(n.children, q) }))
    .filter((n) => n.label.toLowerCase().includes(q) || n.children.length > 0);
}

/**
 * One row inside an accordion group - a plain link when it has no children of
 * its own, otherwise a nested accordion, recursing to whatever depth the menu
 * tree actually has. Single-section-open-at-a-time within this level: opening
 * one row closes whichever sibling (at any depth) was open, via the shared
 * `openChild` scalar rather than a per-row boolean.
 *
 * A NODE WITH BOTH A ROUTE AND CHILDREN IS A LINK *AND* A TOGGLE.
 *
 * Every menu parent used to have `route: null`, so "has children" and "is not
 * a destination" were the same thing and the whole row could be a button.
 * Goods Dispatch Note broke that: it is a real page that now also has
 * Complaint GDNs underneath it (1 Oct 2026). Making it a toggle would have
 * quietly cost one click on a page people use daily and, worse, left no way to
 * reach it at all. So the label stays a link and the chevron becomes its own
 * button - which is also the only reading of a row that is both.
 */
function NestedItem({
  node, pathname, openChild, toggleChild, t,
}: {
  node: MenuNode;
  pathname: string | null;
  openChild: Set<string>;
  toggleChild: (id: string) => void;
  t: (label: string) => string;
}) {
  if (node.children.length === 0) {
    return (
      <Link
        href={node.route ?? '#'}
        className={`block truncate rounded px-2.5 py-1.5 text-sm transition ${
          pathname === node.route
            ? 'bg-brand/10 font-semibold text-on-tint-brand'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        {t(node.label)}
      </Link>
    );
  }

  const isOpen = openChild.has(node.id);
  const active = containsActive(node, pathname);
  const rowClass = `flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-sm transition ${
    active && !isOpen
      ? 'bg-brand/[0.07] font-semibold text-on-tint-brand'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

  return (
    <div className="mb-0.5">
      {node.route ? (
        // Both a destination and a parent: the label navigates, the chevron opens.
        <div className={rowClass}>
          <Link
            href={node.route}
            className={`flex-1 truncate text-start ${pathname === node.route ? 'font-semibold text-brand' : ''}`}
          >
            {t(node.label)}
          </Link>
          <button
            type="button"
            onClick={() => toggleChild(node.id)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Hide' : 'Show'} ${t(node.label)} pages`}
            className="shrink-0 rounded p-0.5 hover:bg-muted"
          >
            <Icon
              name={isOpen ? 'chevron-up' : 'chevron-down'}
              className="h-3 w-3 shrink-0 text-muted-foreground"
            />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => toggleChild(node.id)} aria-expanded={isOpen} className={rowClass}>
          <span className="flex-1 truncate text-start">{t(node.label)}</span>
          <Icon
            name={isOpen ? 'chevron-up' : 'chevron-down'}
            className="h-3 w-3 shrink-0 text-muted-foreground"
          />
        </button>
      )}

      {isOpen && (
        <div className="ms-3 border-s border-border ps-2">
          {node.children.map((child) => (
            <NestedItem
              key={child.id}
              node={child}
              pathname={pathname}
              openChild={openChild}
              toggleChild={toggleChild}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** True if `pathname` matches this node or any descendant, at any depth. */
function containsActive(node: MenuNode, pathname: string | null): boolean {
  if (node.route === pathname) return true;
  return node.children.some((c) => containsActive(c, pathname));
}

/** The first real route found by walking down the first child at each level - used so a
 *  route-less parent (an accordion row with no page of its own) still goes somewhere. */
function firstRoute(node: MenuNode): string | null {
  if (node.route) return node.route;
  for (const c of node.children) {
    const r = firstRoute(c);
    if (r) return r;
  }
  return null;
}

/** The chain of ancestor BRANCH ids (nodes with children) leading down to whichever node
 *  matches `pathname` - e.g. ['HRM id', 'Employee id'] for a page nested two levels deep.
 *  Used to auto-expand a deep link instead of landing on a sidebar that looks collapsed. */
function findAncestorChain(nodes: MenuNode[], pathname: string | null): string[] | null {
  for (const node of nodes) {
    if (node.route === pathname) return [];
    if (node.children.length > 0) {
      const nested = findAncestorChain(node.children, pathname);
      if (nested) return [node.id, ...nested];
    }
  }
  return null;
}

/** The brand mark at the top of the sidebar - the uploaded logo, or the product's own letter badge when none is set. */
function BrandMark({ logoUrl }: { logoUrl: string | null }) {
  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a tenant-hosted brand image
      <img src={logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg object-contain" />
    );
  }
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand text-sm font-black text-brand-fg">
      A
    </span>
  );
}

export function Sidebar({
  menu, orgName, orgLogoUrl = null, version = '0.1.0', styleClass = 'sidebar-dark', dashboards = [],
}: {
  menu: MenuNode[];
  /**
   * The dashboards this person may open (11 Oct 2026, dashboards demo). They
   * replace the single "Dashboard" link with a section of their own, in the
   * order of the 1-7 keys.
   */
  dashboards?: { k: string; l: string; i: string }[];
  orgName: string;
  orgLogoUrl?: string | null;
  version?: string;
  /** Settings › Appearance › Sidebar - see lib/appearance `sidebarClass`. */
  styleClass?: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const locale = useLocale();
  const t = (label: string) => translateLabel(label, locale);
  const { open: drawerOpen, setOpen: setDrawerOpen } = useMobileNav();
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Nested rows (a module's own accordion, e.g. HRM's Employee/Attendance/Leave
  // rows). A Set since 11 Oct 2026: as a single "open one" value, opening a
  // row two levels down closed the row it sits in, and a row could only be
  // shut by opening another.
  const [openChild, setOpenChild] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [dashOpen, setDashOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem('atlas:side-dash') === 'closed') setDashOpen(false);
      if (localStorage.getItem('atlas:side-collapsed') === '1') setCollapsed(true);
    } catch { /* storage off */ }
  }, []);
  const setCollapsedSaved = (v: boolean) => {
    setCollapsed(v);
    try { localStorage.setItem('atlas:side-collapsed', v ? '1' : '0'); } catch { /* storage off */ }
  };
  const toggleDash = () => setDashOpen((v) => {
    try { localStorage.setItem('atlas:side-dash', v ? 'closed' : 'open'); } catch { /* storage off */ }
    return !v;
  });

  // Open the chain of groups/rows that contains the current page, so a deep
  // link does not land you in a sidebar that looks like nothing is selected.
  //
  // On a CHANGE OF PAGE only (11 Oct 2026). It used to run whenever `menu`
  // changed too - and the layout hands down a new menu array on every refresh
  // and every filter change, so a group you had just closed sprang open again
  // the moment a list filtered or a dashboard period changed.
  const menuRef = useRef(menu);
  menuRef.current = menu;
  useEffect(() => {
    const chain = findAncestorChain(menuRef.current, pathname);
    if (!chain || chain.length === 0) return;
    setOpen((prev) => new Set(prev).add(chain[0]));
    if (chain.length > 1) setOpenChild((prev) => { const n = new Set(prev); chain.slice(1).forEach((id) => n.add(id)); return n; });
  }, [pathname]);

  // Close the drawer whenever the route changes.
  //
  // Watching the pathname rather than putting an onClick on every link catches
  // every route change there is - a link, a redirect after a save, the back
  // button. Missing any one of them leaves the drawer covering the page the
  // user just asked for.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname, setDrawerOpen]);

  // Escape closes it. Cheap, and it is the first thing anyone tries.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, setDrawerOpen]);

  const q = filter.trim().toLowerCase();
  // With the dashboards section showing, the menu's own Dashboard link is the
  // same place twice.
  const menuShown = dashboards.length ? menu.filter((g) => g.route !== '/dashboard') : menu;
  const visible = q ? filterMenu(menuShown, q) : menuShown;
  const activeDash = pathname === '/dashboard' ? (search.get('tab') ?? dashboards[0]?.k) : null;

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleChild = (id: string) => setOpenChild((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const anyOpen = open.size > 0 || openChild.size > 0;
  const collapseAll = () => { setOpen(new Set()); setOpenChild(new Set()); };

  /**
   * The menu itself, shared by the desktop rail and the mobile drawer.
   *
   * Extracted rather than duplicated: two copies of a seventeen-group tree with
   * filtering, expand state and active highlighting would drift within a week,
   * and the phone copy is the one nobody would notice had drifted.
   */
  const nav = (
    <nav className="thin-scroll flex-1 overflow-y-auto px-2 pb-4">
      {dashboards.length > 0 && !q && (
        <div className="mb-3">
          {/*
            Dashboards open on hover on a laptop (13 Oct 2026, Pravin): the
            list stays shut so it takes no room, opens while the pointer is
            over it (or keyboard focus is inside it - not a mouse click, which would hold it open) and shuts when it leaves.
            Only this block - every other group still opens on click. A phone
            has no hover, so the drawer keeps tap-to-open (`dashOpen`).
          */}
          <div className="group/dash">
            <button
              type="button"
              onClick={toggleDash}
              aria-expanded={dashOpen}
              className="flex w-full items-center rounded-sm px-2.5 pb-1.5 pt-1 text-micro font-semibold uppercase text-muted-foreground hover:text-foreground"
            >
              <span className="flex-1 text-start">Dashboards</span>
              <Icon name="chevron-down" className={`h-3.5 w-3.5 transition-transform ${dashOpen ? 'rotate-180 md:rotate-0' : ''} md:group-has-[:focus-visible]/dash:rotate-180 md:group-hover/dash:rotate-180`} />
            </button>
            <div className={`${dashOpen ? '' : 'hidden'} md:hidden md:group-has-[:focus-visible]/dash:block md:group-hover/dash:block`}>
              {dashboards.map((d, i) => (
                <Link
                  key={d.k}
                  href={i === 0 ? '/dashboard' : `/dashboard?tab=${d.k}`}
                  className={`relative mb-0.5 flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-sm font-medium transition ${
                    activeDash === d.k ? 'bg-brand/10 text-on-tint-brand' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {activeDash === d.k && <span className="absolute inset-y-1.5 start-0 w-[3px] rounded-full bg-brand" />}
                  <DIcon n={d.i} s={16} />{t(d.l)}<span className="ms-auto font-mono text-cap opacity-60">{i + 1}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center px-2.5 pb-1.5 pt-4">
            <p className="flex-1 text-micro font-semibold uppercase text-muted-foreground">Go to</p>
            {anyOpen && (
              <button type="button" onClick={collapseAll} className="text-cap font-medium text-muted-foreground hover:text-brand">
                Close all
              </button>
            )}
          </div>
        </div>
      )}
      {visible.map((group) => {
        const isOpen = open.has(group.id) || q.length > 0;
        const selfActive = group.route === pathname;
        const childActive = containsActive(group, pathname) && !selfActive;

        if (group.children.length === 0) {
          return (
            <Link
              key={group.id}
              href={group.route ?? '#'}
              className={`mb-0.5 flex items-center gap-2.5 rounded px-2.5 py-2 text-sm transition ${
                selfActive
                  ? 'bg-brand/10 font-semibold text-on-tint-brand'
                  : 'text-foreground hover:bg-muted'
              }`}
            >
              <Icon name={iconFor(group.label)} className="h-4 w-4 shrink-0 opacity-80" />
              <span className="truncate">{t(group.label)}</span>
            </Link>
          );
        }

        return (
          <div key={group.id} className="mb-0.5">
            <button
              type="button"
              onClick={() => toggle(group.id)}
              aria-expanded={isOpen}
              className={`flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-sm transition ${
                childActive && !isOpen
                  ? 'bg-brand/[0.07] font-semibold text-on-tint-brand'
                  : 'text-foreground hover:bg-muted'
              }`}
            >
              <Icon name={iconFor(group.label)} className="h-4 w-4 shrink-0 opacity-80" />
              <span className="flex-1 truncate text-start">{t(group.label)}</span>
              <Icon
                name={isOpen ? 'chevron-up' : 'chevron-down'}
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              />
            </button>

            {isOpen && (
              <div className="ms-4 border-s border-border ps-2">
                {group.children.map((child) => (
                  <NestedItem
                    key={child.id}
                    node={child}
                    pathname={pathname}
                    openChild={openChild}
                    toggleChild={toggleChild}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {visible.length === 0 && (
        <p className="px-3 py-8 text-center text-xs text-muted-foreground">
          No menus match &ldquo;{filter}&rdquo;.
        </p>
      )}
    </nav>
  );

  const searchBox = (
    <div className="px-3 pb-2">
      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute start-0 top-1/2 ms-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={locale === 'hi' ? 'मेनू खोजें…' : 'Search menu…'}
          aria-label={locale === 'hi' ? 'मेनू खोजें' : 'Search menu'}
          className="h-8 w-full rounded border border-border bg-background ps-8 pe-2 text-xs outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>
    </div>
  );

  const footer = (
    <div className="border-t border-border px-4 py-2.5">
      <p className="text-xs text-muted-foreground">
        {menu.length} menu group{menu.length === 1 ? '' : 's'} visible to you
      </p>
      <p className="text-xs text-muted-foreground">Version {version}</p>
    </div>
  );

  return (
    <>
      {/* ---------------------------------------------------------------
          PHONE: an overlay drawer.

          `fixed`, so it sits above the page instead of stealing a column from
          it. Rendered only while open - an always-present drawer translated
          off-screen keeps seventeen menu groups mounted and focusable behind
          the page, which screen readers happily read out.
          --------------------------------------------------------------- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop; the drawer has its own close button */}
          <div
            className="absolute inset-0 animate-fade-in bg-foreground/40"
            onClick={() => setDrawerOpen(false)}
          />

          <aside className={`${styleClass} absolute inset-y-0 start-0 flex w-[17rem] max-w-[85vw] animate-fade-in flex-col border-e border-border bg-card shadow-overlay`}>
            <div className="flex items-center gap-2 px-4 py-3.5">
              <Link href="/dashboard" onClick={() => setDrawerOpen(false)} aria-label={`${orgName} - home`} className="flex min-w-0 flex-1 items-center gap-2 rounded-sm">
                <BrandMark logoUrl={orgLogoUrl} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-tight text-navy">Atlas</p>
                  <p className="truncate text-xs text-muted-foreground">{orgName}</p>
                </div>
              </Link>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>

            {searchBox}
            {nav}
            {footer}
          </aside>
        </div>
      )}

      {/* ---------------------------------------------------------------
          TABLET AND UP: the rail, exactly as it was.

          `hidden md:flex` is the only change to these two. It must stay in
          step with the hamburger's `md:hidden` - a gap between them leaves a
          width with no navigation at all.
          --------------------------------------------------------------- */}
      {collapsed ? (
        <aside className={`${styleClass} hidden w-14 shrink-0 flex-col items-center border-e border-border bg-card py-3 md:flex`}>
          <button
            type="button"
            onClick={() => setCollapsedSaved(false)}
            title="Expand menu"
            aria-label="Expand menu"
            className="grid h-8 w-8 place-items-center rounded bg-brand/10 text-on-tint-brand transition hover:bg-brand/20"
          >
            <Icon name="chevrons-right" className="h-4 w-4" />
          </button>
          <nav className="thin-scroll mt-3 flex flex-1 flex-col items-center gap-1 overflow-y-auto">
            {dashboards.map((d, i) => (
              <Link
                key={d.k}
                href={i === 0 ? '/dashboard' : `/dashboard?tab=${d.k}`}
                title={`${t(d.l)} dashboard`}
                aria-label={`${t(d.l)} dashboard`}
                className={`grid h-9 w-9 place-items-center rounded transition ${
                  activeDash === d.k ? 'bg-brand/10 text-on-tint-brand' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <DIcon n={d.i} s={16} />
              </Link>
            ))}
            {dashboards.length > 0 && <span className="my-1 h-px w-6 bg-border" />}
            {menuShown.map((g) => {
              const active = containsActive(g, pathname);
              return (
                <Link
                  key={g.id}
                  href={g.route ?? firstRoute(g) ?? '#'}
                  title={t(g.label)}
                  className={`grid h-9 w-9 place-items-center rounded transition ${
                    active ? 'bg-brand/10 text-on-tint-brand' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <Icon name={iconFor(g.label)} className="h-4 w-4" />
                </Link>
              );
            })}
          </nav>
        </aside>
      ) : (
        <aside className={`${styleClass} hidden w-60 shrink-0 flex-col border-e border-border bg-card md:flex`}>
          <div className="flex items-center gap-2 px-4 py-3.5">
            {/* Logo and name go home: each person's first dashboard - Business for an owner, My day for staff (13 Oct 2026). */}
            <Link href="/dashboard" aria-label={`${orgName} - home`} className="flex min-w-0 flex-1 items-center gap-2 rounded-sm">
              <BrandMark logoUrl={orgLogoUrl} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold leading-tight text-navy">Atlas</p>
                <p className="truncate text-xs text-muted-foreground">{orgName}</p>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => setCollapsedSaved(true)}
              title="Minimise menu"
              aria-label="Minimise menu"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition hover:bg-brand/10 hover:text-brand"
            >
              <Icon name="chevrons-left" className="h-4 w-4" />
            </button>
          </div>

          {searchBox}
          {nav}
          {footer}
        </aside>
      )}
    </>
  );
}
