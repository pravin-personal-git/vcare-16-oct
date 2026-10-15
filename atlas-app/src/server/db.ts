import { Prisma, PrismaClient } from '@prisma/client';
import { currentActor, inAuditedTransaction } from './audit-context';
import {
  FILTERED_READS, POST_FILTERED_READS, ensureDeletedAtSelected, isSoftDeleted,
  isTombstoned, stripAddedDeletedAt, withoutDeleted,
} from './soft-delete';

/**
 * The one database client.
 *
 * Wrapped so every write tells Postgres who made it (health check AUD-1,
 * 25 Sep 2026). The audit TRIGGER does the recording - in the same
 * transaction as the change, with old and new values - so no screen can
 * forget to log. This wrapper only supplies the actor: it sets the
 * transaction-local `app.actor` setting the trigger reads.
 *
 * - A single write with a known actor runs as a two-statement batch
 *   transaction (set the actor, then the write) - one round trip.
 * - `db.$transaction(...)` sets the actor once at the start; writes inside
 *   it then run as they are.
 * - No actor (scripts, cron, signed-out requests): writes run unchanged and
 *   the trigger records them as "system".
 *
 * IT ALSO HIDES TOMBSTONED ROWS (3 Oct 2026). Twenty-nine models stopped being
 * hard-deleted, and every top-level read of them has to exclude the dead rows or
 * a deleted category turns up in a dropdown. There are about 170 such reads, so
 * the filter lives here rather than at each of them - see server/soft-delete for
 * what is filtered, what deliberately is not, and how a caller opts out.
 */

const WRITES = new Set([
  'create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn',
  'upsert', 'delete', 'deleteMany',
]);

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaBase?: PrismaClient };

const base: PrismaClient = globalForPrisma.prismaBase ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

type AnyDelegate = Record<string, (args: unknown) => Promise<unknown>>;

const extended = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        /**
         * READS FIRST, and they return here rather than falling through: a read
         * is never audited, so there is nothing below for it to do.
         */
        if (isSoftDeleted(model)) {
          if (FILTERED_READS.includes(operation)) {
            return query(withoutDeleted(args));
          }

          /**
           * `findUnique` runs UNCHANGED and the row is judged afterwards.
           *
           * It used to be rewritten to `findFirst` so `deletedAt: null` could go
           * in the `where`, and that broke Settings > Approval Rules in
           * production: `findUnique` accepts a compound unique key as a nested
           * object (`{ storeId_requestType: { ... } }`) and `findFirst` has no
           * such argument, so Prisma rejected the entire call.
           *
           * Post-filtering costs nothing extra - the row was already fetched -
           * and depends on no assumption about Prisma's `where` grammar.
           */
          if (POST_FILTERED_READS.includes(operation)) {
            const prepared = ensureDeletedAtSelected(args);
            const row = await query(prepared.args);
            if (isTombstoned(row)) {
              // `findUniqueOrThrow` must still throw, or a caller relying on it
              // gets null from something typed as non-nullable.
              if (operation === 'findUniqueOrThrow') {
                throw new Prisma.PrismaClientKnownRequestError(
                  'No record was found for a query.',
                  { code: 'P2025', clientVersion: Prisma.prismaVersion.client },
                );
              }
              return null;
            }
            return stripAddedDeletedAt(row, prepared.added);
          }
        }

        if (!WRITES.has(operation) || inAuditedTransaction.getStore()) return query(args);
        const actor = await currentActor();
        if (!actor) return query(args);
        const delegate = (base as unknown as Record<string, AnyDelegate>)[lowerFirst(model)];
        const [, result] = await base.$transaction([
          base.$queryRaw`SELECT set_config('app.actor', ${JSON.stringify(actor)}, true)`,
          delegate[operation](args) as never,
        ]);
        return result;
      },
    },
  },
});


function auditedTransaction(arg: unknown, opts?: unknown): Promise<unknown> {
  const run = async () => {
    const actor = await currentActor();
    const setActorSql = actor
      ? JSON.stringify(actor)
      : null;
    if (typeof arg === 'function') {
      return extended.$transaction(async (tx) => {
        if (setActorSql) await tx.$queryRaw`SELECT set_config('app.actor', ${setActorSql}, true)`;
        return inAuditedTransaction.run(true, () => (arg as (t: unknown) => Promise<unknown>)(tx));
      }, opts as never);
    }
    const ops = arg as Parameters<typeof extended.$transaction>[0] & unknown[];
    if (!setActorSql) return extended.$transaction(ops, opts as never);
    const results = await inAuditedTransaction.run(true, () => extended.$transaction(
      [extended.$queryRaw`SELECT set_config('app.actor', ${setActorSql}, true)`, ...ops] as never,
      opts as never,
    )) as unknown[];
    return results.slice(1);
  };
  return run();
}

const client = new Proxy(extended, {
  get(target, prop, receiver) {
    if (prop === '$transaction') return auditedTransaction;
    return Reflect.get(target, prop, receiver);
  },
}) as unknown as PrismaClient;

export const db: PrismaClient = globalForPrisma.prisma ?? client;

globalForPrisma.prisma = db;
globalForPrisma.prismaBase = base;
