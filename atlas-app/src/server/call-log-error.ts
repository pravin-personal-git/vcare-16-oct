/**
 * The error type shared by everything a paired phone can do.
 *
 * WHY THIS IS ITS OWN FILE, RATHER THAN LIVING IN `call-logs.ts`.
 *
 * `call-logs.ts` needs shift attribution from `shifts.ts`, and `shifts.ts`
 * needs to throw this. That is a circular import.
 *
 * It would have worked. Both modules only touch each other inside function
 * bodies, which run long after loading, and ESM handles that case. But
 * "currently works by accident of evaluation order" is a poor foundation: the
 * day someone moves a `new CallLogError()` to module scope, or a bundler
 * reorders the graph, the failure is `undefined is not a constructor` at
 * startup - with a stack trace pointing at the wrong file.
 *
 * A class with no dependencies of its own cannot participate in a cycle. Both
 * modules import it, neither imports the other at runtime, and the problem is
 * gone rather than dormant.
 *
 * Routes catch this to decide between a 400 and a 500: a `CallLogError` is
 * something the phone or the user did, and the message is safe to show them.
 * Anything else is ours, and is logged rather than displayed.
 */
export class CallLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CallLogError';
  }
}
