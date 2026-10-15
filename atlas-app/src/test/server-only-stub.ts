/**
 * `server-only` under vitest.
 *
 * The real package throws the moment it is imported outside a React Server
 * Component, which is exactly what we want in the app and exactly wrong in a
 * test runner - it made `server/secret-box.ts` untestable, and that module
 * encrypts clients' provider credentials.
 *
 * Aliased in vitest.config.ts only. The production guard is untouched: a
 * client component importing a server module still fails the build.
 */
export {};
