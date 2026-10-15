/**
 * Task Manager constants - shared between the server (validation) and the
 * browser (the board and status pickers). Kept out of `server/tasks.ts`
 * deliberately: that module is marked `server-only`, and a client component
 * cannot import a VALUE (as opposed to a type) from a server-only module even
 * when the value itself is just plain data.
 */

export const TASK_STATUSES = ['Pending', 'In Progress', 'Completed', 'On Hold', 'Cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['Low', 'Normal', 'High'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
