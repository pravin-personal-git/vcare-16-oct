-- Pravin, 28 Sep 2026 (option A): before the job engine, "resolved" meant done.
-- It now means "Waiting to close", and ~3,000 old jobs would bury the real
-- queue. Resolved jobs older than 30 days are closed; history is kept and each
-- is marked customFields.autoClosed = 'resolved-before-engine' (reversible).
UPDATE "Complaint"
SET "status" = 'closed',
    "closedAt" = COALESCE("resolvedAt", "updatedAt"),
    "customFields" = COALESCE("customFields", '{}'::jsonb) || jsonb_build_object('autoClosed', 'resolved-before-engine')
WHERE "status" = 'resolved'
  AND COALESCE("resolvedAt", "updatedAt", "createdAt") < NOW() - INTERVAL '30 days';
