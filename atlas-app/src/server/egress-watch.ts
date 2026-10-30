import 'server-only';
import { db } from './db';
import { notify, ownersOf } from './notify';

/**
 * The nightly egress watch (31 Oct 2026). Supabase stopped the project after
 * ~50 GB left the database in two weeks and nobody saw it coming: a page
 * refreshing every 5 s re-read thousands of rows each time.
 *
 * Postgres counts the rows every query returned (pg_stat_statements). Once a
 * day this reads that count, turns it into a rough GB figure, alerts the
 * owners of EGRESS_ALERT_STORE_ID when it is too high, and starts the count
 * again so the next run sees one day.
 *
 * shortcut: rows x an average row size, not bytes on the wire - it catches a
 * runaway query, not the exact bill. The Supabase usage page has the real number.
 */
/** Calibrated on 30 Oct 2026: 245M rows in 15 days against Supabase's 49.6 GB. */
const BYTES_PER_ROW = 200;
/** Pro includes 250 GB a month, about 8 GB a day; warn well before that. */
const DAILY_LIMIT_GB = 3;

export interface EgressReport { hours: number; estimatedGb: number; top: { table: string; calls: number; rows: number }[]; alerted: number }

export async function checkEgress(): Promise<EgressReport> {
  const [info] = await db.$queryRaw<{ since: Date }[]>`SELECT stats_reset AS since FROM extensions.pg_stat_statements_info`;
  const rows = await db.$queryRaw<{ calls: bigint; rows: bigint; q: string }[]>`
    SELECT calls, rows, left(query, 300) AS q FROM extensions.pg_stat_statements
    WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
    ORDER BY rows DESC LIMIT 200`;
  // Start the next day's count from zero.
  await db.$executeRaw`SELECT extensions.pg_stat_statements_reset()`;

  const hours = Math.max(1, (Date.now() - info.since.getTime()) / 3_600_000);
  const totalRows = rows.reduce((n, r) => n + Number(r.rows), 0);
  const estimatedGb = Math.round((totalRows * BYTES_PER_ROW / 1e9) * (24 / hours) * 10) / 10;
  // By table - the SQL itself is not shown to anybody.
  const byTable = new Map<string, { calls: number; rows: number }>();
  for (const r of rows) {
    // Prisma names every column "public"."Table"."col", so the first one names the table.
    const table = /"public"\."(\w+)"/.exec(r.q)?.[1] ?? /FROM\s+"?(\w+)"?/i.exec(r.q)?.[1] ?? 'other';
    const t = byTable.get(table) ?? { calls: 0, rows: 0 };
    t.calls += Number(r.calls); t.rows += Number(r.rows);
    byTable.set(table, t);
  }
  const top = [...byTable].map(([table, t]) => ({ table, ...t })).sort((a, b) => b.rows - a.rows).slice(0, 3);

  let alerted = 0;
  const storeId = process.env.EGRESS_ALERT_STORE_ID;
  if (estimatedGb > DAILY_LIMIT_GB && storeId) {
    const day = new Date().toISOString().slice(0, 10);
    alerted = await notify({
      storeId, userIds: await ownersOf(storeId), kind: 'system', dedupeKey: `egress:${day}`,
      title: `Database egress high: about ${estimatedGb} GB a day`,
      body: `The limit we aim for is ${DAILY_LIMIT_GB} GB a day (Supabase Pro allows ~8). Most rows came from: `
        + top.map((t) => `${t.table} (${t.rows.toLocaleString('en-IN')} rows, ${t.calls.toLocaleString('en-IN')} reads)`).join(', ')
        + '. A screen may be refreshing too often or reading a whole table.',
    });
  }
  return { hours: Math.round(hours), estimatedGb, top, alerted };
}
