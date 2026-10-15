'use client';

import { useState } from 'react';
import { Icon } from './Icon';
import { Badge } from './Layout';
import { initials } from '@/lib/revenue';
import { resolveAvatarClass } from '@/lib/avatar';
import type { OrgNode } from '@/server/hierarchy';
import { DialogFrame } from './DialogFrame';

/**
 * A real box-and-connector org chart, not the indented list.
 *
 * Built as a pure-CSS tree (nested `<ul>/<li>` with `::before`/`::after`
 * pseudo-element connector lines - a well-known, dependency-free technique)
 * rather than pulling in a graph-diagramming library. `OrgNode.reports` is
 * already a fully-materialised recursive tree, so this needs no queries of
 * its own and no JS position measurement - the connectors are pure CSS,
 * expand/collapse is just "don't render the child `<ul>`", and zoom is a
 * single `transform: scale()` on the wrapper.
 *
 * Every colour below is a theme token (`hsl(var(--x))`), never a hex
 * literal - this repo's lint rule enforces that for white-labelling, and
 * broke a production deploy once already when a different component missed
 * it.
 */

const TREE_STYLE = `
.atlas-org-tree ul {
  display: flex;
  padding-top: 24px;
  position: relative;
  justify-content: center;
}
.atlas-org-tree li {
  display: flex;
  flex-direction: column;
  align-items: center;
  list-style: none;
  position: relative;
  padding: 24px 8px 0 8px;
}
.atlas-org-tree li::before,
.atlas-org-tree li::after {
  content: '';
  position: absolute;
  top: 0;
  right: 50%;
  border-top: 2px solid hsl(var(--border));
  width: 50%;
  height: 24px;
}
.atlas-org-tree li::after {
  right: auto;
  left: 50%;
  border-left: 2px solid hsl(var(--border));
}
.atlas-org-tree li:only-child::after,
.atlas-org-tree li:only-child::before {
  display: none;
}
.atlas-org-tree li:only-child {
  padding-top: 0;
}
.atlas-org-tree li:first-child::before,
.atlas-org-tree li:last-child::after {
  border: 0 none;
}
.atlas-org-tree li:last-child::before {
  border-right: 2px solid hsl(var(--border));
  border-radius: 0 6px 0 0;
}
.atlas-org-tree li:first-child::after {
  border-radius: 6px 0 0 0;
}
.atlas-org-tree ul ul::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  border-left: 2px solid hsl(var(--border));
  width: 0;
  height: 24px;
}
.atlas-org-tree > ul {
  padding-top: 0;
}
.atlas-org-tree > ul::before {
  display: none;
}
`;

function TreeNode({
  node, collapsed, toggle,
}: {
  node: OrgNode;
  collapsed: Set<string>;
  toggle: (id: string) => void;
}) {
  const hasReports = node.reports.length > 0;
  const isCollapsed = collapsed.has(node.id);

  return (
    <li>
      <div className="inline-flex w-40 flex-col items-center gap-1 rounded-xl border border-border bg-card p-3 shadow-card">
        <span
          className={`grid h-10 w-10 place-items-center rounded-full text-xs font-bold text-white ${resolveAvatarClass(node.id, node.avatarColor)}`}
          aria-hidden
        >
          {initials(node.fullName)}
        </span>
        <span className="w-full truncate text-center text-sm font-semibold">{node.fullName}</span>
        <div className="flex flex-wrap items-center justify-center gap-1">
          {node.designationCode && <Badge tone="neutral">{node.designationCode}</Badge>}
          {!node.isActive && <Badge tone="neutral">Inactive</Badge>}
        </div>
        {hasReports && (
          <button
            type="button"
            onClick={() => toggle(node.id)}
            className="mt-1 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-muted"
          >
            <Icon name={isCollapsed ? 'chevron-down' : 'chevron-up'} className="h-3 w-3" />
            {node.headcount} report{node.headcount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {hasReports && !isCollapsed && (
        <ul>
          {node.reports.map((child) => (
            <TreeNode key={child.id} node={child} collapsed={collapsed} toggle={toggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function OrgChartTree({ roots }: { roots: OrgNode[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [scale, setScale] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);

  const toggle = (id: string) => setCollapsed((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toolbar = (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => setScale((s) => Math.max(0.6, s - 0.1))}
        className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-card transition hover:bg-muted" aria-label="Zoom out">
        <Icon name="minus" className="h-3.5 w-3.5" />
      </button>
      <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{Math.round(scale * 100)}%</span>
      <button type="button" onClick={() => setScale((s) => Math.min(1.4, s + 0.1))}
        className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-card transition hover:bg-muted" aria-label="Zoom in">
        <Icon name="plus" className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => setFullscreen((f) => !f)}
        className="ms-1.5 grid h-7 w-7 place-items-center rounded-lg border border-border bg-card transition hover:bg-muted"
        aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
        <Icon name={fullscreen ? 'minimize' : 'maximize'} className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const tree = (
    <div className="atlas-org-tree" style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}>
      <style>{TREE_STYLE}</style>
      <ul>
        {roots.map((r) => (
          <TreeNode key={r.id} node={r} collapsed={collapsed} toggle={toggle} />
        ))}
      </ul>
    </div>
  );

  if (fullscreen) {
    return (
      <DialogFrame label="Org chart" onClose={() => setFullscreen(false)} className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex items-center justify-between border-b border-border p-3">
          <p className="text-sm font-semibold">Org chart</p>
          {toolbar}
        </div>
        <div className="flex-1 overflow-auto p-8">{tree}</div>
      </DialogFrame>
    );
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">{toolbar}</div>
      <div className="overflow-auto rounded-lg border border-border bg-background p-6">{tree}</div>
    </div>
  );
}
