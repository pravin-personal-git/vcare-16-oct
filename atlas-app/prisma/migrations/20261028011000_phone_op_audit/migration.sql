-- F-13 (13 Oct 2026): PhoneOp is audited like every other table (AGENTS.md section 4).
DROP TRIGGER IF EXISTS atlas_audit ON "PhoneOp";
CREATE TRIGGER atlas_audit AFTER INSERT OR UPDATE OR DELETE ON "PhoneOp" FOR EACH ROW EXECUTE FUNCTION atlas_audit();
