'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { ToolbarMenu } from '@/components/ui/Toolbar';
import {
  deleteViewAction, listSavedViewsAction, saveViewAction, shareableRolesAction,
} from '@/app/actions/saved-views';
import type { SavedViewRow } from '@/server/saved-views';

/**
 * Saved list layouts - "Save this layout", per user, optionally shared with a
 * role (decision Q2, and D17's "the option for the layout to be saved per
 * user").
 *
 * EXTRACTED FROM `FilterBar` ON 29 SEP so `ListFilter` can offer the same
 * thing. Both controls now use this one implementation; there is no second
 * copy to drift.
 *
 * A view is just the screen's address. That is the whole trick and it is why
 * this works for both controls: as long as a filter lives in the query string,
 * saving a layout is saving `?...` under a name, and applying one is a
 * navigation. Column visibility is the exception - it lives in localStorage
 * because it is a per-browser preference - so it rides along separately.
 */

const GRID_STORAGE = (path: string) => `atlas:grid-columns:${path}`;

export interface SavedViewsSource {
  /** Rows loaded on the server. Omit and the menu fetches them itself. */
  initial?: SavedViewRow[];
  /** Roles a view may be shared with. Omit and the menu fetches them itself. */
  roles?: string[];
}

export function SavedViewsMenu({ source = {} }: { source?: SavedViewsSource }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const [rows, setRows] = useState<SavedViewRow[]>(source.initial ?? []);
  const [roles, setRoles] = useState<string[]>(source.roles ?? []);
  const [loaded, setLoaded] = useState(source.initial !== undefined);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /**
   * Screens that did not load views on the server fetch them once, lazily.
   * Failing quietly is deliberate: saved views are a convenience, and a screen
   * whose list works must not show an error because a dropdown could not fill.
   */
  useEffect(() => {
    if (loaded) return;
    let alive = true;
    (async () => {
      try {
        const [v, r] = await Promise.all([listSavedViewsAction(pathname), shareableRolesAction()]);
        if (!alive) return;
        setRows(v);
        setRoles(r);
      } catch { /* leave the menu empty */ } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [loaded, pathname]);

  const apply = (v: SavedViewRow) => {
    try {
      localStorage.setItem(GRID_STORAGE(pathname), JSON.stringify(v.hiddenColumns));
      window.dispatchEvent(new Event('atlas:grid-columns'));
    } catch { /* storage blocked - the filters still apply */ }
    router.push(v.query ? `${pathname}?${v.query}` : pathname, { scroll: false });
  };

  const save = () => {
    setError(null);
    let hidden: string[] = [];
    try { hidden = JSON.parse(localStorage.getItem(GRID_STORAGE(pathname)) ?? '[]'); } catch { /* none */ }
    start(async () => {
      const res = await saveViewAction({
        screenKey: pathname, name, query: sp.toString(), hiddenColumns: hidden, sharedRoleName: role || null,
      });
      if (res.error) { setError(res.error); return; }
      setRows(await listSavedViewsAction(pathname));
      setNaming(false); setName(''); setRole('');
    });
  };

  const remove = (id: string) => start(async () => {
    const res = await deleteViewAction(id);
    if (res.error) setError(res.error);
    else setRows((r) => r.filter((x) => x.id !== id));
  });

  return (
    <ToolbarMenu label="Views" icon="columns" width="w-72">
      {(close) => (
        <div>
          {rows.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {loaded ? 'No saved views yet. Set filters and columns, then save.' : 'Loading…'}
            </p>
          )}
          {rows.map((v) => (
            <div key={v.id} className="flex items-center gap-1 px-1">
              <button type="button" role="menuitem" onClick={() => { apply(v); close(); }}
                className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-start text-sm hover:bg-muted">
                {v.name}
                {v.sharedRoleName && <span className="ms-1.5 text-xs text-muted-foreground">· {v.sharedRoleName}</span>}
              </button>
              {v.mine && (
                <button type="button" onClick={() => remove(v.id)} aria-label={`Delete view ${v.name}`} disabled={pending}
                  className="grid h-10 w-10 sm:h-7 sm:w-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-danger">
                  <Icon name="trash" className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
          <div className="mt-1 border-t border-border px-3 py-2">
            {!naming ? (
              <button type="button" onClick={() => setNaming(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand">
                <Icon name="plus" className="h-3.5 w-3.5" /> Save this layout
              </button>
            ) : (
              <div className="grid gap-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  Name
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60}
                    placeholder="e.g. My open jobs this month" className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground" />
                </label>
                {roles.length > 0 && (
                  <label className="grid gap-1 text-xs text-muted-foreground">
                    Share with (optional)
                    <select value={role} onChange={(e) => setRole(e.target.value)} className="h-9 rounded-lg border border-border bg-background px-2 text-sm text-foreground">
                      <option value="">Only me</option>
                      {roles.map((r) => <option key={r} value={r}>Everyone who is {r}</option>)}
                    </select>
                  </label>
                )}
                {error && <p className="text-xs text-danger">{error}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={save} disabled={pending || !name.trim()}
                    className="h-8 rounded-lg bg-brand px-3 text-sm font-medium text-brand-fg disabled:opacity-50">Save</button>
                  <button type="button" onClick={() => { setNaming(false); setError(null); }} className="h-8 rounded-lg border border-border px-3 text-sm">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </ToolbarMenu>
  );
}
