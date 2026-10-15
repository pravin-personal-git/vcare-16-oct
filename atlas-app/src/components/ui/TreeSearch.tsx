'use client';

import { useMemo, useState } from 'react';
import { visibleTreeIds, type TreeSearchNode } from '@/lib/tree-search';
export type { TreeSearchNode };
import { Icon } from '@/components/ui/Icon';

/**
 * Search over a TREE, keeping the tree (F1b, decision D17).
 *
 * WHY `ListFilter` IS THE WRONG TOOL HERE AND THIS EXISTS INSTEAD.
 *
 * Flat filtering assumes rows are independent. On an org chart or a menu tree
 * they are not: showing a match without its parents strands it - you get a
 * person with no manager above them and no idea where they sit, which is worse
 * than no search at all, because it looks like the data is wrong.
 *
 * So this does not filter. It returns the set of ids to KEEP VISIBLE - every
 * match, plus every ancestor of a match so the path down to it survives, plus
 * (optionally) the descendants of a match so a manager's whole team stays under
 * them. The caller renders its tree exactly as before and skips nodes outside
 * that set. Nothing about the rendering changes; only what is drawn.
 *
 * With an empty box, `keep` isand the caller draws everything. Null
 * rather than "all the ids" on purpose: a tree of five hundred nodes should not
 * build a five-hundred-item Set on every render to say "no filter".
 */


export interface TreeSearchResult {
  /** Ids to draw, or null for "no search - draw the whole tree". */
  keep: Set<string> | null;
  /** Nodes that matched the text, as opposed to those kept for their path. */
  matched: Set<string>;
  query: string;
  setQuery: (v: string) => void;
  /** How many nodes actually matched, for the count line. */
  matchCount: number;
  total: number;
}

export function useTreeSearch(
  nodes: TreeSearchNode[],
  { includeDescendants = true }: { includeDescendants?: boolean } = {},
): TreeSearchResult {
  const [query, setQuery] = useState('');

  const { keep, matched } = useMemo(
    () => visibleTreeIds(nodes, query, { includeDescendants }),
    [nodes, query, includeDescendants],
  );

  return { keep, matched, query, setQuery, matchCount: matched.size, total: nodes.length };
}

/** The box itself, with the count and a Clear - the same chrome as ListFilter. */
export function TreeSearchBar({
  search, placeholder, noun = 'entries',
}: { search: TreeSearchResult; placeholder: string; noun?: string }) {
  const active = search.query.trim() !== '';

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
      <div className="relative min-w-[200px] flex-1">
        <Icon
          name="search"
          className="pointer-events-none absolute inset-inline-start-0 top-1/2 ms-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={search.query}
          onChange={(e) => search.setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-9 w-full rounded-lg border border-border bg-card ps-8 pe-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span role="status">
          {active
            ? `${search.matchCount} of ${search.total} ${noun} match — shown with everyone above them`
            : `${search.total} ${noun}`}
        </span>
        {active && (
          <button
            type="button"
            onClick={() => search.setQuery('')}
            className="rounded px-2 py-1 text-brand hover:bg-brand/10"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
