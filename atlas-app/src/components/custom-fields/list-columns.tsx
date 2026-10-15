import type { Column } from '@/components/ui/DataGrid';
import type { ListColumns } from '@/server/custom-fields';

/**
 * Grid columns for the extra fields an owner marked "Show in list"
 * (Settings > Custom Fields). Values come from the server for the rows on
 * screen; the columns do not sort - the list is sorted on the server.
 */
export function customColumns<T extends { id: string }>(extra: ListColumns | undefined): Column<T>[] {
  if (!extra) return [];
  return extra.columns.map((c) => ({
    key: `cf_${c.key}`,
    header: c.label,
    render: (row: T) => extra.values[row.id]?.[c.key] || <span className="text-muted-foreground">-</span>,
  }));
}
