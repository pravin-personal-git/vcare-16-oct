/**
 * Searching a TREE without breaking it (F1b, decision D17).
 *
 * WHY THIS IS NOT THE SAME AS FILTERING A LIST.
 *
 * Flat filtering assumes rows are independent. On an org chart or a menu tree
 * they are not: showing a match without its parents strands it. That was live
 * on the hierarchy screen - searching a technician hid their manager, so the
 * person appeared at the top of a chain that was no longer drawn, which reads
 * as broken data rather than as a filter.
 *
 * So this does not filter. It returns the ids to KEEP VISIBLE: every match,
 * plus every ancestor so the path down survives, plus (by default) every
 * descendant so searching a manager shows their team. The caller renders its
 * tree exactly as before and skips nodes outside the set.
 *
 * Pure, and in lib rather than beside the component, so it can be tested
 * without a DOM - the ancestor rule is the part that can silently regress.
 */

export interface TreeSearchNode {
  id: string;
  parentId: string | null;
  /** The words this node is matched on. Nulls and blanks are ignored. */
  terms: (string | null | undefined)[];
}

export interface TreeSearchSets {
  /** Ids to draw, or null for "no search - draw the whole tree". */
  keep: Set<string> | null;
  /** Nodes that matched the text, as opposed to those kept for their path. */
  matched: Set<string>;
}

export function visibleTreeIds(
  nodes: TreeSearchNode[],
  query: string,
  { includeDescendants = true }: { includeDescendants?: boolean } = {},
): TreeSearchSets {
  const q = query.trim().toLowerCase();

  // Null rather than "all the ids": a five-hundred node tree should not build
  // a five-hundred item Set on every render to say "nothing is filtered".
  if (!q) return { keep: null, matched: new Set() };

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const matched = new Set<string>();
  for (const n of nodes) {
    if (n.terms.some((t) => (t ?? '').toLowerCase().includes(q))) matched.add(n.id);
  }

  const keep = new Set<string>(matched);

  // Ancestors: without them a match floats free of the tree it belongs to.
  for (const id of matched) {
    let cur = byId.get(id)?.parentId ?? null;
    // `seen` guards a parent cycle - bad data must not hang the page.
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      // Only keep an ancestor that actually exists. A `parentId` pointing at a
      // deleted row would otherwise put a phantom id in the set - harmless to
      // render, but it inflates any count taken from it, and a set that can
      // contain ids the caller has never heard of is a trap for the next
      // caller rather than this one.
      const parent = byId.get(cur);
      if (!parent) break;
      keep.add(cur);
      cur = parent.parentId;
    }
  }

  // Descendants: searching a manager's name should show their team.
  if (includeDescendants) {
    const childrenOf = new Map<string, string[]>();
    for (const n of nodes) {
      if (!n.parentId) continue;
      childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n.id]);
    }
    const stack = [...matched];
    while (stack.length) {
      const id = stack.pop()!;
      for (const child of childrenOf.get(id) ?? []) {
        if (keep.has(child)) continue;
        keep.add(child);
        stack.push(child);
      }
    }
  }

  return { keep, matched };
}
