import type { AgentRelease } from './agent-protocol';

/**
 * The connector build Atlas offers to every office PC that checks in.
 *
 * WRITTEN BY `npm run field-kit` in atlas-attendance-agent - do not edit by
 * hand. It bundles the connector, copies the bundle to
 * public/attendance-agent/, and records its version and SHA-256 here. A
 * connector older than this downloads it, checks the hash, and its launcher
 * swaps it in (rolling back if it will not start).
 */
export const AGENT_RELEASE: AgentRelease | null = {
  version: '1.1.0',
  sha256: '48bd832ba024f8af24f87a2322f384b54f01a0d8db551d24d9f7223aff45e520',
  path: '/attendance-agent/agent-1.1.0.js',
};
