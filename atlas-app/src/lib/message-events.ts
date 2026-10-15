/**
 * Fired on `window` whenever this tab reads or sends messages, so the header
 * badge recounts at once instead of waiting for its next poll.
 */
export const MESSAGES_CHANGED = 'atlas:messages-changed';

/** How often an open, visible tab checks for new messages. */
export const MESSAGE_POLL_MS = 15_000;
