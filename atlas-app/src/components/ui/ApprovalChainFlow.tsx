/**
 * Employee -> L1 -> L2 -> ... as a horizontal flow, not another list.
 *
 * The editable `<ol>` next to this already says the same thing in words;
 * this exists because "how many signatures before this is actually
 * approved, and in what order" is a shape a reader takes in at a glance
 * from boxes and arrows in a way a vertical list of rows does not.
 *
 * Plain SVG/CSS, not a diagramming library - three to five static nodes in
 * a row is not a problem that needs one.
 */
export function ApprovalChainFlow({
  levels,
}: {
  levels: { level: number; approverRoleName: string }[];
}) {
  if (levels.length === 0) return null;

  const nodes = ['Employee', ...levels.map((l) => l.approverRoleName)];

  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1" role="img" aria-label={`Approval flow: ${nodes.join(' then ')}`}>
      {nodes.map((label, i) => (
        <span key={i} className="flex shrink-0 items-center gap-1">
          <span
            className={`whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
              i === 0
                ? 'border-border bg-muted/40 text-muted-foreground'
                : 'border-brand/30 bg-brand/10 text-on-tint-brand'
            }`}
          >
            {i === 0 ? label : `L${i} · ${label}`}
          </span>
          {i < nodes.length - 1 && (
            <svg width="18" height="10" viewBox="0 0 18 10" className="shrink-0 text-muted-foreground" aria-hidden>
              <line x1="0" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M13 1.5 L17 5 L13 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      ))}
    </div>
  );
}
