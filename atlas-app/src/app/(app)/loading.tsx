/**
 * Shown the moment a menu item is clicked, while the next page loads on the
 * server (health check PERF-4). The sidebar and header stay put; only the
 * content area shows this outline, so a click never looks like nothing
 * happened.
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading" className="animate-pulse">
      <div className="mb-4 flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-muted" />
        <div className="flex flex-col gap-2">
          <div className="h-4 w-48 rounded bg-muted" />
          <div className="h-3 w-72 max-w-[60vw] rounded bg-muted/70" />
        </div>
      </div>
      <div className="mb-3 h-12 rounded-lg bg-muted/70" />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-muted/70" />)}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="h-10 bg-muted" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex gap-4 border-t border-border px-3 py-3">
            <div className="h-3 w-1/4 rounded bg-muted/70" />
            <div className="h-3 w-1/3 rounded bg-muted/60" />
            <div className="h-3 w-1/6 rounded bg-muted/50" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
