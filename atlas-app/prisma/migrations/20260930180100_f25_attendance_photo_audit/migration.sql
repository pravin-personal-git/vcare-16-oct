-- The audit trigger on "AttendancePhoto" (health check AUD-1).
--
-- Separate from the migration that created the table only because that one had
-- already been applied when audit-coverage.test.ts caught the omission - the
-- checksum of an applied migration is not something to edit quietly.
--
-- Audited rather than excluded, unlike "AttendanceEvent" next door. The GPS
-- pings are a heartbeat, hundreds a shift; this is two rows a person a day, and
-- the question it has to answer is "who removed the photograph?".
DROP TRIGGER IF EXISTS atlas_audit ON "AttendancePhoto";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "AttendancePhoto" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
