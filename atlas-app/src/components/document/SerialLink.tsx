import Link from 'next/link';

/**
 * A serial number, wherever a product shows (Vcare, 22 Oct 2026): an orange
 * chip that opens that exact unit on the Stock units page - who has it, which
 * GDN and bill it went on, its warranty. Without the unit's id it still finds
 * it by its number.
 */
export function SerialLink({ serialNo, unitId }: { serialNo: string; unitId?: string | null }) {
  const href = `/stock-units?q=${encodeURIComponent(serialNo)}${unitId ? `&open=${unitId}` : ''}`;
  return (
    <Link href={href} title="Open this unit"
      className="inline-flex items-center rounded border border-warning/40 bg-warning/10 px-1.5 font-mono text-xs text-warning hover:bg-warning/20 hover:underline">
      {serialNo}
    </Link>
  );
}

/** Several serials in a row. */
export function SerialLinks({ units }: { units: { id?: string | null; serialNo: string | null }[] }) {
  const shown = units.filter((u) => u.serialNo);
  if (!shown.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((u, n) => <SerialLink key={u.id ?? `${u.serialNo}-${n}`} serialNo={u.serialNo!} unitId={u.id} />)}
    </span>
  );
}
